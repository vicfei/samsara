// 微信个人号 Bot 通道(附录 C 渠道体系 / 接口 §5.2 ChannelAdapter)
// 底座:腾讯 iLink Bot API(ilinkai.weixin.qq.com)——纯出站长轮询,宪法层不破
// 参考:research/wechat-ilink-channel.md(Weknora 分析 → Samsara 映射表)
//
// 绑定流程:
//   1. 管理员发起 → server 调 get_bot_qrcode → 返回 QR 内容
//   2. 本地生成二维码(不用公网 api.qrserver.com——Weknora 的改进点)
//   3. 用户微信扫码 → server 长轮询 get_qrcode_status → confirmed 携带 bot_token
//   4. bot_token 直接入 credentials/(0600),不经浏览器(Weknora 的改进点)
//
// 运行态:
//   LongPollClient 循环 getupdates → normalize → lane 队列 → runTask → sendmessage
//   Token 失效(errcode -14)→ 自动暂停渠道 + 通知 owner 重扫

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── iLink API 客户端 ─────────────────────────────────────

export const ILINK_BASE = "https://ilinkai.weixin.qq.com";

export interface QRCodeBinding {
  qrcode: string;          // 轮询令牌(不透明)
  qrContent: string;       // 要编码进二维码的 URL
}

export interface BindingStatus {
  status: "wait" | "scaned" | "confirmed" | "expired";
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
}

export interface ILinkMessage {
  update_id: number;
  message?: {
    msg_id: string;
    from_user_id: string;   // 微信用户 ID(peer)
    from_nickname?: string;
    content: string;
    timestamp: number;
    msg_type?: number;      // 1=文本
  };
  callback_query?: {
    id: string;
    from_user_id: string;
    data: string;           // 按钮回调数据
    message?: { msg_id: string; content: string };
  };
}

export interface ILinkUpdateResponse {
  errcode: number;
  errmsg?: string;
  updates?: ILinkMessage[];
  next_cursor?: string;
}

export interface SendResult {
  errcode: number;
  errmsg?: string;
}

/** iLink API HTTP 客户端(纯出站,长轮询 ~35s) */
export class ILinkClient {
  private readonly baseurl: string;
  private readonly token: string;

  constructor(token: string, baseurl = ILINK_BASE) {
    this.token = token;
    this.baseurl = baseurl;
  }

  private headers(): Record<string, string> {
    return { "content-type": "application/json", authorization: `Bearer ${this.token}` };
  }

  /** 申请绑定二维码(未绑定态调用;返回 QR 内容 + 轮询令牌) */
  static async requestQRCode(): Promise<QRCodeBinding> {
    const res = await fetch(`${ILINK_BASE}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`iLink 网关 ${res.status}`);
    const data = (await res.json()) as { ret?: number; errcode?: number; qrcode?: string; qrcode_img_content?: string; errmsg?: string };
    const ok = (data.ret ?? data.errcode ?? -1) === 0;
    if (!ok || !data.qrcode || !data.qrcode_img_content) {
      throw new Error(`获取二维码失败: ret=${data.ret} errcode=${data.errcode} ${data.errmsg ?? ""}`);
    }
    return { qrcode: data.qrcode, qrContent: data.qrcode_img_content };
  }

  /** 长轮询绑定状态(每次 ~35s;客户端超时须 >38s 且用 DETACHED context) */
  static async pollBindingStatus(qrcode: string): Promise<BindingStatus> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38_000);
    try {
      const res = await fetch(`${ILINK_BASE}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!res.ok) return { status: "wait" };
      const data = (await res.json()) as {
        ret?: number;
        errcode?: number;
        status?: string;
        bot_token?: string;
        ilink_bot_id?: string;
        ilink_user_id?: string;
        baseurl?: string;
      };
      if ((data.ret ?? data.errcode ?? -1) !== 0) return { status: "wait" };
      switch (data.status) {
        case "confirmed":
          return {
            status: "confirmed",
            ...(data.bot_token !== undefined ? { bot_token: data.bot_token } : {}),
            ...(data.ilink_bot_id !== undefined ? { ilink_bot_id: data.ilink_bot_id } : {}),
            ...(data.ilink_user_id !== undefined ? { ilink_user_id: data.ilink_user_id } : {}),
            ...(data.baseurl !== undefined ? { baseurl: data.baseurl } : {}),
          };
        case "scaned": return { status: "scaned" };
        case "expired": return { status: "expired" };
        default: return { status: "wait" };
      }
    } catch {
      return { status: "wait" }; // 超时优雅折算为 wait(Weknora 工程实践)
    } finally { clearTimeout(timer); }
  }

  /** 长轮询消息更新(运行态;每次 ~35s) */
  async getUpdates(cursor?: string): Promise<ILinkUpdateResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38_000);
    try {
      const res = await fetch(`${this.baseurl}/ilink/bot/getupdates`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          ...(cursor !== undefined && cursor !== "" ? { cursor } : {}),
          timeout: 35,
        }),
        signal: controller.signal,
      });
      if (!res.ok) return { errcode: res.status, errmsg: `HTTP ${res.status}` };
      return (await res.json()) as ILinkUpdateResponse;
    } catch {
      return { errcode: -1, errmsg: "网络超时(长轮询正常返回)" };
    } finally { clearTimeout(timer); }
  }

  /** 发送消息 */
  async sendMessage(toUserId: string, content: string, msgType: "text" | "markdown" = "text"): Promise<SendResult> {
    const res = await fetch(`${this.baseurl}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ to_user_id: toUserId, content, msg_type: msgType === "text" ? 1 : 2 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { errcode: res.status, errmsg: `HTTP ${res.status}` };
    return (await res.json()) as SendResult;
  }
}

// ── 凭据管理(bot_token 永不出 credentials/)──────────────

export interface WeChatCredential {
  bot_token: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  bound_at: string;
  peer_nickname?: string;   // 绑定者的微信昵称(首次消息时填充)
}

const CRED_DIR = join(homedir(), ".samsara", "credentials");
const CRED_FILE = join(CRED_DIR, "wechat-ilink.json");

export function saveWeChatCredential(cred: WeChatCredential): void {
  mkdirSync(CRED_DIR, { recursive: true });
  writeFileSync(CRED_FILE, JSON.stringify(cred, null, 2));
  chmodSync(CRED_FILE, 0o600);
}

export function loadWeChatCredential(): WeChatCredential | null {
  if (!existsSync(CRED_FILE)) return null;
  try { return JSON.parse(readFileSync(CRED_FILE, "utf-8")) as WeChatCredential; }
  catch { return null; }
}

export function clearWeChatCredential(): void {
  if (existsSync(CRED_FILE)) writeFileSync(CRED_FILE, "{}");
}

// ── 微信渠道适配器(ChannelAdapter)───────────────────────

export interface WeChatChannelOptions {
  runner: (goal: string, sessionKey: string, actor: { kind: "human"; id: string; trust: "owner" }) => Promise<{ outcome: string; reply?: string; error?: string; traceId: string }>;
  onBound?: (cred: WeChatCredential) => void;
  onTokenExpired?: () => void;
}

export class WeChatChannel {
  private client: ILinkClient | null = null;
  private cursor: string | undefined;
  private running = false;
  private pollAbort: AbortController | null = null;
  /** per-peer 串行(lane 语义:同 sessionKey 严格按序,§4.2) */
  private readonly lanes = new Map<string, Promise<unknown>>();
  private readonly knownPeers = new Map<string, string>(); // user_id → nickname

  constructor(private readonly opts: WeChatChannelOptions) {}

  get isRunning(): boolean { return this.running; }

  /** 启动消息长轮询(需已绑定) */
  start(cred: WeChatCredential): void {
    if (this.running) return;
    this.client = new ILinkClient(cred.bot_token, cred.baseurl ?? ILINK_BASE);
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    this.pollAbort?.abort();
  }

  private async pollLoop(): Promise<void> {
    let backoff = 1_000;
    while (this.running) {
      if (this.client === null) break;
      try {
        const r = await this.client.getUpdates(this.cursor);
        if (r.errcode === -14) {
          // Token 失效:自动停止 + 通知 owner 重扫(Weknora 的生命周期实践)
          this.running = false;
          clearWeChatCredential();
          this.opts.onTokenExpired?.();
          break;
        }
        if (r.errcode !== 0) {
          await sleep(Math.min(backoff, 60_000));
          backoff = Math.min(backoff * 2, 60_000); // 指数退避(Weknora 实践)
          continue;
        }
        backoff = 1_000;
        if (r.next_cursor !== undefined) this.cursor = r.next_cursor;
        if (r.updates !== undefined) {
          for (const u of r.updates) this.dispatch(u);
        }
      } catch {
        if (!this.running) break;
        await sleep(Math.min(backoff, 60_000));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  /** 消息分派:normalize → lane 队列 → runner → deliver(§4.1/§4.2) */
  private dispatch(update: ILinkMessage): void {
    if (update.message !== undefined) {
      const msg = update.message;
      const sessionKey = `wechat:dm:${msg.from_user_id}`;
      if (msg.from_nickname !== undefined) this.knownPeers.set(msg.from_user_id, msg.from_nickname);
      if (msg.msg_type === 1 && msg.content.trim() !== "") {
        this.enqueue(sessionKey, msg.from_user_id, msg.content.trim());
      }
    }
    // callback_query 处理预留(HITL 审批按钮,接口 §5.2;M2 后期接入)
  }

  /** 同 peer 严格按序(车道语义);不同 peer 并行 */
  private enqueue(sessionKey: string, fromUserId: string, goal: string): void {
    const prev = this.lanes.get(sessionKey) ?? Promise.resolve();
    const task = prev.then(async () => {
      const actor = { kind: "human" as const, id: fromUserId, trust: "owner" as const };
      const r = await this.opts.runner(goal, sessionKey, actor);
      // deliver:回复(截断到 2000 字,微信消息长度限制)
      const reply = (r.reply ?? r.error ?? `(${r.outcome})`).slice(0, 2000);
      if (this.client !== null) {
        await this.client.sendMessage(fromUserId, reply, "text");
      }
    }).catch(() => undefined); // 单消息失败不阻塞后续(lane 内继续)
    this.lanes.set(sessionKey, task);
  }
}

// ── 工具函数 ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }

/** 生成本地二维码 SVG(不用公网 api.qrserver.com) */
export async function generateQRSvg(content: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toString(content, { type: "svg", margin: 2, width: 300, errorCorrectionLevel: "M" });
}

/** 生成本地二维码 Data URL(嵌入 HTML) */
export async function generateQRDataUrl(content: string): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(content, { margin: 2, width: 300, errorCorrectionLevel: "M" });
}
