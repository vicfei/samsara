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
//   LongPollClient 循环 getupdates → normalize → lane 队列 → runTask(期间 sendtyping"正在输入") → sendmessage
//   context_token 跨重启持久化(state/wechat-ilink-state.json,0600)——重启后回复与主动推送仍可串线
//   Token 失效(errcode -14)→ 自动暂停渠道 + 通知 owner 重扫
// 调试日志:SAMSARA_WECHAT_DEBUG=1 开启 dbg 级(心跳/原始报文/发送明细);默认仅保留运行级单行

import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { deriveTrust } from "./trust.js";
import type { TrustLevel } from "../kernel/types.js";

/** dbg 级日志(默认静默;SAMSARA_WECHAT_DEBUG=1 开启) */
function dbg(...args: unknown[]): void {
  if (process.env.SAMSARA_WECHAT_DEBUG === "1") console.log("[wechat-dbg]", ...args);
}

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

export interface ConfigResult extends SendResult {
  typingTicket?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** iLink API HTTP 客户端(纯出站,长轮询 ~35s;fetchImpl 注入供测试) */
export class ILinkClient {
  private readonly baseurl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(token: string, baseurl = ILINK_BASE, fetchImpl: FetchLike = (u, i) => fetch(u, i)) {
    this.token = token;
    this.baseurl = baseurl;
    this.fetchImpl = fetchImpl;
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
      const res = await this.fetchImpl(`${this.baseurl}/ilink/bot/getupdates`, {
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
    const res = await this.fetchImpl(`${this.baseurl}/ilink/bot/sendmessage`, {
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

  /** 取账号配置(typing 前置:响应携带 typing_ticket,按用户缓存 ~10min 可复用)
   *  wechatbot.dev 整合契约:body 需 ilink_user_id,否则 ret=-2 "ilink_user_id required" */
  async getConfig(ilinkUserId: string, contextToken?: string): Promise<ConfigResult> {
    const res = await this.fetchImpl(`${this.baseurl}/ilink/bot/getconfig`, {
      method: "POST",
      headers: this.ilinkHeaders(),
      body: JSON.stringify({
        ilink_user_id: ilinkUserId,
        ...(contextToken !== undefined && contextToken !== "" ? { context_token: contextToken } : {}),
        base_info: { channel_version: "samsara-1.0.0" },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { errcode: res.status, errmsg: `HTTP ${res.status}` };
    const raw = (await res.json()) as {
      ret?: number; errcode?: number; errmsg?: string;
      typing_ticket?: string; data?: { typing_ticket?: string };
    };
    const ticket = raw.typing_ticket ?? raw.data?.typing_ticket;
    return {
      errcode: raw.ret ?? raw.errcode ?? 0,
      ...(raw.errmsg !== undefined ? { errmsg: raw.errmsg } : {}),
      ...(ticket !== undefined && ticket !== "" ? { typingTicket: ticket } : {}),
    };
  }

  /** typing 指示(§4.6 表达力 L5"打字中"):status=1 开始 / 2 结束(不是 0);
   *  ~60s 自动过期,持续显示须在过期前重发;best-effort——失败静默,绝不阻断回复主流程 */
  async sendTyping(ilinkUserId: string, typingTicket: string, status: 1 | 2): Promise<SendResult> {
    const res = await this.fetchImpl(`${this.baseurl}/ilink/bot/sendtyping`, {
      method: "POST",
      headers: this.ilinkHeaders(),
      body: JSON.stringify({
        ilink_user_id: ilinkUserId,
        typing_ticket: typingTicket,
        status,
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

// ── 渠道运行态(context_token 跨重启持久化;与凭据同纪律:0600,永不出 ~/.samsara)──

export interface WeChatChannelState {
  version: 1;
  /** per-peer 最近一次消息的 context_token(串线凭据;发送回复/主动推送时回传) */
  context_tokens: Record<string, string>;
  updated_at: string;
}

const SAMSARA_HOME = () => process.env.SAMSARA_HOME ?? join(homedir(), ".samsara");
const defaultStateFile = () => join(SAMSARA_HOME(), "state", "wechat-ilink-state.json");

export function loadWeChatChannelState(stateFile = defaultStateFile()): WeChatChannelState {
  try {
    if (!existsSync(stateFile)) return { version: 1, context_tokens: {}, updated_at: "" };
    const s = JSON.parse(readFileSync(stateFile, "utf-8")) as WeChatChannelState;
    if (s.version !== 1 || typeof s.context_tokens !== "object" || s.context_tokens === null) {
      return { version: 1, context_tokens: {}, updated_at: "" };
    }
    return s;
  } catch { return { version: 1, context_tokens: {}, updated_at: "" }; }
}

export function saveWeChatChannelState(state: WeChatChannelState, stateFile = defaultStateFile()): void {
  try {
    mkdirSync(join(stateFile, ".."), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ ...state, updated_at: new Date().toISOString() }, null, 2));
    chmodSync(stateFile, 0o600);
  } catch (err) { dbg(`state 持久化失败(忽略,内存态继续): ${String(err).slice(0, 80)}`); }
}

// ── 微信渠道适配器(ChannelAdapter)───────────────────────

// spec-constants: wechat_typing_refresh_sec / wechat_typing_ticket_ttl_sec
export const WECHAT_TYPING_REFRESH_SEC = 45;   // status=1 约 60s 自动过期 → 45s 重发留 15s 余量
export const WECHAT_TYPING_TICKET_TTL_SEC = 540; // ticket 官方约 10min 可复用 → 9min 保守续取

/** 渠道上下文:随消息传给 runner 的派生信息(§4.4 审计链) */
export interface ChannelContext {
  trustSource: "allowlist" | "default";
}

export interface WeChatChannelOptions {
  runner: (goal: string, sessionKey: string, actor: { kind: "human"; id: string; trust: TrustLevel }, channelCtx?: ChannelContext) => Promise<{ outcome: string; reply?: string; error?: string; traceId: string }>;
  onBound?: (cred: WeChatCredential) => void;
  onTokenExpired?: () => void;
  /** 测试注入:客户端工厂/typing 节奏/state 文件/信任映射文件 */
  clientFactory?: (cred: WeChatCredential) => ILinkClient;
  typingRefreshMs?: number;
  typingTicketTtlMs?: number;
  stateFile?: string;
  trustFile?: string;
}

/** typing 指示编排(§4.6 表达力 L5):best-effort,一切失败静默降级,绝不阻断回复 */
interface TypingSession {
  stop(): Promise<void>;
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
  /** context_token 持久态(跨重启串线)+ typing_ticket 缓存(user_id → {ticket, fetchedAt}) */
  private channelState: WeChatChannelState = { version: 1, context_tokens: {}, updated_at: "" };
  private readonly tickets = new Map<string, { ticket: string; fetchedAt: number }>();

  constructor(private readonly opts: WeChatChannelOptions) {}

  get isRunning(): boolean { return this.running; }

  /** 启动消息长轮询(需已绑定);载入持久化 context_token */
  start(cred: WeChatCredential): void {
    if (this.running) return;
    this.channelState = loadWeChatChannelState(this.opts.stateFile);
    this.client = this.opts.clientFactory !== undefined
      ? this.opts.clientFactory(cred)
      : new ILinkClient(cred.bot_token, cred.baseurl ?? ILINK_BASE);
    this.running = true;
    void this.pollLoop();
  }

  stop(): void {
    this.running = false;
    this.pollAbort?.abort();
  }

  /** 对某 peer 的最近 context_token(持久态;供主动推送串线,§4.6 规则 3) */
  contextTokenOf(userId: string): string | undefined {
    return this.channelState.context_tokens[userId];
  }

  /** 主动投递(定时任务通知/告警等出站消息;用持久化 context_token 串线,无则裸发) */
  async deliver(userId: string, content: string): Promise<SendResult | null> {
    if (this.client === null) return null;
    return this.client.sendMessage(userId, content.slice(0, 2000), this.contextTokenOf(userId));
  }

  private async pollLoop(): Promise<void> {
    let backoff = 1_000;
    while (this.running) {
      if (this.client === null) break;
      try {
        const r = await this.client.getUpdates(this.getUpdatesBuf);
        dbg(`poll errcode=${r.errcode} updates=${r.updates?.length ?? 0} cursor=${r.next_cursor?.slice(0, 12) ?? "无"}`);
        if (r.errcode === -14) {
          console.log(`[wechat] Token 失效(errcode -14,第 ${++this.err14Count} 次);连续 5 次后暂停渠道`);
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
        this.err14Count = 0;
        if (r.next_cursor !== undefined) this.getUpdatesBuf = r.next_cursor;
        if (r.updates !== undefined) {
          for (const u of r.updates) this.ingest(u);
        }
      } catch {
        if (!this.running) break;
        await sleep(Math.min(backoff, 60_000));
        backoff = Math.min(backoff * 2, 60_000);
      }
    }
  }

  /** 消息入口(长轮询循环调用;公开为适配器内部缝——测试/未来管道复用) */
  ingest(update: ILinkMessage): void {
    dbg(`原始消息:`, JSON.stringify(update).slice(0, 2000));
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
    // 从多个可能字段提取文本(iLink 实际字段名以 dbg 原始报文核对)
    const text = this.extractText(update as unknown as Record<string, unknown>);
    if (text !== undefined && text.trim() !== "") {
      console.log(`[wechat] 收到消息 ${msg.from_user_id.slice(0, 12)}…(${msg.from_nickname ?? "?"}): ${text.trim().slice(0, 40)}`);
      if (msg.context_token !== undefined && msg.context_token !== "") this.rememberContextToken(msg.from_user_id, msg.context_token);
      // 渠道对端信任派生(§4.4/K.4):allowlist 命中→该级;未列名私聊默认 guest
      const { trust, source } = deriveTrust("wechat", msg.from_user_id, this.opts.trustFile);
      if (trust !== "owner") dbg(`对端 ${msg.from_user_id.slice(0, 12)}… 派生信任=${trust}(${source})`);
      this.enqueue(sessionKey, msg.from_user_id, text.trim(), msg.context_token, trust, source);
    } else {
      console.log(`[wechat] ⚠ 无法提取文本(user=${msg.from_user_id.slice(0, 12)}…;SAMSARA_WECHAT_DEBUG=1 看原始报文)`);
    }
  }

  /** context_token 写持久态(每消息直写——个人级规模,文件极小) */
  private rememberContextToken(userId: string, token: string): void {
    if (this.channelState.context_tokens[userId] === token) return;
    this.channelState.context_tokens[userId] = token;
    saveWeChatChannelState(this.channelState, this.opts.stateFile);
  }

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

  private enqueue(sessionKey: string, fromUserId: string, goal: string, contextToken: string | undefined,
                  trust: TrustLevel, trustSource: "allowlist" | "default"): void {
    const prev = this.lanes.get(sessionKey) ?? Promise.resolve();
    const task = prev.then(async () => {
      // 派生信任随消息一路携带(§4.4),供授权矩阵消费(memory 语义闸/skill 晋升闸/…)
      const actor = { kind: "human" as const, id: fromUserId, trust };
      const channelCtx: ChannelContext = { trustSource: trustSource };
      // typing"正在输入"(best-effort):runner 期间显示,结束即清除
      const typing = this.beginTyping(fromUserId, contextToken);
      let r: { outcome: string; reply?: string; error?: string; traceId: string };
      try {
        r = await this.opts.runner(goal, sessionKey, actor, channelCtx);
      } finally {
        await typing.stop();
      }
      // deliver:回复(截断到 2000 字,微信消息长度限制);context_token 新者优先,持久态兜底(重启串线)
      const reply = (r.reply ?? r.error ?? `(${r.outcome})`).slice(0, 2000);
      if (this.client !== null) {
        const token = contextToken !== undefined && contextToken !== ""
          ? contextToken
          : this.contextTokenOf(fromUserId);
        const sendResult = await this.client.sendMessage(fromUserId, reply, token);
        if (sendResult.errcode !== 0) {
          console.log(`[wechat] 回复发送失败 errcode=${sendResult.errcode}${sendResult.errmsg !== undefined ? ` ${sendResult.errmsg}` : ""}`);
        } else {
          dbg(`回复送达 to=${fromUserId.slice(0, 12)}… len=${reply.length}`);
        }
      }
    }).catch((err) => console.log(`[wechat] 消息处理异常: ${String(err).slice(0, 100)}`)); // 单消息失败不阻塞
    this.lanes.set(sessionKey, task);
  }

  /** typing 会话:取/复用 ticket → status=1 → 周期重发(60s 自动过期)→ stop 清除。
   *  任何一步失败均静默(返回 no-op 会话),不影响回复主流程。 */
  private beginTyping(userId: string, contextToken?: string): TypingSession {
    const refreshMs = this.opts.typingRefreshMs ?? WECHAT_TYPING_REFRESH_SEC * 1000;
    const ttlMs = this.opts.typingTicketTtlMs ?? WECHAT_TYPING_TICKET_TTL_SEC * 1000;
    if (this.client === null) return { stop: async () => undefined };
    const client = this.client;
    let timer: NodeJS.Timeout | null = null;
    let stopped = false;
    const ticketOf = async (): Promise<string | null> => {
      const hit = this.tickets.get(userId);
      if (hit !== undefined && Date.now() - hit.fetchedAt < ttlMs) return hit.ticket;
      const cfg = await client.getConfig(userId, contextToken);
      if (cfg.errcode !== 0 || cfg.typingTicket === undefined) {
        dbg(`getconfig 失败(typing 降级): errcode=${cfg.errcode}`);
        return null;
      }
      this.tickets.set(userId, { ticket: cfg.typingTicket, fetchedAt: Date.now() });
      return cfg.typingTicket;
    };
    const show = async (): Promise<void> => {
      try {
        const ticket = await ticketOf();
        if (ticket === null || stopped) return;
        const r = await client.sendTyping(userId, ticket, 1);
        if (r.errcode !== 0) dbg(`sendtyping 失败(忽略): errcode=${r.errcode}`);
      } catch (err) { dbg(`typing 异常(忽略): ${String(err).slice(0, 80)}`); }
    };
    void show();
    timer = setInterval(() => { if (!stopped) void show(); }, refreshMs);
    return {
      stop: async () => {
        stopped = true;
        if (timer !== null) clearInterval(timer);
        try {
          const hit = this.tickets.get(userId);
          if (hit !== undefined) await client.sendTyping(userId, hit.ticket, 2); // 2=结束(非 0)
        } catch { /* 清除失败无所谓:60s 自动过期 */ }
      },
    };
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
