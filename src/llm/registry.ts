// 模型注册表(M2-S7,主文档附录 E.1/E.6:注册表并入 M2,记分卡/影子探索属 M4)
// 发现:适配器调用厂商模型清单接口(OpenAI 兼容 GET /models——DeepSeek/DashScope 同构);
// 价格:版本化资产(随库种子 + 用户表覆盖,单位整数美分/Mtok,标注来源与时效);
// 凭据:仅从环境变量解析,永不出现在缓存/轨迹/日志(E.1/附录 E.1 纪律)。
// 本模块为 M4 路由(E.2 记分卡/E.3 老虎机/E.4 影子)的数据地基——resolve() 即路由候选。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface ModelPrice {
  input_cents_per_mtok: number | null;   // 整数美分/Mtok;null=未知(不参与成本估算)
  output_cents_per_mtok: number | null;
  currency?: "USD" | "CNY";
  source: string;                        // E.1:来源与时效必须可追溯
  as_of: string;
}

export interface ModelEntry {
  id: string;                            // 厂商侧模型 id(调用时的 model 参数)
  provider: string;                      // 发现来源(providers env 派生)
  discovered_at: string;
  context_length?: number;               // 部分厂商在 /models 返回;缺席则无
  tags?: string[];                       // 能力标签(E.1;M4 路由约束输入)
  price?: ModelPrice;
}

export interface RegistryCache {
  schema: "samsara-models/1";
  refreshed_at: string;
  models: ModelEntry[];
}

interface PriceTable {
  schema: string;
  as_of?: string;
  models: Record<string, ModelPrice>;
}

interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;      // 内存中转,永不落盘
  defaultModel?: string;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

// ── 提供者发现(密钥仅存在于进程内存)────────────────────────

export function configuredProviders(): ProviderConfig[] {
  const out: ProviderConfig[] = [];
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey !== undefined && openaiKey !== "") {
    const baseUrl = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
    const model = process.env.OPENAI_MODEL;
    const name = baseUrl.includes("deepseek") || (model ?? "").startsWith("deepseek") ? "deepseek" : "openai-compat";
    out.push({ name, baseUrl, apiKey: openaiKey, ...(model !== undefined ? { defaultModel: model } : {}) });
  }
  const dashKey = process.env.DASHSCOPE_API_KEY;
  if (dashKey !== undefined && dashKey !== "") {
    out.push({ name: "dashscope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: dashKey });
  }
  return out;
}

// ── 注册表 ───────────────────────────────────────────────

export interface RegistryOptions {
  cacheFile?: string;        // 默认 ~/.samsara/models.json
  userPriceFile?: string;    // 默认 ~/.samsara/price-table.json(覆盖随库种子)
  fetchImpl?: FetchLike;     // 测试注入
}

export class ModelRegistry {
  private readonly cacheFile: string;
  private readonly userPriceFile: string;
  private readonly fetchImpl: FetchLike;
  private cache: RegistryCache | null = null;

  constructor(opts: RegistryOptions = {}) {
    const home = process.env.SAMSARA_HOME ?? join(homedir(), ".samsara");
    this.cacheFile = opts.cacheFile ?? join(home, "models.json");
    this.userPriceFile = opts.userPriceFile ?? join(home, "price-table.json");
    this.fetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  }

  /** 缓存载入(无缓存=空表) */
  load(): RegistryCache {
    if (this.cache === null) {
      try {
        this.cache = existsSync(this.cacheFile)
          ? JSON.parse(readFileSync(this.cacheFile, "utf-8")) as RegistryCache
          : { schema: "samsara-models/1", refreshed_at: "", models: [] };
        if (this.cache.schema !== "samsara-models/1" || !Array.isArray(this.cache.models)) {
          this.cache = { schema: "samsara-models/1", refreshed_at: "", models: [] };
        }
      } catch { this.cache = { schema: "samsara-models/1", refreshed_at: "", models: [] }; }
    }
    return this.cache;
  }

  /** 刷新(接口 §3.7 registry.refresh):逐提供者拉清单 → 合并价格 → 落缓存。
   *  单提供者失败不拖垮整次刷新(E.1"给密钥即可发现";网关抖动降级) */
  async refresh(): Promise<RegistryCache> {
    const now = new Date().toISOString();
    const byId = new Map<string, ModelEntry>(this.load().models.map((m) => [`${m.provider}/${m.id}`, m]));
    for (const p of configuredProviders()) {
      try {
        const res = await this.fetchImpl(`${p.baseUrl.replace(/\/+$/, "")}/models`, {
          headers: { authorization: `Bearer ${p.apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) continue;
        const data = (await res.json()) as { data?: { id: string; context_length?: number; max_model_len?: number; max_context_length?: number }[] };
        for (const m of data.data ?? []) {
          if (typeof m?.id !== "string" || m.id === "") continue;
          const ctx = m.context_length ?? m.max_model_len ?? m.max_context_length;
          byId.set(`${p.name}/${m.id}`, {
            id: m.id, provider: p.name, discovered_at: now,
            ...(typeof ctx === "number" ? { context_length: ctx } : {}),
          });
        }
      } catch { /* 该提供者缺席:保留缓存既有条目 */ }
    }
    const models = [...byId.values()].map((m) => {
      const price = this.priceOf(m.id);
      return price !== undefined ? { ...m, price } : m;
    });
    this.cache = { schema: "samsara-models/1", refreshed_at: now, models };
    this.persist();
    return this.cache;
  }

  /** 模型清单:发现缓存 + 价格读取时合并(价格是独立版本化资产——改价格表即时生效,无需重新发现) */
  list(): ModelEntry[] {
    return this.load().models.map((m) => {
      const price = this.priceOf(m.id);
      return price !== undefined ? { ...m, price } : m;
    });
  }

  /** 路由候选解析(M4 地基):显式 id 优先(可跨提供者),否则 env 默认模型,否则首条 */
  resolve(id?: string): ModelEntry | undefined {
    const models = this.list();
    if (models.length === 0) return undefined;
    if (id !== undefined) {
      const hit = models.find((m) => m.id === id) ?? models.find((m) => `${m.provider}/${m.id}` === id);
      if (hit !== undefined) return hit;
    }
    const envDefault = process.env.OPENAI_MODEL;
    if (envDefault !== undefined) {
      const hit = models.find((m) => m.id === envDefault);
      if (hit !== undefined) return hit;
    }
    return models[0];
  }

  /** 价格解析:用户表(权威,用户确认) → 随库种子;null 字段=未知 */
  private priceOf(modelId: string): ModelPrice | undefined {
    return this.readPriceTable(this.userPriceFile)?.models[modelId]
      ?? this.readPriceTable(join(import.meta.dirname, "price-table.json"))?.models[modelId];
  }

  private readPriceTable(file: string): PriceTable | undefined {
    try {
      if (!existsSync(file)) return undefined;
      const t = JSON.parse(readFileSync(file, "utf-8")) as PriceTable;
      return t.models !== undefined && typeof t.models === "object" ? t : undefined;
    } catch { return undefined; }
  }

  private persist(): void {
    try {
      mkdirSync(join(this.cacheFile, ".."), { recursive: true });
      writeFileSync(this.cacheFile, JSON.stringify(this.cache, null, 2));
    } catch { /* 缓存失败不阻断发现(内存表照常服务) */ }
  }
}
