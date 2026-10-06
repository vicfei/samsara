// WebChat 最小渠道(M1:回环 HTTP;主文档 §4.1/§4.6 的 L1 形态)
// sessionKey = webchat:dm:<peer>(§4.2);同 peer 请求严格串行(车道语义的最小形态——
// 并行度在会话间,竞态在结构上不存在);富文本降级等渠道能力体系属 M2 L0.5 完整接入。
// 默认绑定 127.0.0.1(宪法层条款:默认回环;公网暴露为明确不支持项)。

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Kernel } from "../kernel/kernel.js";
import { runTask } from "../agent/task.js";
import type { Skills } from "../l2/skills.js";
import type { Memory } from "../l2/memory.js";
import type { Scheduler } from "../scheduler/scheduler.js";
import { compileSchedule } from "../scheduler/scheduler.js";
import { CHAT_SERVICE } from "../llm/chat.js";
import { grantTrust, deriveTrust } from "./trust.js";
import { LaneQueue } from "../kernel/lanes.js";
import {
  ILinkClient, WeChatChannel, WeChatCredential,
  loadWeChatCredential, saveWeChatCredential, clearWeChatCredential,
  generateQRDataUrl,
} from "./wechat-ilink.js";

export interface WebChatOptions {
  port?: number;            // 默认 18790(spec-constants: webchat_port)
  host?: string;            // 默认 127.0.0.1,不可配置为公网(测试可注入回环别名)
  runtimePluginId: string;
  skills?: Skills;
  scheduler?: Scheduler;    // 调度器(挂载 /jobs 管理面;单写入者纪律)
  wechat?: WeChatChannel;   // 微信 iLink 渠道(QR 绑定管理面 + 消息长轮询)
  memory?: Memory;          // 三层记忆(召回注入 + 交互入提炼缓冲;§6.5)
  spawner?: import("../agent/spawner.js").Spawner;  // M3 派生器(spawn_agent 工具的校验权威;§5.4)
  trustFile?: string;       // 渠道对端信任映射(§4.4;回环默认 owner,宪法层条款)
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
form{display:flex;gap:8px;margin-top:12px}input{flex:1;padding:8px}button{padding:8px 16px;cursor:pointer}
i{color:#888}</i>
#wx{margin-top:20px;padding:12px;border:1px dashed #ccc;border-radius:8px;display:none}
#wx h4{margin:0 0 8px}#wx img{max-width:280px;border:1px solid #eee;border-radius:4px}
#wx .status{margin-top:8px;font-size:14px}</style></head><body>
<h3>Samsara WebChat <i>(M1 最小渠道 · 回环)</i></h3>
<div id="log"><i>对话开始。任务与工具调用全程入账,可审计、可回滚。</i></div>
<form onsubmit="return send(event)"><input id="msg" placeholder="说点什么…" autofocus><button>发送</button></form>
<div style="margin-top:16px"><button onclick="wxBind()" id="wxBtn" style="font-size:13px;color:#07c160;border:1px solid #07c160;background:#fff;padding:6px 14px;border-radius:6px">📱 绑定微信</button>
<span id="wxStatus" style="margin-left:8px;font-size:13px;color:#888"></span></div>
<div id="wx"><h4>微信扫码绑定</h4><div id="wxQr"></div><div class="status" id="wxPoll"></div></div>
<script>
async function send(e){e.preventDefault();const m=document.getElementById('msg');const t=m.value.trim();if(!t)return false;
const log=document.getElementById('log');log.textContent+='\\n你: '+t+'\\n…';m.value='';
const r=await fetch('/chat',{method:'POST',headers:{'content-type':'application/json'},
 body:JSON.stringify({message:t})});const j=await r.json();
log.textContent=log.textContent.replace(/\\n…$/,'')+'\\nSamsara: '+(j.reply??j.error)+'\\n';return false}

// ── 微信绑定 ──
let wxPolling=false;
async function wxCheckStatus(){
  try{const r=await fetch('/wechat/status');const j=await r.json();
    const el=document.getElementById('wxStatus');
    if(j.bound){el.textContent='✓ 已绑定';el.style.color='#07c160';document.getElementById('wxBtn').style.display='none';}
    else{el.textContent='未绑定';}
  }catch(e){}}
async function wxBind(){
  if(wxPolling)return;wxPolling=true;
  const box=document.getElementById('wx');const qr=document.getElementById('wxQr');const poll=document.getElementById('wxPoll');
  box.style.display='block';poll.textContent='正在申请二维码…';
  try{
    const r=await fetch('/wechat/bind/start');const j=await r.json();
    if(!j.ok){poll.textContent='❌ '+j.error;wxPolling=false;return;}
    qr.innerHTML='<img src="'+j.qr_data_url+'" alt="扫码绑定">';
    poll.textContent=j.instruction+';等待扫码…';
    // 轮询绑定状态(后端每次 ~35s 长轮询)
    for(let i=0;i<60;i++){
      const pr=await fetch('/wechat/bind/poll/'+encodeURIComponent(j.qrcode));
      const pj=await pr.json();
      if(pj.status==='confirmed'){
        poll.innerHTML='✅ '+pj.message+'<br>请重启守护进程(samsara webchat)使微信消息通道生效。';
        wxCheckStatus();wxPolling=false;return;
      }
      if(pj.status==='scaned'){poll.textContent='已扫码,等待微信确认…';continue;}
      if(pj.status==='expired'){poll.textContent='⏰ 二维码已过期,<a href="#" onclick="wxBind();return false">重新绑定</a>';wxPolling=false;return;}
    }
    poll.textContent='超时,<a href="#" onclick="wxBind();return false">重新绑定</a>';wxPolling=false;
  }catch(e){poll.textContent='❌ '+e;wxPolling=false;}
}
wxCheckStatus();
</script></body></html>`;

export function startWebChat(kernel: Kernel, opts: WebChatOptions): Promise<WebChatServer> {
  const port = opts.port ?? 18790;
  const host = opts.host ?? "127.0.0.1";
  /** 车道队列(§2.1/GAP9):有界 lane=min(CPU,8) × hash(sessionKey);同 key 严格按序 */
  const lanes = new LaneQueue();

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
    // ── 微信 iLink 渠道管理面(QR 绑定流,owner-only 回环)──
    if (url.startsWith("/wechat/") && req.method === "GET") {
      const sub = url.slice("/wechat/".length);
      if (sub === "bind/start") {
        try {
          const binding = await ILinkClient.requestQRCode();
          const dataUrl = await generateQRDataUrl(binding.qrContent);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, qrcode: binding.qrcode, qr_data_url: dataUrl, instruction: "用微信扫码授权(iOS 8.0.70+,仅支持单聊)" }));
        } catch (err) {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: `iLink 不可达: ${String(err).slice(0, 100)}` }));
        }
        return;
      }
      if (sub.startsWith("bind/poll/")) {
        const qrcode = decodeURIComponent(sub.slice("bind/poll/".length));
        try {
          const status = await ILinkClient.pollBindingStatus(qrcode);
          if (status.status === "confirmed" && status.bot_token !== undefined) {
            const cred: WeChatCredential = {
              bot_token: status.bot_token,
              ...(status.ilink_bot_id !== undefined ? { ilink_bot_id: status.ilink_bot_id } : {}),
              ...(status.ilink_user_id !== undefined ? { ilink_user_id: status.ilink_user_id } : {}),
              ...(status.baseurl !== undefined ? { baseurl: status.baseurl } : {}),
              bound_at: new Date().toISOString(),
            };
            saveWeChatCredential(cred);
            // T3 配对审批的运行时形态(§4.4/K.4):扫码绑定者自动授予 owner——
            // 绑定即配对,未列名的其他微信对端仍走默认 guest
            if (status.ilink_user_id !== undefined) {
              const d = deriveTrust("wechat", status.ilink_user_id, opts.trustFile);
              if (d.source !== "allowlist") {
                grantTrust("wechat", status.ilink_user_id, "owner", "QR 绑定自动授予", opts.trustFile);
              }
            }
            // 热启动:绑定确认后立即启动消息长轮询(不用重启守护)
            if (opts.wechat !== undefined && !opts.wechat.isRunning) {
              opts.wechat.start(cred);
            }
            console.log("[wechat] 绑定成功,消息通道已启动");
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, status: "confirmed", message: "绑定成功,消息通道已启动(无需重启)" }));
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, status: status.status }));
          }
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: String(err).slice(0, 100) }));
        }
        return;
      }
      if (sub === "status") {
        const cred = loadWeChatCredential();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          bound: cred !== null && cred.bot_token !== undefined && cred.bot_token !== "",
          ...(cred?.bound_at !== undefined ? { bound_at: cred.bound_at } : {}),
          ...(opts.wechat !== undefined ? { polling: opts.wechat.isRunning } : {}),
        }));
        return;
      }
      if (sub === "unbind") {
        clearWeChatCredential();
        opts.wechat?.stop();
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, message: "已解绑" }));
        return;
      }
    }

    // 记忆只读观察面(§3.2 memory.list 的渠道形态;同 peer 隔离——只看自己 sessionKey 的分片)
    if (req.method === "GET" && url.split("?")[0] === "/memory" && opts.memory !== undefined) {
      const peer = new URL(url, "http://localhost").searchParams.get("peer") ?? "browser";
      const layer = new URL(url, "http://localhost").searchParams.get("layer");
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(peer)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "peer 非法" }));
        return;
      }
      const items = opts.memory.list(`webchat:dm:${peer}`,
        layer === "episodic" || layer === "semantic" ? layer : undefined);
      const pending = opts.memory.pendingSessions().find((p) => p.sessionKey === `webchat:dm:${peer}`);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        ok: true, count: items.length,
        ...(pending !== undefined ? { pending_exchanges: pending.count } : {}),
        items: items.map((m) => ({ cas: m.cas, layer: m.layer, status: m.status, created_ts: m.createdTs, text: m.text.slice(0, 120) })),
      }));
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
              creatorChannel: "webchat",
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
              creatorChannel: "webchat",
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
      // 渠道对端信任派生(§4.4):webchat 回环默认 owner(宪法层:默认绑定 127.0.0.1)
      const { trust, source } = deriveTrust("webchat", peer, opts.trustFile);
      opts.skills?.openSession(sessionKey, { kind: "human", id: peer, trust }, { trustSource: source });
      // 入车道:同会话严格按序(§2.1:hash(sessionKey) mod N 定 lane,同 lane FIFO)
      const r = await lanes.enqueue(sessionKey, () => runTask(kernel, {
        goal: message, sessionKey,
        runtimePluginId: opts.runtimePluginId,
        ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
        ...(opts.skills !== undefined ? { skills: opts.skills } : {}),
        ...(opts.memory !== undefined ? { memory: opts.memory } : {}),
        ...(opts.spawner !== undefined ? { spawner: opts.spawner } : {}),
        actor: { kind: "human", id: peer, trust },
      }));
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
