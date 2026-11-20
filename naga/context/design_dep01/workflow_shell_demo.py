"""
workflow_shell_demo.py — interrupt-as-syscall 模式的最小可跑验证
=================================================================
模式（主文档 §13.3）：LangGraph 图 = 无效应内核（纯控制流 + 派生数据），
Samsara 外壳 = 效应执行层。节点需要副作用时 interrupt 抛出"系统调用请求"，
外壳按类型路由到 kernel_v33 的 perform（入账）/ fork+QuotaPolicy（授权）/
跨边界服务调用（入账），结果 resume 回填；授权拒绝作为数据回填、由图降级。

沙箱说明：本环境无网络装不了 langgraph，故用 MiniGraph——忠实复刻
LangGraph 1.0 相关语义的 ~50 行替身（interrupt 挂起 / checkpoint /
resume 后被挂起节点【从头重跑】、其首个 interrupt() 返回 resume 值）。
真实环境替换点见文件尾部 REAL_LANGGRAPH_MAPPING：外壳代码一行不用改。

验证三条红线（嵌套编排 Agent⇄Workflow⇄Agent 场景）：
  R1 账本唯一权威：效应事实全部入 kernel 账本；图 state/checkpoint 只有派生数据
  R2 效应边界包裹：节点重跑 N 次，效应恰发生 1 次（重跑计数器 vs 账本条数）
  R3 派生必授权：spawn 必经 fork+QuotaPolicy；越权请求被拒且失败授权不留账
"""

import asyncio
import copy
import json
import sys

sys.path.insert(0, '/mnt/agents/output')          # 演示环境；实际部署为包内引用
from kernel_v33 import Kernel, Plugin, QuotaPolicy, QuotaReq, QuotaExhausted


# ============================================================
# MiniGraph：LangGraph 1.0 语义替身（真实环境换成 StateGraph，见文件尾）
# ============================================================
_SENT = object()


class _GraphInterrupt(Exception):
    def __init__(self, value):
        self.value = value


class MiniGraph:
    """DAG 解释器壳：图定义为数据（DAG_DEF），节点为纯函数（只返回 state 更新，
    不得原地改 state、不得含副作用——LangGraph resume 重跑语义天然强制此纪律）。
    state 为 plain dict（reducer = 合并更新）；checkpoint 是缓存，不是事实。
    条件边：edges 的值可为 callable(state)->next_node（本演示用线性边）。"""

    def __init__(self, dag_def, handlers):
        self.dag, self.handlers = dag_def, handlers
        self.checkpoint = None

    def invoke(self, state=None, resume=_SENT):
        if resume is _SENT:
            node, state = self.dag['entry'], copy.deepcopy(state or {})
        else:
            node, state = self.checkpoint['node'], self.checkpoint['state']  # 节点前态
        rv = resume                                   # resume 令牌：一次性
        while True:
            used = {'v': False}

            def interrupt(req):
                if rv is not _SENT and not used['v']:
                    used['v'] = True
                    return rv                         # 重跑时：syscall 结果回填
                raise _GraphInterrupt(req)            # 否则：挂起，等待外壳执行

            try:
                updates = self.handlers[node](state, interrupt) or {}
            except _GraphInterrupt as gi:
                self.checkpoint = {'node': node, 'state': state}
                return {'__interrupt__': gi.value, 'state': state}
            state = {**state, **updates}
            rv = _SENT
            node = self.dag['edges'][node]
            if node == 'END':
                return {'done': True, 'state': state}


# ============================================================
# Samsara 外壳：效应执行层（图本身拿不到 ctx，一切副作用经此）
# ============================================================
def fake_web_search(q):
    return [f'[snippet] {q} 的资料A', f'[snippet] {q} 的资料B']


TOOLS = {'web_search': fake_web_search}


def agent_b_plugin(bctx):
    class Solver:
        def solve(self):
            return 42
    bctx.provide('solver', Solver())
agent_b_plugin.provides = ['solver']

PLUGIN_REGISTRY = {'agent_b@1': agent_b_plugin}     # 工作流按 名字@版本 引用代码（资产模型）


class SamsaraShell:
    """持有请求方 fiber 的 ctx；按 syscall 类型路由到内核原语。"""

    def __init__(self, kernel, ctx):
        self._kernel, self._ctx = kernel, ctx

    async def handle(self, req):
        kind = req['syscall']
        if kind == 'tool':          # 工具调用 = 可入账效应（K.1：read=可逆，revert 为 no-op）
            return await self._ctx.perform(
                f"tool:{req['name']}",
                lambda: TOOLS[req['name']](req['args']),
                revert=lambda: None)
        if kind == 'spawn':         # 派生 = fork + 授权代数（INV-3 完整走 QuotaPolicy）
            plugin = PLUGIN_REGISTRY[req['spec']]
            fiber = await self._ctx.fork(Plugin(plugin, name=req['name']),
                                         QuotaReq(budget=req['budget']))
            return {'fiber': fiber.plugin.name, 'ok': True}
        if kind == 'invoke':        # 跨边界服务调用同样入账（事实：谁在何时调了谁）
            svc = getattr(self._kernel.root, req['service'])   # root 消费无 inject 门禁
            fn = getattr(svc, req['method'])
            return await self._ctx.perform(
                f"invoke:{req['service']}.{req['method']}", fn, revert=lambda: None)
        raise ValueError(f'unknown syscall: {kind}')


# ============================================================
# 工作流定义：数据，不是代码（留资产版本树，L3 可演化——F.2）
# ============================================================
DAG_DEF = {
    'entry': 'plan',
    'edges': {'plan': 'search', 'search': 'spawn_solver',
              'spawn_solver': 'invoke_solver', 'invoke_solver': 'summarize',
              'summarize': 'END'},
}

trap = {'spawn_node_runs': 0}          # R2 重跑计数器：节点每（重）跑一次 +1


def n_plan(state, interrupt):
    return {'plan': ['search', 'spawn_solver', 'invoke_solver', 'summarize']}


def n_search(state, interrupt):
    snippets = interrupt({'syscall': 'tool', 'name': 'web_search', 'args': state['topic']})
    return {'snippets': snippets}


def n_spawn(state, interrupt):
    trap['spawn_node_runs'] += 1       # 节点代码会重跑——所以这只能是计数器，不能是真副作用
    r = interrupt({'syscall': 'spawn', 'name': 'agent-B', 'spec': 'agent_b@1',
                   'budget': state['spawn_budget']})
    if 'error' in r:
        return {'spawn_error': r['error']}
    return {'spawned': r['fiber']}


def n_invoke(state, interrupt):
    if 'spawn_error' in state:
        return {'answer': None}
    ans = interrupt({'syscall': 'invoke', 'service': 'solver', 'method': 'solve'})
    return {'answer': ans}


def n_summarize(state, interrupt):
    if state.get('answer') is None:
        return {'summary': f"未能完成：{state.get('spawn_error', '未知原因')}"}
    return {'summary': f"{state['topic']}：{len(state['snippets'])} 条资料，答案 {state['answer']}"}


HANDLERS = {'plan': n_plan, 'search': n_search, 'spawn_solver': n_spawn,
            'invoke_solver': n_invoke, 'summarize': n_summarize}


# ============================================================
# 驱动循环：interrupt → 外壳 → resume
# ============================================================
async def run_workflow(ctx, topic, spawn_budget):
    graph = MiniGraph(DAG_DEF, HANDLERS)
    shell = SamsaraShell(K, ctx)
    out = graph.invoke({'topic': topic, 'spawn_budget': spawn_budget})
    json.dumps(out['state'])           # R1 探针：图 state 任何时刻必须可 JSON 序列化
    while '__interrupt__' in out:
        try:
            result = await shell.handle(out['__interrupt__'])
        except QuotaExhausted as e:
            result = {'error': str(e)}  # 授权拒绝作为数据回填，由图决定降级路径
        out = graph.invoke(resume=result)
        json.dumps(out['state'])
    return out['state']


RESULTS = []
K: Kernel


async def agent_a(ctx):
    # 工作流 1：正常嵌套 Agent⇄Workflow⇄Agent
    RESULTS.append(await run_workflow(ctx, topic='Samsara 架构', spawn_budget=25))
    # 工作流 2：越权请求（spawn 预算 9999 > 父剩余 75）——必须被拒且不留账
    RESULTS.append(await run_workflow(ctx, topic='越权测试', spawn_budget=9999))


# ============================================================
# 验证
# ============================================================
async def main():
    global K
    K = Kernel(policy=QuotaPolicy())
    A = await K.load(Plugin(agent_a, name='agent-A'), request=QuotaReq(budget=100))
    s1, s2 = RESULTS

    print('== 工作流 1（正常嵌套 Agent⇄Workflow⇄Agent）==')
    print('summary:', s1['summary'])
    print('spawned:', s1.get('spawned'))
    B = A.children[0]
    print(f'预算链: A 余 {A.grant.budget.remaining}（期望 75 = 100-25）')

    print('\n== 工作流 2（越权注入尝试）==')
    print('summary:', s2['summary'])

    print('\n== 三条红线 ==')
    # R1 账本唯一权威：效应事实全部入账；图 state 全派生；哈希链完好
    descs = [e['payload'].get('desc', '') for e in K._ledger.entries
             if e['kind'] == 'effect.apply_ok']
    assert 'tool:web_search' in descs and 'invoke:solver.solve' in descs
    json.dumps(s1); json.dumps(s2)                        # 无句柄/纤维引用泄漏进图
    assert K._ledger.verify()
    print(f'R1 PASS 账本事实: {sorted(set(descs))}')
    print('         图 state 全派生（可 JSON 序列化）；账本哈希链完好')

    # R2 效应边界包裹：spawn 节点共执行 4 次（两个工作流各重跑 1 次），
    # 但 agent-B 激活恰 1 次（效应只发生在外壳里）
    assert trap['spawn_node_runs'] == 4, trap
    b_activations = [e for e in K._ledger.entries
                     if e['kind'] == 'fiber.activated' and e['owner'] == 'agent-B']
    assert len(b_activations) == 1
    print(f'R2 PASS spawn 节点共执行 {trap["spawn_node_runs"]} 次（resume 重跑语义），'
          f'agent-B 激活恰 {len(b_activations)} 次')

    # R3 派生必授权：越权 spawn(9999) 被拒；失败授权不留账
    assert 'spawn_error' in s2 and '9999' in s2['spawn_error']
    assert A.grant.budget.remaining == 75
    assert len([f for f in K._fibers if f.plugin.name == 'agent-B']) == 1  # 无泄漏纤维
    print(f'R3 PASS 越权被拒: "{s2["spawn_error"]}"')
    print('         失败授权不留账：A 预算仍 75，无泄漏纤维')

    # fork 边语义不变：kill 父 → 子级联 dispose
    await K.unload(A)
    assert B.state == 'disposed'
    print(f'\n级联语义: kill agent-A → agent-B {B.state}')
    print('\n全部断言通过：interrupt-as-syscall 三条红线在真实调用链上成立')


if __name__ == '__main__':
    asyncio.run(main())


# ============================================================
# REAL_LANGGRAPH_MAPPING：真实环境的替换点（外壳 SamsaraShell 一行不改）
# ============================================================
# from langgraph.graph import StateGraph, START, END
# from langgraph.types import interrupt, Command
# from langgraph.checkpoint.memory import MemorySaver   # 生产换 PostgresSaver
#
# builder = StateGraph(WorkflowState)                    # WorkflowState: TypedDict，全派生数据
# for name, fn in HANDLERS.items():
#     builder.add_node(name, fn)          # 节点签名 (state)->updates；interrupt 从 langgraph.types 导入
# builder.add_edge(START, 'plan')
# ...按 DAG_DEF['edges'] 连边（条件边用 add_conditional_edges）...
# graph = builder.compile(checkpointer=MemorySaver())
# cfg = {'configurable': {'thread_id': tid}}
# out = graph.invoke(initial_state, cfg)
# while '__interrupt__' in out:
#     req = out['__interrupt__'][0].value               # Interrupt 对象取 .value
#     try:    result = await shell.handle(req)          # ← 同一个 SamsaraShell
#     except QuotaExhausted as e: result = {'error': str(e)}
#     out = graph.invoke(Command(resume=result), cfg)
#
# 纪律（与 MiniGraph 相同）：节点内不得有副作用——resume 时节点从头重跑，
# interrupt() 之前的代码会再执行一遍；副作用只能活在 shell.handle 里。
