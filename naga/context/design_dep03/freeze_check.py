#!/usr/bin/env python3
"""
freeze_check.py — Samsara 冻结检查器（R3-1 的实现；v1.0 冻结门槛 #2）
==================================================================
职责：把文档治理纪律从"人工评审"转为"机器断言"。每条规则对应一类
曾在评审中存活数轮的错误；规则只增不改（additive），收紧走 RFC。

运行：python3 freeze_check.py   → 全 PASS 退出码 0，否则 1。
覆盖：版本一致性 / 货币纪律 / DDL 完备性 / 账本枚举 / 不变量注册 /
     序号命名空间 / 信任矩阵 / SDK 契约形态 / 常量注册表权威 /
     设备信任默认 / 威胁模型行 / 路线图口径 / 账本自洽 / 种子代码回归
"""

import os
import re
import subprocess
import sys

OUT = os.path.dirname(os.path.abspath(__file__))   # R7/P0-1：派生自自身位置，任何 checkout 可复现
MAIN = f'{OUT}/Samsara自进化智能体-开发文档.md'
IF = f'{OUT}/Samsara接口设计文档.md'
DM = f'{OUT}/Samsara数据模型设计文档.md'
FN = f'{OUT}/Samsara功能说明文档.md'
CONST = f'{OUT}/spec-constants.yaml'
LEDGER = f'{OUT}/closure-ledger.yaml'
KERNEL = f'{OUT}/kernel_v34.py'
DEMO = f'{OUT}/workflow_shell_demo.py'

DOC_FILES = {'主文档': MAIN, '接口设计文档': IF, '数据模型设计文档': DM, '功能说明文档': FN}
texts = {}
def T(path):
    if path not in texts:
        texts[path] = open(path, encoding='utf-8').read()
    return texts[path]

def section(text, heading):
    """取 '## X.Y' 节到下一个同级标题之间的文本。
    兼容章号带点写法（'# 12. 里程碑'）：点后必须是空白，避免 '2.3' 误配 '2.3.1'。"""
    m = re.search(rf'^#+\s*{re.escape(heading)}[\s（(].*$', text, re.M)
    if not m:
        m = re.search(rf'^#+\s*{re.escape(heading)}\.\s.*$', text, re.M)
    if not m:
        m = re.search(rf'^#+\s*{re.escape(heading)}\.?\s*$', text, re.M)
    if not m:
        return ''
    nxt = re.search(r'^#{1,2}\s', text[m.end():], re.M)
    end = m.end() + (nxt.start() if nxt else len(text) - m.end())
    return text[m.start():end]

results = []
def rule(name):
    def deco(fn):
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f'规则自身异常: {e!r}'
        results.append((name, ok, detail))
        return fn
    return deco


@rule('R01 companion_version（配套版本=主文档当前版本，A8/N4 扩展）')
def r01():
    mv = re.search(r'> 版本：v(0\.\d+)', T(MAIN)).group(1)
    bad = []
    for f in (IF, DM, FN):
        m = re.search(r'配套文档：《Samsara[^》]*》v(0\.\d+)', T(f))
        if not m or m.group(1) != mv:
            bad.append(f.split('/')[-1])
    return (not bad), f'主文档 v{mv}；过期: {bad or "无"}'


@rule('R02 usd_cents_only（禁用美元浮点，A4/INC2）')
def r02():
    hits = []
    for f in (MAIN, IF, DM, FN):
        for m in re.finditer(r'"usd"\s*:\s*\d+\.\d+', T(f)):
            hits.append(f'{f.split("/")[-1]}:{T(f)[:m.start()].count(chr(10))+1}')
    return (not hits), f'命中: {hits or "无"}'


@rule('R03 ddl_coverage+fields（正文引用表必须有 DDL；关键表带时间戳，A5/GAP3/GAP5/B10）')
def r03():
    dm = T(DM)
    tables = set(re.findall(r'CREATE TABLE (\w+)', dm))
    required = {'plugins', 'effects', 'branches', 'branch_ops', 'sessions', 'agents', 'nodes',
                'trust_edges', 'workspaces', 'skill_nodes', 'memory_items', 'promotion_requests',
                'shadow_runs', 'jobs', 'scorecards', 'ledger_entries', 'idempotency_keys',
                'review_events', 'prompt_assets', 'workflows', 'workflow_runs'}
    missing = required - tables
    mem = re.search(r'CREATE TABLE memory_items \(([^;]+)\)', dm)
    mem_ok = mem and 'created_at TEXT' in mem.group(1) and 'last_used_at TEXT' in mem.group(1)
    ses = re.search(r'CREATE TABLE sessions \(([^;]+)\)', dm)
    ses_ok = ses and 'created_at TEXT' in ses.group(1) and 'last_active_at' in ses.group(1)
    ok = not missing and mem_ok and ses_ok
    return ok, f'缺表: {missing or "无"}; memory_items 时间戳: {bool(mem_ok)}; sessions 时间戳: {bool(ses_ok)}'


@rule('R04 kind_enum（账本枚举含失败类 + 种子内核条目映射注，A6/GAP4）')
def r04():
    s = section(T(DM), '3.1')
    ok = ('effect.apply_failed' in s and 'fiber.failed' in s and 'Naga 种子内核' in s)
    return ok, '失败类 kind 与映射注存在' if ok else '缺 effect.apply_failed / fiber.failed / 映射注'


@rule('R05 inv_registry（§2.3 单一注册 INV-1~8，B11）')
def r05():
    s = section(T(MAIN), '2.3')
    missing = [f'INV-{i}' for i in range(1, 9) if f'INV-{i}' not in s]
    return (not missing), f'缺: {missing or "无"}'


@rule('R06 seq_namespace（断线补漏不走每连接序号，A3/INC8）')
def r06():
    s = section(T(IF), '2.2')
    # resume_from_seq 只允许出现在"废除"裁决记录行；任何其他语境（代码块/字段）即复活
    bad_lines = [ln.strip()[:60] for ln in s.split('\n')
                 if 'resume_from_seq' in ln and '废除' not in ln]
    ok = 'ledger_seq' in s and not bad_lines
    return ok, ('ledger_seq 在位；resume_from_seq 仅存于废除裁决记录' if ok
                else f'resume_from_seq 残留: {bad_lines[:1] or "ledger_seq 缺位"}')


@rule('R07 matrix_untrusted（untrusted 不具检索权，A2）')
def r07():
    row = next((ln for ln in T(IF).split('\n') if '只读检索' in ln and 'untrusted' not in ln), '')
    cells = [c.strip() for c in row.split('|')]
    ok = len(cells) >= 3 and cells[2] == '❌'
    return ok, f'untrusted 格 = {cells[2] if len(cells) > 2 else "?"}'


@rule('R08 sdk_forms（SDK 三形态+compensable+grant+ToolResult+compensate，A1/B9）')
def r08():
    s51, s54 = section(T(IF), '5.1'), section(T(IF), '5.4')
    need51 = ['perform', 'bracket', 'compensable', 'grant', 'fork']
    need54 = ['ToolResult', 'compensate']
    m1 = [k for k in need51 if k not in s51]
    m2 = [k for k in need54 if k not in s54]
    return (not m1 and not m2), f'§5.1 缺 {m1 or "无"}；§5.4 缺 {m2 or "无"}'


@rule('R09 constants（注册表权威可解析 + A7 必备键在位，R3-1/C1）')
def r09():
    import yaml
    doc = yaml.safe_load(T(CONST))
    bad_auth, keys = [], set()
    for k, v in doc['constants'].items():
        keys.add(k)
        auth = v.get('authority', '')
        dm_ = re.match(r'(主文档|接口设计文档|数据模型设计文档|功能说明文档)\s*(?:（[^）]*）)?\s*[§ ]\s*(.+)', auth)
        if not dm_:
            bad_auth.append(f'{k}: 无法解析 {auth!r}')
            continue
        file_, raw = DOC_FILES[dm_.group(1)], dm_.group(2).strip()
        # 抠出节号锚点：'3.4 mode.set'→'3.4'；'附录 E.7'→'E.7'（附录内节独立编号）
        mapp = re.match(r'附录\s*([A-Z](?:\.\d+)?)', raw)
        msec = re.match(r'(\d+(?:\.\d+)?)', raw)
        tok = (mapp or msec).group(1) if (mapp or msec) else None
        if tok is None:
            bad_auth.append(f'{k}: 无法定位章节 {auth!r}')
            continue
        # 章号点后须跟空白（'13.' 可、'13.2' 不误配 '13' 的锚），或直接空白/括号
        if not re.search(rf'^#+\s*{re.escape(tok)}(?:\.(?!\d)\s|[\s（(])', T(file_), re.M):
            bad_auth.append(f'{k}: {auth!r} 章节未找到')
    required = {'curator_cycle_days', 'curator_idle_hours', 'gepa_cycle_days',
                'gepa_run_cost_cap_cents', 'skill_distill_min_tool_calls', 'lane_max_count',
                'traces_hot_days', 'traces_cold_months', 'cas_orphan_gc_days',
                'snapshot_keep_recent', 'snapshot_keep_monthly', 'asset_chunk_bytes',
                'nfr_recovery_sec', 'nfr_first_token_sec', 'nfr_cost_premium_pct',
                'nfr_reconcile_diff_alert_pct'}
    missing = required - keys
    ok = not bad_auth and not missing
    return ok, f'权威不可解析: {bad_auth[:3] or "无"}；缺键: {sorted(missing) or "无"}'


@rule('R10 hello_trust（配对默认 known，owner 仅限回环首设备，B7）')
def r10():
    m = re.search(r'hello-ok[^\n]*', T(IF))
    ok = m and 'trust_level:"known"' in m.group(0)
    return bool(ok), 'hello-ok 示例 trust_level=known' if ok else 'hello-ok 示例仍为 owner 或缺失'


@rule('R11 threat_rows（rollback 抹痕 + cas_id 能力泄漏两行，D3/B1）')
def r11():
    s = section(T(MAIN), '10.1')
    ok = 'rollback' in s and '锚' in s and 'cas_id' in s
    return ok, '两行在位' if ok else '§10.1 缺 rollback 抹痕行或 cas_id 行'


@rule('R12 roadmap（人力口径 + M1/M2/M3 出口标记，D4/RM2）')
def r12():
    s = section(T(MAIN), '12')
    checks = {'人力口径': 'FTE' in s, 'M1 ReplayBundle': 'ReplayBundle' in s,
              'M2 worker 隔离': 'worker 隔离' in s, 'M3 overhead': '≤10%' in s}
    bad = [k for k, v in checks.items() if not v]
    return (not bad), f'缺: {bad or "无"}'


@rule('R13 ledger_self_count（账本汇总行=机器实数，K.9 纪律）')
def r13():
    txt = T(LEDGER)
    m = re.search(r'# 汇总\(machine\): total=(\d+) written-back=(\d+) designed=(\d+) verified=(\d+) open=(\d+)', txt)
    if not m:
        return False, '缺汇总行'
    claim = dict(zip(('total', 'written-back', 'designed', 'verified', 'open'), map(int, m.groups())))
    actual = {'total': 0, 'written-back': 0, 'designed': 0, 'verified': 0, 'open': 0}
    for ln in txt.split('\n'):
        sm = re.search(r'status: ([\w-]+)', ln)
        if ln.strip().startswith('- {id:') and sm:
            actual['total'] += 1
            actual[sm.group(1)] = actual.get(sm.group(1), 0) + 1
    return claim == actual, f'声明 {claim} vs 实际 {actual}'


@rule('R14 kernel_green（Naga 种子内核回归 T1-T27）')
def r14():
    r = subprocess.run([sys.executable, KERNEL], capture_output=True, text=True, timeout=120)
    ok = r.returncode == 0 and '全部测试通过' in r.stdout
    return ok, 'EXIT 0' if ok else (r.stderr.strip().split('\n')[-1] if r.stderr else '无输出')


@rule('R15 demo_green（interrupt-as-syscall 三红线回归）')
def r15():
    r = subprocess.run([sys.executable, DEMO], capture_output=True, text=True, timeout=120)
    ok = r.returncode == 0 and '全部断言通过' in r.stdout
    return ok, 'EXIT 0' if ok else (r.stderr.strip().split('\n')[-1] if r.stderr else '无输出')


@rule('R16 checker_self_portable（检查器自身可复现：无绝对路径字面量，R7/P0-1）')
def r16():
    src = T(f'{OUT}/freeze_check.py')
    ok = ('os.path.dirname(os.path.abspath(__file__))' in src
          and not re.search(r"OUT\s*=\s*['\"]/", src))
    return ok, 'OUT 派生自 __file__，无绝对路径赋值' if ok else 'OUT 仍为绝对路径字面量'


@rule('R17 ledger_kind_sync（内核写的 kind ⊆ 数据模型枚举区；降级事件双目录在位，R7/P1-3/P1-4）')
def r17():
    src = T(KERNEL)
    # 抓 kernel 中全部点式 kind 字面量（append 直写 + 三元分支），逐一要求在 §3.1 出现
    kinds = sorted(set(re.findall(r"'((?:effect|fiber|event|service|quota)\.[a-z_]+)'", src)))
    s31 = section(T(DM), '3.1')
    missing = [k for k in kinds if k not in s31]
    # 降级/锚定事件必须双目录在位（接口§4 事件目录 + 数据模型§3.1 枚举）
    s4 = section(T(IF), '4')
    ev_missing = [e for e in ('trust.anchor_skipped', 'trust.anchor_missing')
                  if e not in s4 or e not in s31]
    ok = not missing and not ev_missing
    return ok, (f'内核写 {len(kinds)} 种 kind，枚举区缺: {missing or "无"}；'
                f'降级事件双目录缺: {ev_missing or "无"}')


@rule('R18 ledger_target_alive（账本 R6/R7 批次 target 章节引用全部存在，R7/P2-9 + 冻结门槛#4 常驻化）')
def r18():
    led = T(LEDGER)
    bad, n = [], 0
    for ln in led.split('\n'):
        m = re.match(r'\s*- \{id: (R[67]-[\w-]+),.*target: "([^"]*)"', ln)
        if not m:
            continue
        rid, tgt = m.groups()
        n += 1
        refs = re.findall(r'(接口|主文档|数据模型|功能)(?:设计文档)?§(\d+(?:\.\d+)?)', tgt)
        refs += [('主文档', a) for a in re.findall(r'附录\s*([A-Z]\.\d+)', tgt)]
        for dk, tok in refs:
            f = {'接口': IF, '主文档': MAIN, '数据模型': DM, '功能': FN}[dk]
            if not re.search(rf'^#+\s*{re.escape(tok)}(?:\.(?!\d)\s|[\s（(:])', T(f), re.M):
                bad.append(f'{rid}: {dk}§{tok}')
    return (not bad), f'核 {n} 条；坏引用: {bad or "无"}'


if __name__ == '__main__':
    for name, ok, detail in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}\n      {detail}")
    n_fail = sum(1 for _, ok, _ in results if not ok)
    print(f'\n{len(results) - n_fail}/{len(results)} 规则通过' + ('，冻结检查器绿灯' if not n_fail else f'，{n_fail} 条红灯'))
    sys.exit(1 if n_fail else 0)
