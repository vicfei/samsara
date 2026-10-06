// 良好外部插件夹具(纯 CJS——外部生态插件的真实交付形态):
// 提供服务 echo/state/askLlm/hang,登记可逆效应(写标记文件,可回滚),发就绪事件。

"use strict";
const fs = require("fs");

module.exports.start = async (ctx) => {
  const marker = process.env.SANDBOX_TEST_MARKER || "/tmp/samsara-good-worker-marker";
  const llm = ctx.inject({ name: "llm.chat" });

  ctx.provide({ name: "demo.echo" }, {
    async echo(text) { return `echo:${text}`; },
    async state() { try { return fs.readFileSync(marker, "utf-8"); } catch { return "(无)"; } },
    async askLlm(prompt) { return llm.get().complete({ messages: [{ role: "user", content: prompt }] }); },
    async hang() { await new Promise(() => {}); }, // 挂死(超时击杀用例)
  });

  await ctx.effect(
    "worker: 写标记文件",
    () => { fs.writeFileSync(marker, "applied"); return "applied"; },
    async (captured) => { fs.writeFileSync(marker, `reverted(from=${captured})`); },
    { rClass: 0, rebindArgs: { marker } },
  );

  ctx.emit({ type: "worker.demo-ready", payload: { ok: true } });
};

module.exports.stop = async () => { /* 优雅自理 */ };
