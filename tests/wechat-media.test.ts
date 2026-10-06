// 微信媒体消息(issue #5,§4.6 落地注补记):CDN 下载 + AES-128-ECB 解密入 CAS / 语音转写直通 / 失败降级
// 契约来源:Weknora adapter.go/crypto.go/longpoll.go(密钥三格式/ECB+PKCS#7/item 类型)。

import { describe, expect, it } from "vitest";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WeChatChannel, parseIlinkAesKey, decryptIlinkMedia, cdnDownloadUrl, mediaCasObject,
  WECHAT_CDN_BASE, type MediaCasObject,
} from "../src/channel/wechat-ilink";

const KEY = Buffer.from("0123456789abcdef"); // 16 字节测试密钥

/** 用 node 原生 AES-128-ECB + PKCS#7 加密夹具(与 decryptIlinkMedia 对偶) */
function encryptFixture(plain: Buffer): Buffer {
  const c = createCipheriv("aes-128-ecb", KEY, null);
  return Buffer.concat([c.update(plain), c.final()]);
}

describe("媒体工具函数(Weknora 契约)", () => {
  it("parseIlinkAesKey 三格式归一:原生 hex32 / base64(16B) / base64(hex32) → 同一 16 字节", () => {
    const hexRaw = KEY.toString("hex");                    // ③ image_item.aeskey
    const b64Raw = KEY.toString("base64");                 // ① media.aes_key 常见
    const b64Hex = Buffer.from(hexRaw, "utf-8").toString("base64"); // ② 变体
    expect(parseIlinkAesKey(hexRaw).equals(KEY)).toBe(true);
    expect(parseIlinkAesKey(b64Raw).equals(KEY)).toBe(true);
    expect(parseIlinkAesKey(b64Hex).equals(KEY)).toBe(true);
    expect(() => parseIlinkAesKey("zzz")).toThrow(/无法解析/);
    expect(() => parseIlinkAesKey("")).toThrow(/为空/);
  });

  it("decryptIlinkMedia:ECB+PKCS#7 解密往返;密文非 16 倍数拒绝", () => {
    const plain = Buffer.from("hello 媒体测试 📷", "utf-8");
    const enc = encryptFixture(plain);
    expect(decryptIlinkMedia(enc, KEY.toString("hex")).equals(plain)).toBe(true);
    expect(() => decryptIlinkMedia(Buffer.from([1, 2, 3]), KEY.toString("hex"))).toThrow(/非 16 的倍数/);
  });

  it("cdnDownloadUrl:固定基址 + 参数转义(SSRF 免疫:URL 全自构)", () => {
    const url = cdnDownloadUrl("a b&c=1");
    expect(url.startsWith(WECHAT_CDN_BASE + "/download?encrypted_query_param=")).toBe(true);
    expect(url).toContain(encodeURIComponent("a b&c=1"));
  });

  it("mediaCasObject:base64 + sha256 + 元数据", () => {
    const bytes = Buffer.from("binary-content");
    const obj = mediaCasObject("image", "x.png", bytes);
    expect(obj.schema).toBe("samsara-media/0");
    expect(obj.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Buffer.from(obj.bytes_b64, "base64").equals(bytes)).toBe(true);
    expect(obj.size_bytes).toBe(bytes.length);
  });
});

/** 装配媒体测试渠道:runner 捕获 goal;store/fetchMedia 可注入 */
function assembleMediaChannel(opts: {
  encrypted?: Buffer;
  status?: number;
  store?: { putCas(v: unknown): { cas: string } };
}) {
  const received: string[] = [];
  const stateFile = join(mkdtempSync(join(tmpdir(), "samsara-wxm-")), "state.json");
  const fetchedUrls: string[] = [];
  const channel = new WeChatChannel({
    runner: async (goal) => { received.push(goal); return { outcome: "success", reply: "收到", traceId: "tr_m" }; },
    clientFactory: () => ({
      getUpdates: async () => ({ errcode: 499 }),
      getConfig: async () => ({ errcode: -1 }),
      sendTyping: async () => ({ errcode: -1 }),
      sendMessage: async () => ({ errcode: 0 }),
    }) as never,
    typingRefreshMs: 10_000,
    stateFile,
    trustFile: join(stateFile, "..", "trust.json"),
    ...(opts.store !== undefined ? { store: opts.store } : {}),
    fetchMedia: opts.encrypted !== undefined || opts.status !== undefined
      ? (async (url: string) => {
          fetchedUrls.push(url);
          const status = opts.status ?? 200;
          const body = status === 200 ? opts.encrypted! : Buffer.from("boom");
          return new Response(body, { status });
        })
      : undefined,
  });
  channel.start({ bot_token: "t", bound_at: "2026-10-06T00:00:00Z" });
  return {
    received, fetchedUrls, channel,
    cleanup: () => { channel.stop(); rmSync(join(stateFile, ".."), { recursive: true, force: true }); },
  };
}

const PLAIN = Buffer.from("图片二进制内容(PNG 头+数据)", "utf-8");

function imageMessage(): Parameters<WeChatChannel["ingest"]>[0] {
  return {
    from_user_id: "u1", message_id: 42,
    item_list: [{ type: 2, image_item: { aeskey: KEY.toString("hex"), media: { encrypt_query_param: "EQP%test&1", aes_key: "" } } }],
    context_token: "CTX",
  };
}

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor 超时");
    await new Promise((d) => setTimeout(d, 10));
  }
}

describe("媒体消息全链路(渠道层)", () => {
  it("图片:CDN 下载→ECB 解密→入 CAS→runner 收到档案引用文案", async () => {
    const stored: MediaCasObject[] = [];
    const casOf = (v: MediaCasObject) => `sha256:${createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 24)}`;
    const ctx = assembleMediaChannel({
      encrypted: encryptFixture(PLAIN),
      store: { putCas: (v) => { stored.push(v as MediaCasObject); return { cas: casOf(v as MediaCasObject) }; } },
    });
    try {
      ctx.channel.ingest(imageMessage());
      await waitFor(() => ctx.received.length > 0);
      expect(ctx.received[0]).toContain("[图片]");
      expect(ctx.received[0]).toMatch(/已解密存档 CAS [0-9a-f]{16}…/);
      expect(ctx.fetchedUrls[0]).toContain(WECHAT_CDN_BASE);
      expect(stored).toHaveLength(1);
      expect(Buffer.from(stored[0]!.bytes_b64, "base64").equals(PLAIN)).toBe(true);
      expect(stored[0]!.kind).toBe("image");
    } finally { ctx.cleanup(); }
  });

  it("语音:voice_item.text(服务端转写)直通为文本", async () => {
    const ctx = assembleMediaChannel({});
    try {
      ctx.channel.ingest({
        from_user_id: "u1",
        item_list: [{ type: 3, voice_item: { text: "  今天天气怎么样 " } }],
      });
      await waitFor(() => ctx.received.length > 0);
      expect(ctx.received[0]).toBe("今天天气怎么样"); // trim 后直通
    } finally { ctx.cleanup(); }
  });

  it("下载失败(CDN 503):降级文案送达 runner,不静默丢消息", async () => {
    const ctx = assembleMediaChannel({ status: 503 });
    try {
      ctx.channel.ingest(imageMessage());
      await waitFor(() => ctx.received.length > 0);
      expect(ctx.received[0]).toContain("接收失败");
      expect(ctx.received[0]).toContain("CDN 503");
    } finally { ctx.cleanup(); }
  });

  it("解密失败(错误密钥):降级文案送达;超大小上限拒绝", async () => {
    const ctx = assembleMediaChannel({ encrypted: encryptFixture(PLAIN) }); // 密钥对但消息内换错钥
    try {
      ctx.channel.ingest({
        from_user_id: "u1",
        item_list: [{ type: 2, image_item: { aeskey: "ff".repeat(16), media: { encrypt_query_param: "x" } } }],
      });
      await waitFor(() => ctx.received.length > 0);
      expect(ctx.received[0]).toContain("接收失败");
    } finally { ctx.cleanup(); }
    // 超限:构造 20MB+ 密文
    const big = assembleMediaChannel({ encrypted: Buffer.alloc(21 * 1024 * 1024) });
    try {
      big.channel.ingest(imageMessage());
      await waitFor(() => big.received.length > 0);
      expect(big.received[0]).toContain("接收失败");
      expect(big.received[0]).toContain("上限");
    } finally { big.cleanup(); }
  });

  it("文件:type=4 提取 file_name 与密钥;语音/文本之外的未知 type 不炸", async () => {
    const stored: MediaCasObject[] = [];
    const ctx = assembleMediaChannel({
      encrypted: encryptFixture(PLAIN),
      store: { putCas: (v) => { stored.push(v as MediaCasObject); return { cas: "sha256:filecas" }; } },
    });
    try {
      ctx.channel.ingest({
        from_user_id: "u1", message_id: 7,
        item_list: [{ type: 4, file_item: { file_name: "报表.xlsx", len: "24", media: { encrypt_query_param: "F1", aes_key: KEY.toString("base64") } } }],
      });
      await waitFor(() => ctx.received.length > 0);
      expect(ctx.received[0]).toContain("报表.xlsx");
      expect(ctx.received[0]).toContain("[文件]");
      expect(stored[0]!.kind).toBe("file");
      // 未知 type:extractMedia=null → 走"无法提取"日志分支,runner 不收
      ctx.channel.ingest({ from_user_id: "u2", item_list: [{ type: 99 }] });
      await new Promise((d) => setTimeout(d, 150));
      expect(ctx.received).toHaveLength(1);
      expect(randomBytes(0).length).toBe(0);
    } finally { ctx.cleanup(); }
  });
});
