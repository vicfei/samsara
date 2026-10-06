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
  // iLink 实际返回的字段名(实测 2026-10-06)
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;       // bot 自身 ID
  client_id?: string;
  create_time_ms?: number;
  update_time_ms?: number;
  context_token?: string;
  // 消息内容可能在以下字段之一(待确认具体字段名)
  content?: string;
  data?: unknown;            // 可能是嵌套结构
  detail?: unknown;
  item_list?: { type?: number; text_item?: { text?: string } }[];
  // Weknora 契约的兼容字段
  msg_id?: string;
  from_nickname?: string;
  timestamp?: number;
  msg_type?: number;
  update_id?: number;
  message?: {
    msg_id: string;
    from_user_id: string;
    from_nickname?: string;
    content: string;
    timestamp: number;
    msg_type?: number;
    context_token?: string;
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

  /** iLink 必需的两个额外 Header(Weknora longpoll.go:111-128 契约) */
  private ilinkHeaders(): Record<string, string> {
    // X-WECHAT-UIN:base64(str(random_uint32)),每次随机——服务端不校验具体值
    const uin = Buffer.from(String(Math.floor(Math.random() * 0xFFFFFFFF))).toString("base64");
    return {
      ...this.headers(),
      "AuthorizationType": "ilink_bot_token",  // 告诉服务端如何解释 Bearer——缺了就是 -14
      "X-WECHAT-UIN": uin,
    };
  }

  /** 长轮询消息更新(运行态;每次 ~35s)
   *  Weknora 契约:body = {get_updates_buf, base_info};响应游标也用 get_updates_buf */
  async getUpdates(getUpdatesBuf?: string): Promise<ILinkUpdateResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 38_000);
    try {
      const res = await fetch(`${this.baseurl}/ilink/bot/getupdates`, {
        method: "POST",
        headers: this.ilinkHeaders(),
        body: JSON.stringify({
          get_updates_buf: getUpdatesBuf ?? "",
          base_info: { channel_version: "samsara-1.0.0" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) return { errcode: res.status, errmsg: `HTTP ${res.status}` };
      const raw = (await res.json()) as {
        ret?: number; errcode?: number; errmsg?: string;
        msgs?: ILinkMessage[];
        get_updates_buf?: string;
      };
      return {
        errcode: raw.ret ?? raw.errcode ?? 0,
        ...(raw.errmsg !== undefined ? { errmsg: raw.errmsg } : {}),
        ...(raw.msgs !== undefined ? { updates: raw.msgs } : {}),
        ...(raw.get_updates_buf !== undefined ? { next_cursor: raw.get_updates_buf } : {}),
      };
    } catch {
      return { errcode: -1, errmsg: "网络超时(长轮询正常返回)" };
    } finally { clearTimeout(timer); }
  }

  /** 发送消息(Weknora adapter.go:99-124 契约)
   *  body.msg 结构:from_user_id 空,to_user_id 填对方,client_id 唯一,
   *  message_type=2, message_state=2, item_list[].type=1(纯文本)
   *  context_token 必须回传(消息串线) */
  async sendMessage(toUserId: string, content: string, contextToken?: string): Promise<SendResult> {
    const clientId = `samsara_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const res = await fetch(`${this.baseurl}/ilink/bot/sendmessage`, {
      method: "POST",
      headers: this.ilinkHeaders(),
      body: JSON.stringify({
        msg: {
          from_user_id: "",
          to_user_id: toUserId,
          client_id: clientId,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: content } }],
          ...(contextToken !== undefined && contextToken !== "" ? { context_token: contextToken } : {}),
        },
        base_info: { channel_version: "samsara-1.0.0" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { errcode: res.status, errmsg: `HTTP ${res.status}` };
    const raw = (await res.json()) as { ret?: number; errcode?: number; errmsg?: string };
    return { errcode: raw.ret ?? raw.errcode ?? 0, ...(raw.errmsg !== undefined ? { errmsg: raw.errmsg } : {}) };
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
  try {
    const cred = JSON.parse(readFileSync(CRED_FILE, "utf-8")) as WeChatCredential;
    if (cred.bot_token === undefined || cred.bot_token === "") return null; // 空对象/已清除
    return cred;
  } catch { return null; }
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
  private getUpdatesBuf: string | undefined; // Weknora 契约:游标字段名 get_updates_buf
  private running = false;
  private pollAbort: AbortController | null = null;
  private err14Count = 0;
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
        const r = await this.client.getUpdates(this.getUpdatesBuf);
        console.log(`[wechat-poll] errcode=${r.errcode} updates=${r.updates?.length ?? 0} cursor=${r.next_cursor?.slice(0, 12) ?? "无"}${r.errmsg !== undefined ? ` errmsg=${r.errmsg}` : ""}`);
        if (r.errcode === -14) {
          // -14 = session timeout:请求格式待调,暂不清凭据(保留 token 供调试)
          console.log(`[wechat-poll] -14 session timeout(不清凭据,${++this.err14Count} 次);3 秒后重试…`);
          if (this.err14Count >= 5) {
            this.running = false;
            this.opts.onTokenExpired?.();
            break;
          }
          await sleep(3_000);
          continue;
        }
        if (r.errcode !== 0) {
          await sleep(Math.min(backoff, 60_000));
          backoff = Math.min(backoff * 2, 60_000); // 指数退避(Weknora 实践)
          continue;
        }
        backoff = 1_000;
        if (r.next_cursor !== undefined) this.getUpdatesBuf = r.next_cursor;
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
    console.log(`[wechat-dispatch] 原始消息:`, JSON.stringify(update).slice(0, 2000));
    // msgs[] 格式:消息字段直接在对象上(Weknora 契约),或嵌套在 message 里(兼容)
    const msg = update.message ?? (update.from_user_id !== undefined ? {
      msg_id: update.msg_id ?? "",
      from_user_id: update.from_user_id,
      from_nickname: update.from_nickname,
      content: update.content ?? "",
      timestamp: update.timestamp ?? 0,
      msg_type: update.msg_type,
      context_token: update.context_token,
    } : undefined);
    if (msg === undefined || msg.from_user_id === undefined) return;
    const sessionKey = `wechat:dm:${msg.from_user_id}`;
    if (msg.from_nickname !== undefined) this.knownPeers.set(msg.from_user_id, msg.from_nickname);
    // 从多个可能字段提取文本(iLink 实际字段名待日志确认)
    const text = this.extractText(update as unknown as Record<string, unknown>);
    if (text !== undefined && text.trim() !== "") {
      console.log(`[wechat-dispatch] 提取文本: "${text.slice(0, 60)}" from ${msg.from_user_id.slice(0, 12)}…`);
      this.enqueue(sessionKey, msg.from_user_id, text.trim(), msg.context_token);
    } else {
      console.log(`[wechat-dispatch] ⚠ 无法提取文本(字段完整结构见上方原始消息日志)`);
    }
  }

  /** 同 peer 严格按序(车道语义);不同 peer 并行 */
  /** 从 iLink 消息的多种可能字段中提取文本 */
  private extractText(msg: Record<string, unknown>): string | undefined {
    // 直接 content 字段
    if (typeof msg.content === "string" && msg.content !== "") return msg.content;
    // item_list[].text_item.text(Weknora 发送格式)
    if (Array.isArray(msg.item_list)) {
      for (const item of msg.item_list) {
        const text = (item as { text_item?: { text?: string } })?.text_item?.text;
        if (typeof text === "string" && text !== "") return text;
      }
    }
    // data 字段(可能是字符串或嵌套对象)
    if (typeof msg.data === "string" && msg.data !== "") return msg.data;
    if (msg.data !== null && typeof msg.data === "object") {
      const d = msg.data as Record<string, unknown>;
      if (typeof d.text === "string") return d.text;
      if (typeof d.content === "string") return d.content;
    }
    // detail 字段
    if (typeof msg.detail === "string" && msg.detail !== "") return msg.detail;
    return undefined;
  }

  private enqueue(sessionKey: string, fromUserId: string, goal: string, contextToken?: string): void {
    const prev = this.lanes.get(sessionKey) ?? Promise.resolve();
    const task = prev.then(async () => {
      const actor = { kind: "human" as const, id: fromUserId, trust: "owner" as const };
      const r = await this.opts.runner(goal, sessionKey, actor);
      // deliver:回复(截断到 2000 字,微信消息长度限制)
      const reply = (r.reply ?? r.error ?? `(${r.outcome})`).slice(0, 2000);
      if (this.client !== null) {
        const sendResult = await this.client.sendMessage(fromUserId, reply, contextToken);
        console.log(`[wechat-send] to=${fromUserId.slice(0, 12)}… errcode=${sendResult.errcode} len=${reply.length}${sendResult.errmsg !== undefined ? ` errmsg=${sendResult.errmsg}` : ""} reply="${reply.slice(0, 60)}…"`);
      } else {
        console.log(`[wechat-send] ✗ client 为 null,无法发送`);
      }
    }).catch((err) => console.log(`[wechat-send] ✗ 异常: ${String(err).slice(0, 100)}`)); // 单消息失败不阻塞
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
