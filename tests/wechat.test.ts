// 微信 iLink 渠道收尾(M2-S4,主文档 §4.6 落地注):typing 指示 / context_token 持久化 / best-effort 降级
// 全程 fake fetch(零网络);真机契约由生产守护日志验证。

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ILinkClient,
  WeChatChannel,
  loadWeChatChannelState,
  splitForWeChat,
  WECHAT_REPLY_CHUNK_CHARS,
  type WeChatCredential,
} from "../src/channel/wechat-ilink";

// ── fake fetch:按 URL 后缀路由,记录全部调用 ────────────────

interface RecordedCall { url: string; body: Record<string, unknown>; headers: Record<string, string> }

function fakeFetch(routes: Record<string, (body: Record<string, unknown>) => unknown> = {}) {
  const calls: RecordedCall[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body !== undefined ? JSON.parse(init.body as string) as Record<string, unknown> : {};
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix));
    const payload = route !== undefined ? route[1](body) : { ret: 0 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

function callsOf(calls: RecordedCall[], suffix: string): RecordedCall[] {
  return calls.filter((c) => c.url.endsWith(suffix));
}

function bodyOf(call: RecordedCall): Record<string, unknown> {
  return call.body.msg as Record<string, unknown>; // sendmessage 的串线字段在 msg 内
}

const CRED: WeChatCredential = { bot_token: "tok-1", bound_at: "2026-10-06T00:00:00Z" };

function tmpStateFile(): string {
  return join(mkdtempSync(join(tmpdir(), "samsara-wx-")), "state.json");
}

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor 超时");
    await new Promise((done) => setTimeout(done, 10));
  }
}

function sleep(ms: number): Promise<void> { return new Promise((done) => setTimeout(done, ms)); }

/** 装配被测渠道:getupdates 恒错(轮询环退避睡眠,不干扰断言),业务端点走 routes */
function assembleChannel(
  routes: Record<string, (body: Record<string, unknown>) => unknown>,
  runnerDelayMs: number,
  opts: { typingRefreshMs?: number; stateFile: string },
) {
  const ff = fakeFetch({ "/ilink/bot/getupdates": () => ({ ret: 499 }), ...routes });
  const client = new ILinkClient("tok-1", "https://fake.local", ff.impl);
  const channel = new WeChatChannel({
    runner: async () => {
      if (runnerDelayMs > 0) await sleep(runnerDelayMs);
      return { outcome: "success", reply: "好的", traceId: "tr_1" };
    },
    clientFactory: () => client,
    ...(opts.typingRefreshMs !== undefined ? { typingRefreshMs: opts.typingRefreshMs } : {}),
    typingTicketTtlMs: 60_000,
    stateFile: opts.stateFile,
  });
  channel.start(CRED);
  return {
    ff, channel,
    cleanup: () => {
      channel.stop();
      rmSync(join(opts.stateFile, ".."), { recursive: true, force: true });
    },
  };
}

const OK_ROUTES: Record<string, (b: Record<string, unknown>) => unknown> = {
  "/ilink/bot/getconfig": () => ({ ret: 0, typing_ticket: "TK-1" }),
  "/ilink/bot/sendtyping": () => ({ ret: 0 }),
  "/ilink/bot/sendmessage": () => ({ ret: 0 }),
};

const INBOUND = (token?: string) => ({
  from_user_id: "u1",
  item_list: [{ type: 1, text_item: { text: "你好" } }],
  ...(token !== undefined ? { context_token: token } : {}),
});

describe("ILinkClient 契约(getconfig/sendtyping)", () => {
  it("getConfig:body 携带 ilink_user_id/context_token,解析 typing_ticket;ilink 头就位", async () => {
    const ff = fakeFetch({ "/ilink/bot/getconfig": () => ({ ret: 0, typing_ticket: "TK-1" }) });
    const c = new ILinkClient("tok-1", "https://fake.local", ff.impl);
    const r = await c.getConfig("u1", "CTX");
    expect(r.errcode).toBe(0);
    expect(r.typingTicket).toBe("TK-1");
    const call = callsOf(ff.calls, "/ilink/bot/getconfig")[0]!;
    expect(call.body.ilink_user_id).toBe("u1");
    expect(call.body.context_token).toBe("CTX");
    expect(call.headers.AuthorizationType).toBe("ilink_bot_token");
    expect(String(call.headers["X-WECHAT-UIN"])).toBeTruthy();
  });

  it("sendTyping:body 携带 ilink_user_id/typing_ticket/status(2=结束,非 0)", async () => {
    const ff = fakeFetch({ "/ilink/bot/sendtyping": () => ({ ret: 0 }) });
    const c = new ILinkClient("tok-1", "https://fake.local", ff.impl);
    const r = await c.sendTyping("u1", "TK-1", 2);
    expect(r.errcode).toBe(0);
    const call = callsOf(ff.calls, "/ilink/bot/sendtyping")[0]!;
    expect(call.body).toMatchObject({ ilink_user_id: "u1", typing_ticket: "TK-1", status: 2 });
  });
});

describe("typing 编排(§4.6 表达力 L5,best-effort)", () => {
  it("runner 期间周期 sendtyping status=1,结束补 status=2;ticket 缓存只取一次", async () => {
    const stateFile = tmpStateFile();
    const { ff, channel, cleanup } = assembleChannel(OK_ROUTES, 100, { typingRefreshMs: 30, stateFile });
    try {
      channel.ingest(INBOUND("CTX1"));
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      await sleep(30); // stop() 的 status=2 与 sendmessage 同段,留一点余量
      const typingCalls = callsOf(ff.calls, "/ilink/bot/sendtyping");
      const starts = typingCalls.filter((c) => c.body.status === 1);
      const stops = typingCalls.filter((c) => c.body.status === 2);
      expect(starts.length).toBeGreaterThanOrEqual(2);   // 100ms 任务 + 30ms 刷新 → 至少 2 次
      expect(stops.length).toBe(1);                       // 结束清除一次
      expect(callsOf(ff.calls, "/ilink/bot/getconfig")).toHaveLength(1); // TTL 内复用 ticket
    } finally { cleanup(); }
  });

  it("getconfig 失败 → typing 整体静默降级,回复照常送达", async () => {
    const stateFile = tmpStateFile();
    const { ff, channel, cleanup } = assembleChannel(
      { ...OK_ROUTES, "/ilink/bot/getconfig": () => ({ ret: -2, errmsg: "ilink_user_id required" }) },
      20, { typingRefreshMs: 10, stateFile },
    );
    try {
      channel.ingest(INBOUND());
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      expect(callsOf(ff.calls, "/ilink/bot/sendtyping")).toHaveLength(0);
    } finally { cleanup(); }
  });

  it("sendtyping 网关报错 → 忽略,回复照常送达", async () => {
    const stateFile = tmpStateFile();
    const { ff, channel, cleanup } = assembleChannel(
      { ...OK_ROUTES, "/ilink/bot/sendtyping": () => ({ ret: -3 }) },
      20, { typingRefreshMs: 10, stateFile },
    );
    try {
      channel.ingest(INBOUND());
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      expect(callsOf(ff.calls, "/ilink/bot/sendmessage")).toHaveLength(1);
    } finally { cleanup(); }
  });
});

describe("context_token 持久化(跨重启串线)", () => {
  it("消息携带 token → state 文件落盘(0600 目录内);回复回传该 token", async () => {
    const stateFile = tmpStateFile();
    const { ff, channel, cleanup } = assembleChannel(OK_ROUTES, 10, { stateFile });
    try {
      channel.ingest(INBOUND("CTX-FRESH"));
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      expect(bodyOf(callsOf(ff.calls, "/ilink/bot/sendmessage")[0]!).context_token).toBe("CTX-FRESH");
      const saved = JSON.parse(readFileSync(stateFile, "utf-8")) as { context_tokens: Record<string, string>; updated_at: string };
      expect(saved.context_tokens.u1).toBe("CTX-FRESH");
      expect(saved.updated_at).not.toBe("");
    } finally { cleanup(); }
  });

  it("重启(新实例同 stateFile):消息无 token → 回复用持久化 token 兜底;deliver() 主动推送同样串线", async () => {
    const stateFile = tmpStateFile();
    // 第一代:写入 CTX-A(仅停轮询,state 文件保留——模拟进程重启后的磁盘状态)
    {
      const { ff, channel } = assembleChannel(OK_ROUTES, 10, { stateFile });
      channel.ingest(INBOUND("CTX-A"));
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      channel.stop();
    }
    // 第二代(模拟重启):start() 载入持久态
    const { ff, channel, cleanup } = assembleChannel(OK_ROUTES, 10, { stateFile });
    try {
      expect(channel.contextTokenOf("u1")).toBe("CTX-A");
      channel.ingest(INBOUND()); // 本次消息没有 context_token
      await waitFor(() => callsOf(ff.calls, "/ilink/bot/sendmessage").length > 0);
      expect(bodyOf(callsOf(ff.calls, "/ilink/bot/sendmessage")[0]!).context_token).toBe("CTX-A");
      // 主动推送(§4.6 规则 3:定时任务投递)
      const r = await channel.deliver("u1", "定时任务通知");
      expect(r?.errcode).toBe(0);
      expect(bodyOf(callsOf(ff.calls, "/ilink/bot/sendmessage")[1]!).context_token).toBe("CTX-A");
    } finally { cleanup(); }
  });

  it("loadWeChatChannelState:损坏/版本不符 → 安全空态", () => {
    const stateFile = tmpStateFile();
    writeFileSync(stateFile, "{不是json", "utf-8");
    expect(loadWeChatChannelState(stateFile).context_tokens).toEqual({});
    writeFileSync(stateFile, JSON.stringify({ version: 9, context_tokens: { x: "y" } }), "utf-8");
    expect(loadWeChatChannelState(stateFile).context_tokens).toEqual({});
    rmSync(join(stateFile, ".."), { recursive: true, force: true });
  });
});

describe("预算耗尽友好文案(批次二十三 C)", () => {
  it("aborted+步数预算 → 友好建议文案送达(含已完成步数),非预算中止不转写", async () => {
    const f = tmpStateFile();
    const { impl: implOk } = fakeFetch({
      "/ilink/bot/sendmessage": () => ({ ret: 0 }),
    });
    const calls: { body: Record<string, unknown> }[] = [];
    const ff = { impl: async (url: string, init?: RequestInit): Promise<Response> => {
      const body = init?.body !== undefined ? JSON.parse(init.body as string) as Record<string, unknown> : {};
      calls.push({ body });
      if (url.endsWith("/ilink/bot/getconfig")) return new Response(JSON.stringify({ ret: 0, typing_ticket: "T" }), { status: 200 });
      if (url.endsWith("/ilink/bot/sendtyping")) return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
      if (url.endsWith("/ilink/bot/sendmessage")) return new Response(JSON.stringify({ ret: 0 }), { status: 200 });
      return new Response(JSON.stringify({ ret: 499 }), { status: 200 });
    }, calls };
    void implOk;
    const channel = new WeChatChannel({
      runner: async () => ({ outcome: "aborted", error: "步数预算耗尽(16)", traceId: "tr_b" }),
      clientFactory: () => ({
        getUpdates: async () => ({ errcode: 499 }),
        getConfig: async () => ({ errcode: -1 }),
        sendTyping: async () => ({ errcode: -1 }),
        sendMessage: async (_t: string, content: string) => { sent.push(content); return { errcode: 0 }; },
      }) as never,
      typingRefreshMs: 10_000,
      stateFile: f,
    });
    const sent: string[] = [];
    channel.start({ bot_token: "t", bound_at: "2026-10-06T00:00:00Z" });
    try {
      channel.ingest({ from_user_id: "u9", item_list: [{ type: 1, text_item: { text: "帮我调研3件事" } }] });
      await new Promise((r) => setTimeout(r, 300));
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("分头调研");
      expect(sent[0]).toContain("spawn_agent");
      expect(sent[0]).not.toContain("步数预算耗尽(16)");  // 内部错误串不直发
    } finally { channel.stop(); rmSync(join(f, ".."), { recursive: true, force: true }); void ff; }
  });
});

describe("长回复分段发送(批次二十四②)", () => {
  it("splitForWeChat:短文单条无标记;长文优先换行边界切分+序号,每条≤上限", () => {
    expect(splitForWeChat("短回复")).toEqual(["短回复"]);
    const long = Array.from({ length: 30 }, (_, i) => `第${i}段:` + "调研发现的细节与来源交叉验证。".repeat(6)).join("\n"); // ~200 字/行 × 30 ≈ 6000 字
    const parts = splitForWeChat(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toMatch(/^\(1\/\d+\) /);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(WECHAT_REPLY_CHUNK_CHARS + 12); // 上限+序号头
    expect(parts.join("").replace(/\(\d+\/\d+\) /g, "").replace(/\s+/g, "")).toBe(long.replace(/\s+/g, "")); // 内容不丢
  });

  it("渠道集成:4500 字回复 → 多条有序号消息送达", async () => {
    const f = tmpStateFile();
    const sent: string[] = [];
    const channel = new WeChatChannel({
      runner: async () => ({ outcome: "success", reply: "结".repeat(4500), traceId: "tr_s" }),
      clientFactory: () => ({
        getUpdates: async () => ({ errcode: 499 }),
        getConfig: async () => ({ errcode: -1 }),
        sendTyping: async () => ({ errcode: -1 }),
        sendMessage: async (_t: string, content: string) => { sent.push(content); return { errcode: 0 }; },
      }) as never,
      typingRefreshMs: 10_000,
      stateFile: f,
    });
    channel.start({ bot_token: "t", bound_at: "2026-10-06T00:00:00Z" });
    try {
      channel.ingest({ from_user_id: "uL", item_list: [{ type: 1, text_item: { text: "长报告" } }] });
      await new Promise((r) => setTimeout(r, 300));
      expect(sent.length).toBe(3);
      expect(sent[0]).toMatch(/^\(1\/3\) /);
      expect(sent.every((x) => x.length <= 1912)).toBe(true);
      expect(sent.join("").replace(/\(\d\/3\) /g, "")).toBe("结".repeat(4500));
    } finally { channel.stop(); rmSync(join(f, ".."), { recursive: true, force: true }); }
  });
});
