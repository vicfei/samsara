// 模型注册表(M2-S7,附录 E.1/E.6):厂商清单发现 / 价格表合并(用户>种子) / 凭据不落盘 / 路由候选解析

import { describe, expect, it, afterEach } from "vitest";
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, configuredProviders } from "../src/llm/registry.js";

const ENV_KEYS = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL", "DASHSCOPE_API_KEY"] as const;
const saved: Record<string, string | undefined> = {};
beforeEachEnv();

function beforeEachEnv(): void {
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
}
function afterEachEnv(): void {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}
afterEach(afterEachEnv);

function tmpFiles(): { cache: string; userPrice: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "samsara-reg-"));
  return { cache: join(dir, "models.json"), userPrice: join(dir, "price-table.json"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** fake fetch:按 baseUrl 前缀路由 /models */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const impl = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = Object.entries(routes).find(([base]) => url.startsWith(base));
    const body = hit !== undefined ? hit[1] : { data: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { impl, calls };
}

describe("提供者发现(env 派生)", () => {
  it("无密钥=零提供者;DeepSeek 网关/模型名 → provider=deepseek", () => {
    expect(configuredProviders()).toHaveLength(0);
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.OPENAI_BASE_URL = "https://api.deepseek.com/v1";
    const ps = configuredProviders();
    expect(ps).toHaveLength(1);
    expect(ps[0]!.name).toBe("deepseek");
    process.env.DASHSCOPE_API_KEY = "dsk-y";
    expect(configuredProviders()).toHaveLength(2);
  });
});

describe("注册表 refresh/list/resolve", () => {
  it("拉取厂商清单入缓存;context_length 识别;Bearer 携带但密钥不落盘", async () => {
    const f = tmpFiles();
    process.env.OPENAI_API_KEY = "sk-secret-do-not-leak";
    process.env.OPENAI_BASE_URL = "https://fake.deepseek/v1";
    const ff = fakeFetch({ "https://fake.deepseek/v1": { data: [{ id: "deepseek-chat", context_length: 65536 }, { id: "deepseek-reasoner", max_model_len: 131072 }] } });
    const reg = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: ff.impl });
    try {
      const cache = await reg.refresh();
      expect(cache.models).toHaveLength(2);
      const chat = cache.models.find((m) => m.id === "deepseek-chat")!;
      expect(chat.provider).toBe("deepseek");
      expect(chat.context_length).toBe(65536);
      // 密钥只在请求头,永不出现在缓存
      expect(ff.calls[0]!.headers.authorization).toBe("Bearer sk-secret-do-not-leak");
      const persisted = readFileSync(f.cache, "utf-8");
      expect(persisted).not.toContain("sk-secret-do-not-leak");
      // 跨提供者去重键:provider/id
      expect(new Set(cache.models.map((m) => `${m.provider}/${m.id}`)).size).toBe(2);
    } finally { f.cleanup(); }
  });

  it("单提供者网关故障:降级保留缓存既有条目,不拖垮刷新", async () => {
    const f = tmpFiles();
    process.env.OPENAI_API_KEY = "sk-a";
    process.env.OPENAI_BASE_URL = "https://fake.ok/v1";
    process.env.DASHSCOPE_API_KEY = "sk-broken";
    const okRoutes = fakeFetch({ "https://fake.ok/v1": { data: [{ id: "m-ok" }] } });
    let okProviderUp = true;
    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.startsWith("https://dashscope")) return new Response("boom", { status: 503 });
      if (!okProviderUp) return new Response("boom", { status: 503 });
      return okRoutes.impl(url, init);
    };
    const reg = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: impl });
    try {
      await reg.refresh(); // dashscope 503,openai 兼容端点正常
      expect(reg.list().map((m) => m.id)).toEqual(["m-ok"]);
      okProviderUp = false; // 全部网关故障
      const cache = await reg.refresh();
      expect(cache.models.map((m) => m.id)).toEqual(["m-ok"]); // 既有条目保留(降级)
    } finally { f.cleanup(); }
  });

  it("价格合并:用户表覆盖种子;null=未知不参与估算;来源时效随行", async () => {
    const f = tmpFiles();
    process.env.OPENAI_API_KEY = "sk-a";
    process.env.OPENAI_BASE_URL = "https://fake.p/v1";
    writeFileSync(f.userPrice, JSON.stringify({
      schema: "samsara-price-table/1",
      as_of: "2026-10-06",
      models: { "deepseek-chat": { input_cents_per_mtok: 27, output_cents_per_mtok: 110, currency: "USD", source: "用户确认", as_of: "2026-10-06" } },
    }));
    const ff = fakeFetch({ "https://fake.p/v1": { data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] } });
    const reg = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: ff.impl });
    try {
      await reg.refresh();
      const chat = reg.list().find((m) => m.id === "deepseek-chat")!;
      expect(chat.price).toMatchObject({ input_cents_per_mtok: 27, output_cents_per_mtok: 110, source: "用户确认" });
      const reasoner = reg.list().find((m) => m.id === "deepseek-reasoner")!;
      expect(reasoner.price?.input_cents_per_mtok ?? null).toBeNull(); // 种子无此行 → 未知
    } finally { f.cleanup(); }
  });

  it("价格读取时合并:改用户价格表即时生效,无需重新发现(refresh 后改表→list 反映)", async () => {
    const f = tmpFiles();
    process.env.OPENAI_API_KEY = "sk-a";
    process.env.OPENAI_BASE_URL = "https://fake.q/v1";
    const ff = fakeFetch({ "https://fake.q/v1": { data: [{ id: "m-a" }] } });
    const reg = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: ff.impl });
    try {
      await reg.refresh();
      expect(reg.list()[0]!.price).toBeUndefined(); // 表中无 m-a → 未知
      writeFileSync(f.userPrice, JSON.stringify({
        schema: "samsara-price-table/1",
        models: { "m-a": { input_cents_per_mtok: 11, output_cents_per_mtok: 22, source: "用户确认", as_of: "2026-10-06" } },
      }));
      expect(reg.list()[0]!.price).toMatchObject({ input_cents_per_mtok: 11, output_cents_per_mtok: 22 });
    } finally { f.cleanup(); }
  });

  it("resolve:显式 id > env 默认 > 首条;空表 undefined", async () => {
    const f = tmpFiles();
    const reg = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: fakeFetch({}).impl });
    try {
      expect(reg.resolve()).toBeUndefined();
      process.env.OPENAI_MODEL = "m-default";
      // 手工种缓存
      writeFileSync(f.cache, JSON.stringify({
        schema: "samsara-models/1", refreshed_at: "t",
        models: [
          { id: "m-a", provider: "p", discovered_at: "t" },
          { id: "m-default", provider: "p", discovered_at: "t" },
        ],
      }));
      const fresh = new ModelRegistry({ cacheFile: f.cache, userPriceFile: f.userPrice, fetchImpl: fakeFetch({}).impl });
      expect(fresh.resolve()?.id).toBe("m-default");       // env 默认
      expect(fresh.resolve("m-a")?.id).toBe("m-a");        // 显式 id 优先
    } finally { f.cleanup(); }
  });
});
