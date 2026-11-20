"""
Cordis 风格响应式插件内核 v3.4（Samsara L0 种子代码 · Python 路线）
项目代号：Naga（那伽）——与 TS 实现 Samsara 赛马并行，文档共同上游 §13.1/§13.2
===================================================================

v3.4 主题：第六轮评审 C 类修复（运行抓出来的六个正确性缺口）。

  C1 _activate 捕获 BaseException：CancelledError 不再让 fiber 滞留 'activating'
     ——取消同样走 drain + state='failed' + fiber.failed 入账，然后重抛。
  C2 aemit 单 handler 故障隔离：失败入账 event.handler_failed（含 handler 名与
     异常），分发继续——一个坏听众不再mute后续听众。
  C3 Ledger：append 后 os.fsync（演示级崩溃持久性）；新增 Ledger.load() 重放
     校验——逐条核 seq 连续 + prev_hash 链 + hash，篡改即 AssertionError。
     持久化仍是演示级，生产以 SQLite WAL + verify() 为准（附录 B.6）。
  C4 Fiber.fid 内核分配不可变实例身份（f0001…）：账本 owner 列记 fid，
     payload.owner_name 记插件显示名——同名实例在账本上可区分（审计口径）。
  C5 QuotaPolicy.authorize：未知 trust 标签 → QuotaExhausted（不再 KeyError）；
     grant.caps 一律为副本——子改不动父、授权过程不污染请求对象。
  C6 emit 预扫描：混入 async handler 时在任何 handler 执行前拒绝；被拒绝的
     事件不留账（执行期兜底仍保留：sync 函数返回协程同样 close + raise）。

其余语义全部继承 v3.3：授权代数策略化（fork(plugin, request=None) 纯 Cordis，
内核只认 authorize/release）、emit fail-fast、反应式余效应三分类、级联停用、
单源约束、失败回滚、异步 teardown、activating 中间态、inject 门禁、效应三形态、
恰一次回放、K.1 三分类 + 审批钩子、账本哈希链/JSONL/shutdown 隔离。
仍未覆盖：lane 路由与事件 ACL（L0.5）；coeffect isolation/interception；
汇流性 hypothesis PBT；pyright strict 全量。
"""

import asyncio
import contextlib
import hashlib
import json
import os
import time
from typing import Callable, Any, Optional, Generic, TypeVar

T = TypeVar('T')

# ---- 副作用三分类（主文档 K.1 / effects.compensable）----
REVERSIBLE, COMPENSABLE, IRREVERSIBLE = 0, 1, 2


class QuotaExhausted(RuntimeError):
    """授权代数违反：预算越限或能力越权或信任抬升。"""


# ============================================================
# ServiceKey：可选类型化键（str 全兼容）
# ============================================================
class ServiceKey(Generic[T]):
    def __init__(self, name: str, type_: Optional[type] = None):
        self.name, self.type = name, type_

    def __repr__(self):
        t = getattr(self.type, '__name__', 'Any')
        return f"ServiceKey({self.name}:{t})"


def key(name: str, type_: Optional[type] = None) -> ServiceKey:
    return ServiceKey(name, type_)


def _keyname(k) -> str:
    return k.name if isinstance(k, ServiceKey) else str(k)


# ============================================================
# Ledger：追加式账本（哈希链 + 可选 JSONL 持久化 + 重放校验）
# ============================================================
class Ledger:
    GENESIS = '0' * 64

    def __init__(self, path: Optional[str] = None):
        self._entries: list[dict] = []
        self._fh = open(path, 'a', encoding='utf-8') if path else None

    @staticmethod
    def _canonical(obj: Any) -> str:
        return json.dumps(obj, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

    def append(self, kind: str, owner: str, payload: dict) -> dict:
        entry = {
            'seq': len(self._entries) + 1,
            'ts': time.time(),
            'kind': kind,
            'owner': owner,
            'payload': payload,
            'prev_hash': self._entries[-1]['hash'] if self._entries else self.GENESIS,
        }
        entry['hash'] = hashlib.sha256(self._canonical(entry).encode()).hexdigest()
        self._entries.append(entry)
        if self._fh:
            self._fh.write(self._canonical(entry) + '\n')
            self._fh.flush()
            os.fsync(self._fh.fileno())     # C3：演示级崩溃持久性
        return entry

    @property
    def entries(self) -> list[dict]:
        return list(self._entries)

    def verify(self) -> bool:
        prev = self.GENESIS
        for e in self._entries:
            if e['prev_hash'] != prev:
                return False
            body = {k: e[k] for k in ('seq', 'ts', 'kind', 'owner', 'payload', 'prev_hash')}
            if hashlib.sha256(self._canonical(body).encode()).hexdigest() != e['hash']:
                return False
            prev = e['hash']
        return True

    @classmethod
    def load(cls, path: str) -> 'Ledger':
        """C3 重放加载：读全量条目并逐条校验（seq 连续 / 链不断 / 哈希相符），
        任一不满足即 AssertionError——离线篡改在加载时检出。"""
        entries: list[dict] = []
        with open(path, encoding='utf-8') as fh:
            for line in fh:
                if line.strip():
                    entries.append(json.loads(line))
        prev = cls.GENESIS
        for i, e in enumerate(entries):
            assert e.get('seq') == i + 1, f'replay: seq 断档 at index {i}'
            assert e.get('prev_hash') == prev, f'replay: 链断裂 at seq {i + 1}'
            body = {k: e[k] for k in ('seq', 'ts', 'kind', 'owner', 'payload', 'prev_hash')}
            assert hashlib.sha256(cls._canonical(body).encode()).hexdigest() == e.get('hash'), \
                f'replay: 哈希不符 at seq {i + 1}'
            prev = e['hash']
        led = cls(path=path)
        led._entries = entries
        return led

    def close(self):
        if self._fh:
            self._fh.close()


# ============================================================
# EffectHandle：效应句柄（账本锚点）
# ============================================================
class EffectHandle:
    __slots__ = ('desc', 'seq', 'token')

    def __init__(self, desc: str, seq: int, token: str):
        self.desc, self.seq, self.token = desc, seq, token

    def __repr__(self):
        return f"<EffectHandle {self.desc!r} {self.token}@seq{self.seq}>"


# ============================================================
# Context：组件的运行上下文
# ============================================================
class Context:
    def __init__(self, kernel: 'Kernel', fiber: Optional['Fiber'] = None):
        self._kernel = kernel
        self.fiber = fiber          # 所属组件（root 为 None，管理面）
        self._disposers: list[tuple[str, int, int, Callable]] = []
        self._grant = None          # 仅 root 用；组件的 grant 挂在 fiber 上

    # ---- 授权产物（不透明）：无策略内核为 None；有策略时由 L1 解释 ----
    @property
    def grant(self):
        return self.fiber.grant if self.fiber else self._grant

    @property
    def _owner(self) -> str:
        """C4：账本 owner 列 = 不可变实例身份 fid（root 管理面记 'root'）。"""
        return self.fiber.fid if self.fiber else 'root'

    @property
    def _oname(self) -> str:
        """C4：payload.owner_name = 插件显示名（可重复，仅供人读）。"""
        return self.fiber.plugin.name if self.fiber else 'root'

    # ---- 服务消费：运行时依赖中介 + inject 门禁 + ServiceKey 兼容 ----
    def __getattr__(self, name: str):
        if name.startswith('_'):
            raise AttributeError(name)
        fiber = object.__getattribute__(self, 'fiber')
        declared = [_keyname(k) for k in fiber.plugin.inject] if fiber else []
        if fiber is not None and name not in declared:
            raise AttributeError(
                f"Service '{name}' not declared in 'inject' of '{fiber.plugin.name}' — "
                f"声明即门禁：请先在 inject 中声明再消费"
            )
        services = object.__getattribute__(self, '_kernel')._services
        if name in services:
            return services[name]
        raise AttributeError(f"Service '{name}' not found.")

    # ---- 服务提供：声明式 provides + 单源约束 + ServiceKey 类型抽检 ----
    def provide(self, k, service: Any):
        kn, fiber = _keyname(k), self.fiber
        declared = {_keyname(p) for p in fiber.plugin.provides} if fiber else set()
        if fiber is None or kn not in declared:
            raise RuntimeError(f"Component must declare '{kn}' in 'provides' before providing it")
        if kn in self._kernel._providers:
            raise RuntimeError(f"Single-source constraint violated: '{kn}' is already provided")
        if isinstance(k, ServiceKey) and k.type is not None and not isinstance(service, k.type):
            raise TypeError(f"ServiceKey type mismatch: '{kn}' expects {k.type.__name__}, "
                            f"got {type(service).__name__}")
        self._kernel._services[kn] = service
        self._kernel._providers[kn] = fiber
        self.effect(f'unprovide:{kn}', lambda: self._unprovide(kn))

    def _unprovide(self, name: str):
        self._kernel._services.pop(name, None)
        self._kernel._providers.pop(name, None)

    # ---- fork：纯 Cordis 子作用域；request 为不透明授权请求，由策略解释 ----
    async def fork(self, plugin: 'Plugin', request=None) -> 'Fiber':
        return await self._kernel._spawn_fiber(plugin, parent=self.fiber, request=request)

    # ========================================================
    # 可逆副作用 · 三形态 + 三分类（K.1）
    # ========================================================

    def _register(self, desc: str, revert: Callable, compensable: int, form: str) -> EffectHandle:
        if compensable == IRREVERSIBLE:
            self._kernel._check_approval(self._owner, desc)   # 前置审批挂点（L1 HITL）
        token = f'fx_{len(self._kernel._ledger.entries) + 1:06d}'
        e = self._kernel._ledger.append('effect.register' if form == 'register' else 'effect.apply_begin',
                                        self._owner,
                                        {'token': token, 'owner_kind': 'plugin', 'owner_id': self._owner,
                                         'owner_name': self._oname,
                                         'desc': desc, 'form': form, 'compensable': compensable,
                                         'requires_preapproval': compensable == IRREVERSIBLE,
                                         'status': 'applied'})   # 与 effects 表 schema 同形
        self._disposers.append((desc, e['seq'], compensable, revert))
        return EffectHandle(desc, e['seq'], token)

    # ---- 形态 3：登记形态 ----
    def effect(self, desc: str, revert: Callable, compensable: int = REVERSIBLE) -> EffectHandle:
        return self._register(desc, revert, compensable, 'register')

    # ---- 形态 2：perform —— 论文原型（可重放）----
    async def perform(self, desc: str, apply: Callable, revert: Callable,
                      compensable: int = REVERSIBLE):
        h = self._register(desc, revert, compensable, 'perform')
        t0 = time.monotonic()
        try:
            r = apply()
            if asyncio.iscoroutine(r):
                r = await r
        except BaseException as err:
            self._disposers.pop()
            self._kernel._ledger.append('effect.apply_failed', self._owner,
                                        {'token': h.token, 'desc': desc, 'error': repr(err),
                                         'owner_name': self._oname})
            await self._revert_once(desc, h.seq, compensable, revert)
            raise
        ms = (time.monotonic() - t0) * 1000
        self._kernel._ledger.append('effect.apply_ok', self._owner,
                                    {'token': h.token, 'desc': desc, 'ms': round(ms, 3),
                                     'owner_name': self._oname})
        return r

    # ---- 形态 1：bracket —— RAII 日常形态 ----
    @contextlib.asynccontextmanager
    async def bracket(self, desc: str, revert: Callable, compensable: int = REVERSIBLE):
        h = self._register(desc, revert, compensable, 'bracket')
        t0 = time.monotonic()
        try:
            yield h
        except BaseException as err:
            self._disposers.pop()
            self._kernel._ledger.append('effect.apply_failed', self._owner,
                                        {'token': h.token, 'desc': desc, 'error': repr(err),
                                         'owner_name': self._oname})
            await self._revert_once(desc, h.seq, compensable, revert)
            raise
        else:
            ms = (time.monotonic() - t0) * 1000
            self._kernel._ledger.append('effect.apply_ok', self._owner,
                                        {'token': h.token, 'desc': desc, 'ms': round(ms, 3),
                                         'owner_name': self._oname})

    # ---- 事件：emit 预扫描 fail-fast（同步）/ aemit（异步，故障隔离）----
    def on(self, event: str, handler: Callable):
        listeners = self._kernel._listeners.setdefault(event, [])
        listeners.append(handler)
        self.effect(f'off:{event}', lambda: handler in listeners and listeners.remove(handler))

    def emit(self, event: str, *args):
        listeners = list(self._kernel._listeners.get(event, []))
        # C6：预扫描——在任何 handler 执行前拒绝；被拒绝的事件不留账
        for h in listeners:
            if asyncio.iscoroutinefunction(h):
                raise RuntimeError(
                    f"sync emit('{event}') hit async handler {getattr(h, '__name__', h)!r} — "
                    f"use aemit() for async handlers")
        self._kernel._ledger.append('event.emit', self._owner,
                                    {'event': event, 'argc': len(args),
                                     'owner_name': self._oname})   # 载荷引用化：只记计数
        for h in listeners:
            r = h(*args)
            if asyncio.iscoroutine(r):          # 兜底：sync 函数返回协程同样大声失败
                r.close()
                raise RuntimeError(
                    f"sync emit('{event}') hit async handler {getattr(h, '__name__', h)!r} — "
                    f"use aemit() for async handlers")

    async def aemit(self, event: str, *args):
        self._kernel._ledger.append('event.emit', self._owner,
                                    {'event': event, 'argc': len(args), 'async': True,
                                     'owner_name': self._oname})
        for h in list(self._kernel._listeners.get(event, [])):
            try:
                r = h(*args)
                if asyncio.iscoroutine(r):
                    await r
            except Exception as e:              # C2：单 handler 故障隔离——入账续发
                self._kernel._ledger.append('event.handler_failed', self._owner,
                                            {'event': event,
                                             'handler': getattr(h, '__name__', repr(h)),
                                             'error': repr(e), 'owner_name': self._oname})

    # ---- 回放辅助：恰一次 + 入账；三分类决定 status 语义（reverted|compensated）----
    async def _revert_once(self, desc: str, ref_seq: int, compensable: int, revert: Callable):
        status = 'compensated' if compensable == IRREVERSIBLE else 'reverted'
        payload = {'desc': desc, 'ref_seq': ref_seq, 'status': status, 'ok': True,
                   'owner_name': self._oname}
        try:
            r = revert()
            if asyncio.iscoroutine(r):
                await r
        except Exception as e:
            payload.update(ok=False, status='failed', error=repr(e))
            self._kernel._ledger.append('effect.revert', self._owner, payload)
            raise
        self._kernel._ledger.append('effect.revert', self._owner, payload)


# ============================================================
# Service / Plugin / Fiber
# ============================================================
class Service:
    provide: str

    def __init__(self, ctx: Context):
        self.ctx = ctx
        ctx.provide(self.provide, self)


class Plugin:
    """组件 = 声明依赖(inject) + 声明提供(provides) + 效应函数(apply_fn)"""
    def __init__(self, apply_fn, inject=(), provides=(), name=None):
        self.apply_fn = apply_fn
        self.inject = list(inject) or list(getattr(apply_fn, 'inject', []))
        self.provides = list(provides) or list(getattr(apply_fn, 'provides', []))
        self.name = name or getattr(apply_fn, '__name__', repr(apply_fn))


class Fiber:
    """组件实例：waiting -> activating -> active -> (waiting | disposed | failed)；fork 树节点。
    C4：fid 内核分配的不可变实例身份（f0001…）——plugin.name 只是显示名，可重复。
    grant：授权产物（无策略内核为 None），dispose 时由策略回收。"""
    def __init__(self, kernel: 'Kernel', plugin: Plugin, parent: Optional['Fiber'] = None,
                 grant=None, fid: str = ''):
        self.kernel, self.plugin = kernel, plugin
        self.fid = fid
        self.parent = parent
        self.children: list[Fiber] = []
        self.grant = grant
        self.state = 'waiting'
        self.ctx: Optional[Context] = None
        self.error: Optional[BaseException] = None

    def __repr__(self):
        return f"<Fiber {self.fid} {self.plugin.name} [{self.state}]>"


# ============================================================
# Kernel：注册表 + 反应式规则（策略钩子：只认 authorize/release 接口）
# ============================================================
class Kernel:
    def __init__(self, ledger: Optional[Ledger] = None, approval: Optional[Callable] = None,
                 policy=None):
        self._services: dict[str, Any] = {}
        self._providers: dict[str, Fiber] = {}
        self._listeners: dict[str, list[Callable]] = {}
        self._fibers: list[Fiber] = []
        self._ledger = ledger or Ledger()
        self._approval = approval            # IRREVERSIBLE 前置审批钩子（L1 HITL 挂点）
        self._policy = policy                # 授权策略钩子（L1 Spawner 挂点；None=纯 L0）
        self._fid_seq = 0                    # C4：fid 计数器（单调不退，卸载不复用）
        self.root = Context(self)
        if policy is not None:
            self.root._grant = policy.root_grant()

    def _check_approval(self, owner: str, desc: str):
        if self._approval is not None and not self._approval(owner, desc):
            raise PermissionError(f'IRREVERSIBLE effect requires pre-approval: {owner}:{desc}')

    def _release_grant(self, fiber: Fiber):
        if self._policy is not None and fiber.grant is not None:
            self._policy.release(fiber.grant)
            fiber.grant = None

    async def _spawn_fiber(self, plugin: Plugin, parent: Optional[Fiber] = None,
                           request=None) -> Fiber:
        grant = None
        if self._policy is not None:
            pg = parent.grant if parent is not None else self.root.grant
            grant = self._policy.authorize(pg, request, plugin)   # 拒则抛，无 fiber 产生
        self._fid_seq += 1                                        # C4：授权通过才占号
        fiber = Fiber(self, plugin, parent=parent, grant=grant, fid=f'f{self._fid_seq:04d}')
        if parent is not None:
            parent.children.append(fiber)
        self._fibers.append(fiber)
        await self._reconcile()
        return fiber

    async def load(self, plugin: Plugin, request=None) -> Fiber:
        return await self._spawn_fiber(plugin, parent=None, request=request)

    async def unload(self, fiber: Fiber):
        if fiber.state == 'disposed':
            return
        await self._deactivate(fiber, permanent=True)
        if fiber.parent is not None and fiber in fiber.parent.children:
            fiber.parent.children.remove(fiber)
        self._fibers.remove(fiber)

    async def shutdown(self):
        errors = []
        for f in list(self._fibers):
            try:
                await self.unload(f)
            except Exception as e:                      # noqa: BLE001 — 清理路径必须隔离
                errors.append(e)
        if errors:
            raise ExceptionGroup('shutdown errors', errors)

    def pending(self):
        return [(f.plugin.name, [k for k in f.plugin.inject if k not in self._services])
                for f in self._fibers if f.state == 'waiting']

    # ---- 论文 §3 显式化：上下文变化按 coeffect 规格分类 ----
    def _classify(self, fiber: Fiber) -> str:
        """activating：依赖就绪待激活；deactivating：依赖缺失仍活跃；neutral：其余。"""
        ready = all(_keyname(k) in self._services for k in fiber.plugin.inject)
        if fiber.state == 'waiting' and ready:
            return 'activating'
        if fiber.state in ('active', 'activating') and not ready:
            return 'deactivating'
        return 'neutral'

    async def _reconcile(self):
        progressed = True
        while progressed:
            progressed = False
            for f in list(self._fibers):
                if self._classify(f) == 'activating':
                    await self._activate(f)
                    progressed = True

    async def _activate(self, fiber: Fiber):
        fiber.state = 'activating'
        ctx = Context(self, fiber=fiber)
        fiber.ctx = ctx
        try:
            result = fiber.plugin.apply_fn(ctx)
            if asyncio.iscoroutine(result):
                await result
            missing = [k for k in fiber.plugin.provides
                       if self._providers.get(_keyname(k)) is not fiber]
            if missing:
                raise RuntimeError(f'declared provides not fulfilled: {missing}')
        except BaseException as e:     # C1：含 CancelledError——取消不得滞留 'activating'
            await self._drain(ctx)
            fiber.state, fiber.error, fiber.ctx = 'failed', e, None
            self._ledger.append('fiber.failed', fiber.fid,
                                {'error': repr(e), 'owner_name': fiber.plugin.name})
            raise
        fiber.state = 'active'
        self._ledger.append('fiber.activated', fiber.fid,
                            {'owner_name': fiber.plugin.name,
                             'provides': [_keyname(p) for p in fiber.plugin.provides],
                             'fork_of': fiber.parent.fid if fiber.parent else None})

    async def _deactivate(self, fiber: Fiber, permanent=False):
        """级联顺序：fork 后代 → 服务依赖方 → 自身逆操作回放 → 授权回收。"""
        if fiber.state not in ('active', 'activating', 'failed'):
            fiber.state = 'disposed' if permanent else 'waiting'
            if permanent:
                self._release_grant(fiber)      # waiting 纤维也持有授权，必须回收
            return
        for ch in list(fiber.children):                     # Cordis 血统：fork 后代随父级联
            await self._deactivate(ch, permanent=True)
            fiber.children.remove(ch)
            if ch in self._fibers:
                self._fibers.remove(ch)
        dependents = [f for f in self._fibers
                      if f.state in ('active', 'activating')
                      and any(_keyname(k) in [_keyname(i) for i in f.plugin.inject]
                              for k in fiber.plugin.provides)]
        for d in dependents:
            await self._deactivate(d)
        if fiber.ctx is not None:
            errors = await self._drain(fiber.ctx)
            if errors:
                raise ExceptionGroup(f'dispose errors in {fiber.plugin.name}', errors)
        fiber.ctx = None
        fiber.state = 'disposed' if permanent else 'waiting'
        self._release_grant(fiber)                          # 策略回收授权（如配额归还）
        self._ledger.append('fiber.deactivated', fiber.fid,
                            {'permanent': permanent, 'owner_name': fiber.plugin.name})

    async def _drain(self, ctx: Context):
        errors = []
        while ctx._disposers:
            desc, apply_seq, compensable, revert = ctx._disposers.pop()
            try:
                await ctx._revert_once(desc, apply_seq, compensable, revert)
            except Exception as e:
                errors.append(e)
        return errors


# ============================================================
# L1 参考策略：QuotaPolicy（授权代数 INV-3 的种子实现）
# 注意：以下是 L1 Spawner 侧代码，内核不依赖它；换策略不动内核。
# ============================================================
TRUST_RANK = {'owner': 0, 'known': 1, 'guest': 2, 'untrusted': 3}


class Budget:
    """树状配额账户：allocate 从父划走 / consume 消耗 / release 归还父。"""
    def __init__(self, tokens: int, _parent: Optional['Budget'] = None):
        self.total, self.used = tokens, 0
        self._parent = _parent

    @property
    def remaining(self) -> int:
        return self.total - self.used

    def consume(self, amount: int):
        if amount > self.remaining:
            raise QuotaExhausted(f'budget exhausted: need {amount}, remaining {self.remaining}')
        self.used += amount

    def allocate(self, child_tokens: int) -> 'Budget':
        if child_tokens >= self.remaining:
            raise QuotaExhausted(
                f'child budget {child_tokens} must be < parent remaining {self.remaining}')
        self.used += child_tokens
        return Budget(child_tokens, _parent=self)

    def release(self):
        if self._parent is not None:
            self._parent.used -= self.total - self.used
            self._parent = None


class QuotaReq:
    """fork/load 的不透明授权请求：要多少预算、哪些能力、什么信任级。"""
    __slots__ = ('budget', 'caps', 'trust')

    def __init__(self, budget: Optional[int] = None, caps: Optional[set] = None,
                 trust: Optional[str] = None):
        self.budget, self.caps, self.trust = budget, caps, trust


class QuotaGrant:
    """授权产物：fiber 携带；release 归还配额。"""
    __slots__ = ('budget', 'caps', 'trust')

    def __init__(self, budget: Optional[Budget], caps: Optional[set], trust: str):
        self.budget, self.caps, self.trust = budget, caps, trust

    def release(self):
        if self.budget is not None:
            self.budget.release()


class QuotaPolicy:
    """授权代数（主文档 INV-3）：capabilities ⊆ 父、配额 child < parent.remaining、
    信任只降不升。内核只调 root_grant/authorize/release 三个方法。"""

    def __init__(self, root_budget: Optional[int] = None, root_caps: Optional[set] = None,
                 root_trust: str = 'owner'):
        self._root = QuotaGrant(Budget(root_budget) if root_budget else None,
                                root_caps, root_trust)

    def root_grant(self) -> QuotaGrant:
        return self._root

    def authorize(self, parent: QuotaGrant, req: Optional[QuotaReq], plugin) -> QuotaGrant:
        req = req or QuotaReq()
        # 纪律：全部校验先行，状态变更（allocate）最后发生——失败的授权不得留账
        # 能力：子 ⊆ 父（父 None 表示全集）；C5：grant.caps 一律副本，父子/请求互不污染
        caps = set(req.caps) if req.caps is not None \
            else (set(parent.caps) if parent.caps is not None else None)
        if parent.caps is not None and caps is not None and not caps <= parent.caps:
            raise QuotaExhausted(f'child caps {caps} not ⊆ parent {parent.caps}')
        # 信任：只降不升（ratchet）；C5：未知标签先拦下（不再 KeyError）
        trust = req.trust or parent.trust
        if trust not in TRUST_RANK:
            raise QuotaExhausted(f'unknown trust label: {trust!r}')
        if TRUST_RANK[trust] < TRUST_RANK[parent.trust]:
            raise QuotaExhausted(f'trust ratchet: cannot raise {parent.trust} -> {trust}')
        # 配额：父有限则必须从父划走；父无限则按请求开立
        if parent.budget is not None:
            if req.budget is None:
                raise QuotaExhausted('parent budgeted: request.budget required')
            budget = parent.budget.allocate(req.budget)
        else:
            budget = Budget(req.budget) if req.budget is not None else None
        return QuotaGrant(budget, caps, trust)

    def release(self, grant: QuotaGrant):
        grant.release()


# ============================================================
# 演示插件
# ============================================================
class Counter(Service):
    provide = 'counter'

    def __init__(self, ctx):
        super().__init__(ctx)
        self.value = 0

    def next(self):
        self.value += 1
        return self.value


def counter_plugin(ctx):
    Counter(ctx)
counter_plugin.provides = ['counter']


class Greeter(Service):
    provide = 'greeter'

    def __init__(self, ctx):
        super().__init__(ctx)
        self.count = 0


def greeter_plugin(ctx):
    g = Greeter(ctx)

    def on_ready(msg):
        g.count += 1
        print(f"[greeter] {msg} #{ctx.counter.next()}")
    ctx.on('app/ready', on_ready)
greeter_plugin.inject = ['counter']
greeter_plugin.provides = ['greeter']


def announcer_plugin(ctx):
    ctx.on('app/ready', lambda msg: print(f"[announcer] greeter total: {ctx.greeter.count}"))
announcer_plugin.inject = ['greeter']


def logger_plugin(ctx):
    ctx.on('app/ready', lambda msg: print(f"[logger] event received: {msg}"))


# ============================================================
# 验证套件
# T1–T15：无策略内核（纯 L0，零配额机制）——证明 L0 不依赖授权概念
# T16–T18：挂 QuotaPolicy（L1 种子）的授权代数
# T19：ServiceKey 抽检；T20：aemit；T21：emit fail-fast
# T22–T27：v3.4 C 类修复的回归钉（每个 C 至少一颗）
# ============================================================
import io, warnings


def captured(fn, *args):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        fn(*args)
    return buf.getvalue()


def observable_state(k: Kernel):
    return {
        'services': sorted(k._services),
        'listeners': {e: len(h) for e, h in k._listeners.items()},
        'active': sorted(f.plugin.name for f in k._fibers if f.state == 'active'),
    }


def kinds_of(k: Kernel, kind: str) -> list[dict]:
    return [e for e in k._ledger.entries if e['kind'] == kind]


async def main():
    # ---- T1+T2+T3+T4 ----
    kh = Kernel()
    await kh.load(Plugin(logger_plugin))
    g = await kh.load(Plugin(greeter_plugin))
    a = await kh.load(Plugin(announcer_plugin))
    assert g.state == a.state == 'waiting'
    c = await kh.load(Plugin(counter_plugin))
    assert g.state == a.state == 'active'
    print('T1 顺序无关 + 自动激活: PASS')

    await kh.unload(c)
    assert g.state == a.state == 'waiting'
    quiet = captured(kh.root.emit, 'app/ready', 'quiet')
    assert quiet == '[logger] event received: quiet\n'
    print('T2 反应式级联停用(含传递): PASS')

    await kh.load(Plugin(counter_plugin))
    assert g.state == a.state == 'active'
    print('T3 依赖回归自动重载: PASS')

    ks = Kernel()
    await ks.load(Plugin(logger_plugin))
    await ks.load(Plugin(counter_plugin))
    await ks.load(Plugin(greeter_plugin))
    await ks.load(Plugin(announcer_plugin))
    assert observable_state(kh) == observable_state(ks)
    assert captured(kh.root.emit, 'app/ready', 'probe') == captured(ks.root.emit, 'app/ready', 'probe')
    print('T4 经验性汇合(演化历史终态 == 从头装配): PASS')

    # ---- T5 ----
    class DB1(Service): provide = 'db'
    class DB2(Service): provide = 'db'
    def db1(ctx): DB1(ctx)
    db1.provides = ['db']
    def db2(ctx): DB2(ctx)
    db2.provides = ['db']
    k5 = Kernel()
    await k5.load(Plugin(db1))
    try:
        await k5.load(Plugin(db2))
        raise AssertionError('T5')
    except RuntimeError as e:
        assert 'Single-source' in str(e)
    assert isinstance(k5._services['db'], DB1)
    print('T5 单源约束: PASS')

    # ---- T6 ----
    def bad_plugin(ctx):
        ctx.on('app/ready', lambda msg: print('ghost'))
        raise RuntimeError('boom')
    k6 = Kernel()
    before = len(k6._listeners.get('app/ready', []))
    try:
        await k6.load(Plugin(bad_plugin))
    except RuntimeError:
        pass
    assert len(k6._listeners.get('app/ready', [])) == before
    print('T6 失败回滚: PASS')

    # ---- T7 ----
    cleaned = []
    async def async_plugin(ctx):
        await asyncio.sleep(0)
        async def cleanup():
            await asyncio.sleep(0)
            cleaned.append('done')
        ctx.effect('demo-cleanup', cleanup)
    k7 = Kernel()
    f7 = await k7.load(Plugin(async_plugin))
    await k7.unload(f7)
    assert cleaned == ['done']
    print('T7 异步 apply + 异步 teardown: PASS')

    # ---- T8 ----
    def rogue(ctx):
        ctx.provide('nope', object())
    k8 = Kernel()
    try:
        await k8.load(Plugin(rogue))
        raise AssertionError('T8')
    except RuntimeError as e:
        assert 'must declare' in str(e)
    print('T8 声明式 provides: PASS')

    # ---- T9 ----
    count = 0
    async def slow(ctx):
        nonlocal count
        count += 1
        await asyncio.sleep(0.05)
    async def other(ctx):
        await asyncio.sleep(0.05)
    k9 = Kernel()
    await asyncio.gather(k9.load(Plugin(slow)), k9.load(Plugin(other)))
    assert count == 1
    print('T9 activating 中间态(并发激活恰一次): PASS')

    # ---- T10 ----
    async def rogue_consumer(ctx):
        _ = ctx.counter
    k10 = Kernel()
    await k10.load(Plugin(counter_plugin))
    try:
        await k10.load(Plugin(rogue_consumer))
        raise AssertionError('T10')
    except AttributeError as e:
        assert 'not declared' in str(e)
    print('T10 inject 门禁: PASS')

    # ---- T11 ----
    kinds = [e['kind'] for e in kh._ledger.entries]
    assert 'effect.register' in kinds and 'effect.revert' in kinds
    assert kh._ledger.verify()
    victim = kh._ledger.entries[1]
    orig = victim['payload']
    victim['payload'] = {'tampered': True}
    assert not kh._ledger.verify()
    victim['payload'] = orig
    assert kh._ledger.verify()
    print('T11 效应入账 + 哈希链 + 篡改可检: PASS')

    # ---- T12 ----
    path = '/tmp/kernel_v34_ledger_test.log'
    if os.path.exists(path):
        os.remove(path)
    led = Ledger(path=path)
    k12 = Kernel(ledger=led)
    fx = await k12.load(Plugin(counter_plugin))
    await k12.unload(fx)
    led.close()
    with open(path, encoding='utf-8') as fh:
        lines = [json.loads(x) for x in fh if x.strip()]
    assert len(lines) == len(led.entries)
    os.remove(path)
    print('T12 账本 JSONL 持久化: PASS')

    # ---- T13（perform）----
    reverts, applies = [], []
    async def t13(ctx):
        async def do():
            applies.append(1)
            return 'result-42'
        r = await ctx.perform('t13-op', do, lambda: reverts.append(1))
        assert r == 'result-42'
    k13 = Kernel()
    f13 = await k13.load(Plugin(t13))
    assert len(applies) == 1 and not reverts
    assert kinds_of(k13, 'effect.apply_ok')
    await k13.unload(f13)
    assert reverts == [1]
    print('T13 perform 三参数: PASS')

    # ---- T13b（perform 失败恰一次）----
    reverts_b = []
    async def t13b(ctx):
        try:
            await ctx.perform('t13b-op', lambda: 1/0, lambda: reverts_b.append(1))
        except ZeroDivisionError:
            pass
        assert reverts_b == [1]
        await ctx.perform('t13b-op2', lambda: 'ok', lambda: reverts_b.append(1))
    k13b = Kernel()
    f13b = await k13b.load(Plugin(t13b))
    await k13b.unload(f13b)
    assert reverts_b == [1, 1]
    print('T13b perform 失败(立即回放恰一次,drain 不二次): PASS')

    # ---- T14（bracket）----
    state_box = {'n': 0}
    reverts_c = []
    async def t14(ctx):
        async with ctx.bracket('t14-op', lambda: reverts_c.append(1)):
            state_box['n'] += 1
        async with ctx.bracket('t14-bad', lambda: reverts_c.append(2)):
            state_box['n'] += 1
            raise ValueError('inner boom')
    k14 = Kernel()
    try:
        await k14.load(Plugin(t14))
        raise AssertionError('T14')
    except ValueError:
        pass
    assert state_box['n'] == 2 and reverts_c == [2, 1]
    assert kinds_of(k14, 'effect.apply_failed')
    print('T14 bracket(裸写+失败自清+drain 衔接): PASS')

    # ---- T15（可重放）----
    replay_count = []
    async def t15(ctx):
        async def deploy():
            replay_count.append('run')
            return 'v1'
        await ctx.perform('deploy', deploy, lambda: None)
        assert await deploy() == 'v1'
    k15 = Kernel()
    await k15.load(Plugin(t15))
    assert replay_count == ['run', 'run']
    print('T15 perform 可重放(影子对打地基): PASS')

    # ================= 以下挂 QuotaPolicy：L1 授权代数 =================

    # ---- T16（fork 纯 Cordis + 策略化授权代数）----
    k16 = Kernel(policy=QuotaPolicy())          # root：无限预算/全集能力/owner
    async def parent_p(ctx):
        async def child_job(cctx):
            cctx.on('app/ready', lambda m: None)
        child = await ctx.fork(Plugin(child_job, name='child'), QuotaReq(budget=50))
        assert child.state == 'active', 'T16: 子应激活'
        assert ctx.grant.budget.remaining == 50, 'T16: fork 应从父划走 50'
        try:
            await ctx.fork(Plugin(child_job, name='c2'), QuotaReq(budget=10, caps={'fs', 'net'}))
            raise AssertionError('T16: caps 越权应被拒')
        except QuotaExhausted:
            pass
        try:
            await ctx.fork(Plugin(child_job, name='c3'), QuotaReq(budget=60))
            raise AssertionError('T16: 配额越限应被拒')
        except QuotaExhausted:
            pass
        await ctx.fork(Plugin(child_job, inject=['never'], name='cwait'), QuotaReq(budget=20))
        assert ctx.grant.budget.remaining == 30, 'T16: 等待态子也应划走配额'
    pf = await k16.load(Plugin(parent_p, name='parent'),
                        QuotaReq(budget=100, caps={'fs'}, trust='guest'))
    ch = pf.children[0]
    pfb = pf.grant.budget
    try:
        await ch.ctx.fork(Plugin(lambda c: None, name='c4'), QuotaReq(budget=10, trust='owner'))
        raise AssertionError('T16: 信任抬升应被拒')
    except QuotaExhausted as e:
        assert 'ratchet' in str(e)
    assert ch.ctx.grant.budget.remaining == 50, 'T16: 失败的授权不得留账（allocate 必须在全部校验之后）'
    await k16.unload(pf)
    assert ch.state == 'disposed', 'T16: 父 dispose 应级联子 dispose（Cordis 血统）'
    assert all(f.state == 'disposed' for f in (pf, ch)), 'T16'
    assert pfb.remaining == 100, 'T16: 含等待态子的授权全部归还，链路无余账'
    assert pf.grant is None, 'T16: 授权已回收'
    print('T16 fork(纯 Cordis 语义)+QuotaPolicy(caps⊆/配额划走归还/信任ratchet/等待态回收): PASS')

    # ---- T17（Budget 账户：consume 越限即拒）----
    b = Budget(30)
    b.consume(20)
    try:
        b.consume(20)
        raise AssertionError('T17')
    except QuotaExhausted:
        pass
    assert b.remaining == 10
    print('T17 配额消耗越限即拒: PASS')

    # ---- T18（三分类 + 前置审批钩子 + compensated 语义）----
    approvals = []
    def approval_hook(owner, desc):
        approvals.append(desc)
        return desc != 'nuke'
    k18 = Kernel(approval=approval_hook)
    async def t18(ctx):
        await ctx.perform('safe-write', lambda: 1, lambda: None, compensable=COMPENSABLE)
        try:
            await ctx.perform('nuke', lambda: 1, lambda: None, compensable=IRREVERSIBLE)
            raise AssertionError('T18: 未批 IRREVERSIBLE 应被拒')
        except PermissionError:
            pass
        await ctx.perform('drop-temp', lambda: 1, lambda: None, compensable=IRREVERSIBLE)
    f18 = await k18.load(Plugin(t18))
    assert approvals == ['nuke', 'drop-temp']
    await k18.unload(f18)
    rev_entries = kinds_of(k18, 'effect.revert')
    statuses = {e['payload']['desc']: e['payload']['status'] for e in rev_entries}
    assert statuses.get('drop-temp') == 'compensated' and statuses.get('safe-write') == 'reverted', \
        f'T18: 三分类回放语义错误: {statuses}'
    print('T18 三分类(审批钩子拒/批 + reverted|compensated 语义): PASS')

    # ---- T19（ServiceKey 类型抽检）----
    k19 = Kernel()
    async def t19a(ctx):
        ctx.provide(key('answer', int), 42)
    t19a.provides = [key('answer', int)]
    await k19.load(Plugin(t19a))
    async def t19b(ctx):
        ctx.provide(key('name', str), 123)
    t19b.provides = [key('name', str)]
    try:
        await k19.load(Plugin(t19b))
        raise AssertionError('T19')
    except TypeError:
        pass
    assert k19._services['answer'] == 42
    print('T19 ServiceKey 类型化键(isinstance 抽检): PASS')

    # ---- T20（aemit 异步事件 + 事件入账）----
    seen = []
    k20 = Kernel()
    async def t20(ctx):
        async def slow_handler(msg):
            await asyncio.sleep(0)
            seen.append(('slow', msg))
        ctx.on('e/x', slow_handler)
        ctx.on('e/x', lambda msg: seen.append(('fast', msg)))
    await k20.load(Plugin(t20))
    await k20.root.aemit('e/x', 'hello')
    assert seen == [('slow', 'hello'), ('fast', 'hello')], f'T20: 注册序异步执行: {seen}'
    ev = [e for e in k20._ledger.entries if e['kind'] == 'event.emit']
    assert ev and ev[-1]['payload']['argc'] == 1 and 'hello' not in json.dumps(ev[-1]), \
        'T20: 事件入账且载荷引用化（不记内容）'
    print('T20 aemit 异步事件(注册序 await + 入账引用化): PASS')

    # ---- T21（emit fail-fast：同步 emit 遇 async handler 大声失败）----
    k21 = Kernel()
    ran21 = []
    async def t21(ctx):
        async def h(msg):
            ran21.append(msg)
        ctx.on('e/z', h)
    await k21.load(Plugin(t21))
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter('always')
        try:
            k21.root.emit('e/z', 'boom')
            raise AssertionError('T21: 应 fail-fast')
        except RuntimeError as e:
            assert 'aemit' in str(e), f'T21: 错误信息应指向 aemit: {e}'
    assert ran21 == [], 'T21: async handler 不应被静默执行一半'
    assert not [x for x in w if issubclass(x.category, RuntimeWarning)], \
        'T21: 协程未创建即被拒，不应有 RuntimeWarning'
    print('T21 emit fail-fast(预扫描拒绝 + 无 RuntimeWarning): PASS')

    # ================= v3.4 C 类修复的回归钉 =================

    # ---- T22（C1：激活期取消 → failed + drain + fiber.failed 入账）----
    k22 = Kernel()
    gate22 = asyncio.Event()   # 永不就绪的闸门
    async def slow_gate(ctx):
        await gate22.wait()
    task22 = asyncio.create_task(k22.load(Plugin(slow_gate, name='slow')))
    await asyncio.sleep(0.05)
    f22 = k22._fibers[-1]
    assert f22.state == 'activating', f'T22: 前置状态应为 activating，实得 {f22.state}'
    task22.cancel()
    try:
        await task22
        raise AssertionError('T22: 取消的 load 不应正常返回')
    except asyncio.CancelledError:
        pass
    assert f22.state == 'failed', f'T22: 取消后应为 failed，实得 {f22.state}'
    failed_entries = kinds_of(k22, 'fiber.failed')
    assert failed_entries and 'CancelledError' in failed_entries[-1]['payload']['error'], \
        'T22: fiber.failed 必须入账且记录取消原因'
    print('T22 C1 激活期取消(不滞留 activating + failed 入账): PASS')

    # ---- T23（C2：aemit 单 handler 故障隔离）----
    k23 = Kernel()
    hits23 = []
    async def t23(ctx):
        async def bad(msg):
            raise RuntimeError('handler boom')
        async def good(msg):
            hits23.append(msg)
        ctx.on('iso', bad)
        ctx.on('iso', good)
    await k23.load(Plugin(t23))
    await k23.root.aemit('iso', 'x')
    assert hits23 == ['x'], f'T23: 坏 handler 不得阻断后续分发: {hits23}'
    hf = kinds_of(k23, 'event.handler_failed')
    assert len(hf) == 1 and 'handler boom' in hf[0]['payload']['error'] \
        and hf[0]['payload']['handler'] == 'bad', f'T23: 故障须入账: {hf}'
    print('T23 C2 aemit 故障隔离(坏 handler 入账 + 分发继续): PASS')

    # ---- T24（C3：Ledger.load 重放校验 + 离线篡改检出）----
    path24 = '/tmp/kernel_v34_ledger_t24.log'
    if os.path.exists(path24):
        os.remove(path24)
    led24 = Ledger(path=path24)
    k24 = Kernel(ledger=led24, policy=QuotaPolicy())
    fx24 = await k24.load(Plugin(counter_plugin), QuotaReq(budget=10))
    await k24.unload(fx24)
    n24 = len(led24.entries)
    led24.close()
    led24b = Ledger.load(path24)                    # 重放：内部已逐条校验
    assert len(led24b.entries) == n24, 'T24: 重放条目数应一致'
    assert led24b.verify(), 'T24: 重放后 verify 应通过'
    assert [e['seq'] for e in led24b.entries] == list(range(1, n24 + 1)), 'T24: seq 连续'
    led24b.close()
    # 篡改第一行 payload → load 必须检出
    with open(path24, encoding='utf-8') as fh:
        raw = fh.read().splitlines()
    e0 = json.loads(raw[0])
    e0['payload']['tampered'] = True
    raw[0] = Ledger._canonical(e0)
    with open(path24, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(raw) + '\n')
    try:
        Ledger.load(path24)
        raise AssertionError('T24: 篡改必须检出')
    except AssertionError as e:
        assert 'replay' in str(e), f'T24: 检出信息应定位条目: {e}'
    os.remove(path24)
    print('T24 C3 账本重放加载 + 篡改检出: PASS')

    # ---- T25（C4：fid 不可变身份——同名实例账本可区分）----
    k25 = Kernel()
    async def dup(ctx):
        pass
    f25a = await k25.load(Plugin(dup, name='dup'))
    f25b = await k25.load(Plugin(dup, name='dup'))
    assert f25a.fid != f25b.fid, 'T25: 同名实例 fid 必须不同'
    assert f25a.plugin.name == f25b.plugin.name == 'dup'
    act = [e for e in kinds_of(k25, 'fiber.activated')
           if e['payload'].get('owner_name') == 'dup']
    owners = {e['owner'] for e in act}
    assert owners == {f25a.fid, f25b.fid}, f'T25: 账本 owner 列应为两个不同 fid: {owners}'
    await k25.unload(f25a)
    f25c = await k25.load(Plugin(dup, name='dup'))
    assert f25c.fid not in (f25a.fid, f25b.fid), 'T25: fid 单调不退，卸载不复用'
    print('T25 C4 fid 不可变身份(同名可区分 + 单调不退): PASS')

    # ---- T26（C5：非法 trust → QuotaExhausted；caps 副本互不污染）----
    k26 = Kernel(policy=QuotaPolicy(root_budget=100, root_caps={'fs'}, root_trust='known'))
    async def t26(ctx):
        try:
            await ctx.fork(Plugin(lambda c: None, name='x'), QuotaReq(budget=10, trust='superuser'))
            raise AssertionError('T26: 非法 trust 应被拒')
        except QuotaExhausted as e:
            assert 'trust' in str(e), f'T26: 拒绝原因应点名 trust: {e}'
        req = QuotaReq(budget=10, caps={'fs'})
        child = await ctx.fork(Plugin(lambda c: None, name='c26'), req)
        assert child.grant.caps is not req.caps, 'T26: grant.caps 不得别名请求对象'
        child.grant.caps.discard('fs')              # 若是共享引用，这会伤到父与请求
        assert req.caps == {'fs'}, 'T26: 授权过程不得污染请求对象'
        assert ctx.grant.caps == {'fs'}, 'T26: 子的改动不得伤到父'
    f26 = await k26.load(Plugin(t26, name='p26'), QuotaReq(budget=50, caps={'fs'}))
    print('T26 C5 trust 标签校验 + caps 副本隔离: PASS')

    # ---- T27（C6：emit 预扫描——混入 async 时任何 handler 都不执行、事件不留账）----
    k27 = Kernel()
    hits27 = []
    async def t27(ctx):
        def sh(msg):
            hits27.append('sync')
        async def ah(msg):
            hits27.append('async')
        ctx.on('mix', sh)
        ctx.on('mix', ah)
    await k27.load(Plugin(t27))
    n_before = len(k27._ledger.entries)
    try:
        k27.root.emit('mix', 'boom')
        raise AssertionError('T27: 应 fail-fast')
    except RuntimeError as e:
        assert 'aemit' in str(e)
    assert hits27 == [], f'T27: 预扫描拒绝——同步 handler 也不得执行: {hits27}'
    assert not kinds_of(k27, 'event.emit'), 'T27: 被拒绝的事件不留账'
    assert len(k27._ledger.entries) == n_before, 'T27: 账本零增长'
    print('T27 C6 emit 预扫描(零执行 + 零留账): PASS')

    await kh.shutdown()
    await ks.shutdown()
    assert not kh._services and not ks._services
    kh._ledger.close()
    ks._ledger.close()
    print('\n全部测试通过(T1-T27)。shutdown 后注册表已完全还原。')


def test_kernel():
    """pytest 入口（C7 配套：与 __main__ 同一套件）。"""
    asyncio.run(main())


if __name__ == '__main__':
    asyncio.run(main())
