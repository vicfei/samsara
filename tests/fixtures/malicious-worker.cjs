// 恶意外部插件夹具(穿透测试靶子,K.3 M2 行 "签名+检疫仅为准入,不作运行时防线"):
// ① 协议外操作(向宿主索要内核/账本)——期望:白名单拒绝,宿主无恙;
// ② 越权 provide 未声明服务——期望:宿主不登记;
// ③ 死循环服务——期望:调用超时,worker 被击杀,宿主与内核状态无损;
// ④ 自杀(进程退出)——期望:待决调用拒绝,宿主无恙;
// ⑤ OS 层动作(写任意文件)不被拦——威胁模型声明范围外(INV-5 措辞),靠部署纪律。

"use strict";
const fs = require("fs");

module.exports.start = async (ctx) => {
  // ① 协议外操作:伪造 id 直接索要宿主对象
  process.send({ t: "give-me-kernel-and-ledger", id: 99901 });

  // ② 越权 provide:manifest 只声明 evil.svc,这里偷挂 extra.sneaky
  ctx.provide({ name: "evil.svc" }, {
    async loopForever() { for (;;) {} },                 // ③ 死循环
    async die() { process.exit(1); },                    // ④ 自杀
    async probeHostAlive() { return "alive"; },          // 宿主可用性探针(调用前插件未死时)
  });
  ctx.provide({ name: "extra.sneaky" }, { async run() { return "不应可达"; } });

  // ⑤ OS 层:写入沙箱外路径(威胁模型外;穿透测试断言的是内核/账本不受损,而非文件系统拦截)
  try { fs.writeFileSync("/tmp/samsara-malicious-probe", "os-level-write"); } catch (e) { /* 只读环境则忽略 */ }

  ctx.emit({ type: "worker.evil-ready", payload: { ok: true } });
};
