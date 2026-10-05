// 工具集·第二批:clock(soaks 发现的缺口)+ web_search(博查)
// clock:纯函数,无副作用;web_search:只读外部检索(sideEffect read)。
// web_search 的 API key 从环境变量 BOCHA_API_KEY 读取(凭据库 providers.env),
// 永不入轨迹/账本(E.1);未配置时工具注册但调用返回引导提示。

import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";
import type { AgentTool, ToolRegistry } from "./tools.js";

export const TOOL_REGISTRY = serviceKey<ToolRegistry>("tools.registry");

// ── clock:当前时间 + 时区 ─────────────────────────────────

export function clockToolPlugin(): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: "tool-clock", version: "1.0.0", kind: "tool",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };
  const tool: AgentTool = {
    name: "clock",
    description: "获取当前日期时间,如 {\"timezone\": \"Asia/Shanghai\"}(缺省用系统时区);返回 ISO 格式 + 人类可读",
    sideEffect: "none",
    parameters: { type: "object", properties: { timezone: { type: "string", description: "IANA 时区名,如 Asia/Shanghai" } } },
    pluginId: "tool-clock@1.0.0",
    run(args) {
      const { timezone } = (args ?? {}) as { timezone?: string };
      const tz = typeof timezone === "string" && timezone ? timezone : Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const now = new Date();
        const human = new Intl.DateTimeFormat("zh-CN", {
          timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "long", hour12: false,
        }).format(now);
        return { content: `${now.toISOString()} (${tz})\n人类可读:${human}` };
      } catch {
        return { content: `错误:无效时区 "${tz}"(示例:Asia/Shanghai, UTC, America/New_York)`, ok: false };
      }
    },
  };
  return {
    manifest,
    module: {
      start(ctx) {
        const registry = ctx.inject(TOOL_REGISTRY).get();
        void ctx.effect("register tool: clock", () => registry.register(tool),
          () => { registry.unregister("clock"); });
      },
    },
  };
}

// ── web_search:博查搜索 ──────────────────────────────────

interface BochaResponse {
  code: number;
  data?: {
    webPages?: {
      totalEstimatedMatches?: number;
      value?: { name: string; url: string; snippet?: string; datePublished?: string }[];
    };
  };
  msg?: string;
}

export function webSearchToolPlugin(): { manifest: PluginManifest; module: PluginModule } {
  const manifest: PluginManifest = {
    name: "tool-websearch", version: "1.0.0", kind: "tool",
    provides: [], requires: ["tools.registry"], rLevel: "R0",
  };
  const tool: AgentTool = {
    name: "web_search",
    description: "搜索互联网获取最新信息,如 {\"query\": \"OpenAI 最新模型\", \"count\": 5};返回标题、链接、摘要;适合查资料/新闻/技术文档",
    sideEffect: "read",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        count: { type: "number", description: "结果条数(1-10,默认 5)" },
        freshness: { type: "string", description: "时效过滤:noLimit|oneDay|oneWeek|oneMonth|oneYear(默认 noLimit)" },
      },
      required: ["query"],
    },
    pluginId: "tool-websearch@1.0.0",
    run: async (args) => {
      const { query, count, freshness } = (args ?? {}) as { query?: string; count?: number; freshness?: string };
      if (typeof query !== "string" || !query.trim()) {
        return { content: "错误:需 {query: \"搜索词\"}", ok: false };
      }
      const apiKey = process.env.BOCHA_API_KEY;
      if (apiKey === undefined || apiKey === "") {
        return {
          content: "web_search 不可用:未配置 BOCHA_API_KEY(来源 ~/.samsara/credentials/providers.env)。请管理员执行: source ~/.samsara/credentials/providers.env 后重启守护进程。",
          ok: false,
        };
      }
      const n = Math.min(Math.max(typeof count === "number" ? count : 5, 1), 10);
      const fresh = typeof freshness === "string" && freshness !== "" ? freshness : "noLimit";
      try {
        const res = await fetch("https://api.bochaai.com/v1/web-search", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ query: query.trim(), count: n, freshness: fresh, summary: true }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) return { content: `搜索失败:网关 ${res.status}`, ok: false };
        const data = (await res.json()) as BochaResponse;
        if (data.code !== 200 || !data.data?.webPages?.value) {
          return { content: `搜索失败:${data.msg ?? "无结果"}`, ok: false };
        };
        const results = data.data.webPages.value;
        if (results.length === 0) return { content: `无搜索结果: "${query}"` };
        const lines = results.map((r, i) =>
          `${i + 1}. ${r.name}${r.datePublished !== undefined ? ` (${r.datePublished.slice(0, 10)})` : ""}\n   ${r.url}\n   ${r.snippet ?? "(无摘要)"}`,
        );
        const total = data.data.webPages.totalEstimatedMatches;
        return { content: `搜索 "${query}"(${total !== undefined ? `约 ${total} 条命中, ` : ""}返回 ${results.length} 条):\n${lines.join("\n")}` };
      } catch (err) {
        return { content: `搜索异常:${String(err).slice(0, 100)}`, ok: false };
      }
    },
  };
  return {
    manifest,
    module: {
      start(ctx) {
        const registry = ctx.inject(TOOL_REGISTRY).get();
        void ctx.effect("register tool: web_search", () => registry.register(tool),
          () => { registry.unregister("web_search"); });
      },
    },
  };
}
