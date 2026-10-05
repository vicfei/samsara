// WebChat 最小渠道(M1:回环 HTTP;主文档 §4.1/§4.6 的 L1 形态)
// sessionKey = webchat:dm:<peer>(§4.2);同 peer 请求严格串行(车道语义的最小形态——
// 并行度在会话间,竞态在结构上不存在);富文本降级等渠道能力体系属 M2 L0.5 完整接入。
// 默认绑定 127.0.0.1(宪法层条款:默认回环;公网暴露为明确不支持项)。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Kernel } from "../kernel/kernel.js";
import { runTask } from "../agent/task.js";
import type { Skills } from "../l2/skills.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { compileSchedule } from "../scheduler/scheduler.js";
import { CHAT_SERVICE } from "../llm/chat.js";

export interface WebChatOptions {
  port?: number;            // 默认 18790(spec-constants: webchat_port)
  host?: string;            // 默认 127.0.0.1,不可配置为公网(测试可注入回环别名)
  runtimePluginId: string;
  skills?: Skills;
  scheduler?: Scheduler;    // 调度器(挂载 /jobs 管理面;单写入者纪律)
  systemPrompt?: string;
}

export interface WebChatServer {
  port: number;
  close(): Promise<void>;
}

const HTML_PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>Samsara WebChat</title>
<style>body{font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px}
#log{border:1px solid #ccc;border-radius:8px;padding:12px;min-height:200px;white-space:pre-wrap}
form{display:flex;gap:8px;margin-top:12px}input{flex:1;padding:8px}button{padding:8px 16px}
i{color:#888}</i></style></head><body>
<h3>Samsara WebChat <i>(M1 最小渠道 · 回环)</i></h3>
<div id="log"><i>对话开始。任务与工具调用全程入账,可审计、可回滚。</i></div>
<form onsubmit="return send(event)"><input id="msg" placeholder="说点什么…" autofocus><button>发送</button></form>
<script>
async function send(e){e.preventDefault();const m=document.getElementById('msg');const t=m.value.trim();if(!t)return false;
const log=document.getElementById('log');log.textContent+='\\n你: '+t+'\\n…';m.value='';
const r=await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({message:t})});const j=await r.json();
log.textContent=log.textContent.replace(/\\n…$/,'')+'\\nSamsara: '+(j.reply??j.error)+'\\n';return false}
</script></body></html>`;

export function startWebChat(kernel: Kernel, opts: WebChatOptions): Promise<WebChatServer> {
  const port = opts.port ?? 18790;
  const host = opts.host ?? "127.0.0.1";
  /** 车道:同 sessionKey 串行(§4.2),不同会话并行 */
  const lanes = new Map<string, Promise<unknown>>();

  const server = createServer((req, res) => {
    void handle(req, res).catch((err) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(err) }));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    if (req.method === "GET" && (url === "/" || url === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(HTML_PAGE);
      return;
    }
    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ledgerSeq: kernel.store.lastSeq }));
      return;
    }
    if (req.method === "POST" && url === "/jobs" && opts.scheduler !== undefined) {
      const body = await readBody(req);
      let q: Record<string, unknown>;
      try { q = JSON.parse(body) as Record<string, unknown>; }
      catch { res.writeHead(400); res.end(JSON.stringify({ error: "非法 JSON" })); return; }
      const action = String(q.action ?? "");
      const sch = opts.scheduler;
      const actor = { kind: "human" as const, id: String(q.peer ?? "cli"), trust: "owner" as const };
      try {
        let out: unknown;
        switch (action) {
          case "add": { // 自然语言创建(§C.2:约 1 次 LLM 编译 cron);已给 cron 则直接建
            const goal = String(q.goal ?? "");
            if (!goal) throw new Error("goal 不能为空");
            let cron = typeof q.cron === "string" ? q.cron : undefined;
            let canonicalGoal = goal;
            if (cron === undefined) {
              const llm = optsKernelService(kernel, CHAT_SERVICE.name);
              const compiled = await compileSchedule((prompt) => llm(prompt), goal, String(q.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone));
              cron = compiled.cron;
              canonicalGoal = compiled.goal;
              if (compiled.timezone !== undefined && q.timezone === undefined) q.timezone = compiled.timezone;
            }
            out = sch.createJob({
              goal: canonicalGoal, schedule: cron,
              ...(q.timezone !== undefined ? { timezone: String(q.timezone) } : {}),
              ...(q.misfire !== undefined ? { misfire: q.misfire as "skip" | "runOnce" | "catchUp" } : {}),
              ...(q.notification !== undefined ? { notification: q.notification as "smart" | "immediate" | "silent" } : {}),
              ...(q.rCeiling !== undefined ? { rCeiling: q.rCeiling as "R0" | "R1" | "R2" | "R3" | "R4" } : {}),
              actor,
            });
            break;
          }
          case "create":
            out = sch.createJob({
              goal: String(q.goal ?? ""),
              ...(q.cron !== undefined ? { schedule: String(q.cron) } : {}),
              ...(q.timezone !== undefined ? { timezone: String(q.timezone) } : {}),
              ...(q.misfire !== undefined ? { misfire: q.misfire as "skip" | "runOnce" | "catchUp" } : {}),
              ...(q.notification !== undefined ? { notification: q.notification as "smart" | "immediate" | "silent" } : {}),
              ...(q.rCeiling !== undefined ? { rCeiling: q.rCeiling as "R0" | "R1" | "R2" | "R3" | "R4" } : {}),
              ...(q.expiresAt !== undefined ? { expiresAt: String(q.expiresAt) } : {}),
              actor,
            });
            break;
          case "list": out = sch.list(); break;
          case "pause": out = sch.pause(String(q.id ?? ""), actor); break;
          case "resume": out = sch.resume(String(q.id ?? ""), actor); break;
          case "delete": out = sch.remove(String(q.id ?? ""), actor); break;
          case "renew": out = sch.renew(String(q.id ?? ""), Number(q.days ?? 30), actor); break;
          case "tick": out = { fired: await sch.tick(typeof q.now === "string" ? new Date(q.now) : undefined) }; break;
          default: throw new Error(`未知 action: ${action}`);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: out }));
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
      return;
    }
    if (req.method === "POST" && url === "/chat") {
      const body = await readBody(req);
      let parsed: { message?: unknown; peer?: unknown };
      try { parsed = JSON.parse(body) as typeof parsed; }
      catch { res.writeHead(400); res.end(JSON.stringify({ error: "非法 JSON" })); return; }
      const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const peer = typeof parsed.peer === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(parsed.peer) ? parsed.peer : "browser";
      if (!message) { res.writeHead(400); res.end(JSON.stringify({ error: "message 不能为空" })); return; }

      const sessionKey = `webchat:dm:${peer}`;
      opts.skills?.openSession(sessionKey, { kind: "human", id: peer, trust: "owner" });
      // 入车道:同会话严格按序(上一条完成才处理下一条)
      const prev = lanes.get(sessionKey) ?? Promise.resolve();
      const task = prev.then(() => runTask(kernel, {
        goal: message, sessionKey,
        runtimePluginId: opts.runtimePluginId,
        ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
        ...(opts.skills !== undefined ? { skills: opts.skills } : {}),
        actor: { kind: "human", id: peer, trust: "owner" },
      }));
      lanes.set(sessionKey, task.catch(() => undefined)); // 失败不阻塞后续消息
      const r = await task;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        reply: r.reply, outcome: r.outcome,
        ...(r.error !== undefined ? { error: r.error } : {}),
        steps: r.steps.length, trace: r.traceId, ledgerSeq: kernel.store.lastSeq,
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: `无此路由: ${req.method} ${url}` }));
  }

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        port: (server.address() as { port: number }).port,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** 经 webchat opts 拿内核服务句柄(避免 webchat 直接持有 kernel 类型之外的耦合) */
type KernelLike = { service<T>(key: { name: string }): T };
function optsKernelService(kernelP: Kernel | undefined, name: string): (prompt: string) => Promise<string> {
  const k = kernelP as unknown as KernelLike | undefined;
  if (k === undefined) throw new Error("内核不可用");
  const svc = k.service<{ complete(req: { messages: { role: "user"; content: string }[] }): Promise<{ content: string }> }>({ name });
  return async (prompt: string) => (await svc.complete({ messages: [{ role: "user", content: prompt }] })).content;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { chunks.push(c); if (chunks.reduce((n, b) => n + b.length, 0) > 1_048_576) reject(new Error("请求体超 1MB")); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
