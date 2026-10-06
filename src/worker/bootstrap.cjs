// Worker 隔离引导(附录 K.3 M2 行:外部来源插件一律入子进程)
// 本文件刻意保持纯 JavaScript(CJS)——它是 fork 的子进程入口,不依赖任何 TS 加载器;
// 外部生态插件(MCP/市场技能)亦为 JS 交付,与宿主 TS 代码库天然分离。
//
// 协议(结构化克隆边界;fork IPC 默认 JSON 序列化——函数/引用永不过界):
//   宿主→worker: start{manifest} / svc-call{id,service,method,args} / fx-run{id,fxId,op,captured}
//                / host-result{id,ok,value|error} / stop
//   worker→宿主: ready{error?} / provide{service} / svc-result{id,ok,value|error}
//                / fx{id,fxId,desc,rClass,rebindArgs?,preapproval?} / emit{evt}
//                / host-call{id,service,method,args}
// 安全性质:worker 内代码拿不到宿主对象(内核/账本/服务实现)——唯一通道是本协议
// 白名单;效应的账本落款永远发生在宿主侧(apply/revert 代码在 worker 执行)。

"use strict";

async function main() {
  const pluginPath = process.argv[2];
  if (!pluginPath) process.exit(2);

  const pending = new Map(); // id → {resolve, reject}(worker→宿主 rpc)
  let callSeq = 0;

  const send = (msg) => { try { process.send(msg); } catch { /* 宿主已离去 */ } };
  const rpcToHost = (msg) => new Promise((resolve, reject) => {
    const id = `w_${++callSeq}`;
    pending.set(id, { resolve, reject });
    send({ ...msg, id });
  });

  /** 插件自持的服务实现(留在 worker;宿主只持名字与转发代理) */
  const services = new Map();
  const fxMap = new Map(); // fxId → {apply, revert}
  let fxSeq = 0;

  /** 沙箱化 KernelContext(宿主 Context 的 IPC 影子) */
  const ctx = {
    trust: "known", // 外部插件:签名+检疫为准入(K.3);运行时防线=进程边界
    budget: {},
    provide(key, impl) {
      const name = key && key.name;
      if (typeof name !== "string" || name === "") throw new Error("provide 需带服务名");
      services.set(name, impl); // 实现留在本进程
      send({ t: "provide", service: name }); // 宿主挂转发代理(须在 manifest.provides 内)
    },
    inject(key) {
      const name = key && key.name;
      return {
        get() {
          // 宿主服务经 IPC 调用(白名单:仅宿主已激活服务)
          return new Proxy({}, {
            get(_t, method) {
              if (typeof method !== "string") return undefined;
              return (...args) => rpcToHost({ t: "host-call", service: name, method, args });
            },
          });
        },
      };
    },
    effect(desc, apply, revert, opts) {
      const fxId = `wfx_${++fxSeq}_${Date.now().toString(36)}`;
      const rClass = (opts && opts.rClass) || 0;
      fxMap.set(fxId, { apply, revert });
      // 宿主侧登记真实效应(账本落款在宿主);apply/revert 由宿主经 fx-run 回调执行。
      // rpcToHost 语义:reject 即失败(错误文本随 reject);resolve 的 value={token} 即成功
      return rpcToHost({
        t: "fx", fxId, desc, rClass,
        ...(opts && opts.rebindArgs !== undefined ? { rebindArgs: opts.rebindArgs } : {}),
      }).then((value) => ({ token: value && value.token }));
    },
    irreversible(desc, preapprovalSeq, apply) {
      const fxId = `wfx_${++fxSeq}_${Date.now().toString(36)}`;
      fxMap.set(fxId, { apply, revert: undefined }); // class 2 无 revert 语义
      return rpcToHost({ t: "fx", fxId, desc, rClass: 2, preapproval: preapprovalSeq })
        .then((value) => ({ token: value && value.token }));
    },
    emit(evt) { send({ t: "emit", evt }); },
    on() { return { dispose() { /* 订阅宿主事件不在沙箱白名单最小集,诚实降级 */ } }; },
  };

  const runFx = (fxId, op, captured) => {
    const fx = fxMap.get(fxId);
    if (fx === undefined) throw new Error(`未知效应: ${fxId}`);
    if (op === "apply") return fx.apply();
    if (op === "revert") {
      if (fx.revert === undefined) throw new Error(`效应无逆操作: ${fxId}`);
      return fx.revert(captured);
    }
    throw new Error(`未知效应操作: ${op}`);
  };

  process.on("message", async (m) => {
    if (m === null || typeof m !== "object") return;
    if (m.t === "start") {
      try {
        const mod = require(pluginPath); // CJS 外部插件(MCP/市场技能的实际交付形态)
        if (typeof mod.start !== "function") throw new Error("插件缺 start(ctx)");
        await mod.start(ctx);
        send({ t: "ready" });
      } catch (err) {
        send({ t: "ready", error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    if (m.t === "svc-call") {
      try {
        const impl = services.get(m.service);
        if (impl === undefined) throw new Error(`worker 未提供该服务: ${m.service}`);
        const fn = impl[m.method];
        if (typeof fn !== "function") throw new Error(`服务无该方法: ${m.service}.${m.method}`);
        const value = await fn(...m.args);
        send({ t: "svc-result", id: m.id, ok: true, value });
      } catch (err) {
        send({ t: "svc-result", id: m.id, ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    if (m.t === "fx-run") {
      try {
        const value = await runFx(m.fxId, m.op, m.captured);
        send({ t: "svc-result", id: m.id, ok: true, value });
      } catch (err) {
        send({ t: "svc-result", id: m.id, ok: false, error: String(err && err.message ? err.message : err) });
      }
      return;
    }
    if (m.t === "host-result") {
      const p = pending.get(m.id);
      if (p !== undefined) {
        pending.delete(m.id);
        if (m.ok) p.resolve(m.value);
        else p.reject(new Error(String(m.error)));
      }
      return;
    }
    if (m.t === "stop") {
      // 宿主停用:运行插件自理钩子后应答并保持存活——
      // 效应回滚可能在 stop 之后发生(dispose = suspend → revertOwner → disposed),
      // worker 须活到宿主确认销毁(SIGKILL/断连)为止
      try {
        const mod = require.cache[require.resolve(pluginPath)];
        if (mod && mod.exports && typeof mod.exports.stop === "function") await mod.exports.stop();
      } catch { /* 尽力而为 */ }
      send({ t: "svc-result", id: m.id, ok: true });
      return;
    }
    // 未知操作:白名单协议,一律拒绝(穿透防线——worker 只能说协议内的话)
  });

  process.on("disconnect", () => process.exit(0)); // 宿主死亡/关闭通道 → 不做孤儿
  send({ t: "boot" });
}

main().catch((err) => {
  try { process.send({ t: "ready", error: String(err) }); } catch { /* */ }
  process.exit(3);
});
