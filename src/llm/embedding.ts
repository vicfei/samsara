// 检索适配器(M2-S3 记忆层,主文档 §6.5 读取路径)
//   embedding 召回(不耗对话 LLM)+ rerank 重排(③ 类调用);
//   模型即插件:DashScope 提供者(text-embedding-v4 兼容端点 + qwen3-rerank 原生端点),
//   mock 提供者确定性向量(测试与无密钥演示,零网络)。
// 凭据:DASHSCOPE_API_KEY(附录 E.1 纪律——永不入轨迹/账本)。

import { createHash } from "node:crypto";
import { serviceKey } from "../kernel/types.js";
import type { PluginManifest, PluginModule } from "../kernel/types.js";
import type { KernelContext } from "../kernel/types.js";

// ── 服务契约 ─────────────────────────────────────────────

export interface EmbeddingService {
  /** 批量向量化(实现方自行按 batch 上限分片);返回与输入等长的向量数组 */
  embed(texts: string[]): Promise<number[][]>;
  /** 向量维度(供调用方校验/存储标注) */
  readonly dim: number;
  readonly modelLabel: string;
}

export interface RerankResult {
  index: number;        // documents 中的原始下标
  score: number;
}

export interface RerankService {
  rerank(query: string, documents: string[], topN?: number): Promise<RerankResult[]>;
  readonly modelLabel: string;
}

export const EMBEDDING_SERVICE = serviceKey<EmbeddingService>("llm.embedding");
export const RERANK_SERVICE = serviceKey<RerankService>("llm.rerank");

// spec-constants: memory_embedding_dim / memory_embed_batch_max
export const MEMORY_EMBEDDING_DIM = 1024;
export const MEMORY_EMBED_BATCH_MAX = 10;

// ── Mock 提供者:确定性词袋哈希向量——共享稀有词 → 高余弦,测试可控 ──

function tokenize(text: string): string[] {
  // CJK 逐字 + 连续拉丁/数字成词;停用高频单字对相似度贡献很小,不另维护停用表
  const tokens: string[] = [];
  for (const seg of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!seg) continue;
    if (/^[\p{Script=Han}]+$/u.test(seg)) tokens.push(...seg);
    else tokens.push(seg);
  }
  return tokens;
}

export function mockVector(text: string, dim = MEMORY_EMBEDDING_DIM): number[] {
  const v = new Array<number>(dim).fill(0);
  for (const tok of tokenize(text)) {
    const h = createHash("sha256").update(tok).digest();
    const axis = h[0]! % dim;
    v[axis] = (v[axis] ?? 0) + 1 + (h[1]! % 8) / 8;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => Number((x / norm).toFixed(6)));
}

export function mockEmbeddingPlugin(dim = MEMORY_EMBEDDING_DIM): { manifest: PluginManifest; module: PluginModule } {
  return {
    manifest: {
      name: "retrieval-mock", version: "1.0.0", kind: "tool",
      provides: ["llm.embedding", "llm.rerank"], requires: [], rLevel: "R0",
    },
    module: {
      start(ctx: KernelContext) {
        ctx.provide(EMBEDDING_SERVICE, {
          dim, modelLabel: "mock-embed",
          async embed(texts: string[]) { return texts.map((t) => mockVector(t, dim)); },
        });
        ctx.provide(RERANK_SERVICE, {
          modelLabel: "mock-rerank",
          // 重排 = 词重叠率(确定性,无网络):测试可用关键词断言顺序
          async rerank(query: string, documents: string[], topN?: number) {
            const q = new Set(tokenize(query));
            const scored = documents.map((d, index) => {
              const toks = tokenize(d);
              const overlap = toks.filter((t) => q.has(t)).length / (toks.length || 1);
              return { index, score: Number(overlap.toFixed(6)) };
            });
            scored.sort((a, b) => b.score - a.score);
            return topN !== undefined ? scored.slice(0, topN) : scored;
          },
        });
      },
    },
  };
}

// ── DashScope 提供者:embedding 走 OpenAI 兼容端点,rerank 走原生端点 ──

export interface DashScopeOptions {
  apiKey?: string;      // 默认 env DASHSCOPE_API_KEY
  baseUrl?: string;     // 默认 https://dashscope.aliyuncs.com(兼容端点拼 compatible-mode/v1)
  embeddingModel?: string;  // 默认 env DASHSCOPE_EMBEDDING_MODEL 或 text-embedding-v4
  rerankModel?: string;     // 默认 env DASHSCOPE_RERANK_MODEL 或 qwen3-rerank
  dim?: number;             // 默认 memory_embedding_dim(1024)
}

interface FetchLike { (url: string, init?: RequestInit): Promise<Response> }

export function dashScopePlugin(opts: DashScopeOptions & { fetchImpl?: FetchLike } = {}): {
  manifest: PluginManifest; module: PluginModule;
} {
  const fetchImpl = opts.fetchImpl ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const base = (opts.baseUrl ?? "https://dashscope.aliyuncs.com").replace(/\/+$/, "");
  const embModel = opts.embeddingModel ?? process.env.DASHSCOPE_EMBEDDING_MODEL ?? "text-embedding-v4";
  const rkModel = opts.rerankModel ?? process.env.DASHSCOPE_RERANK_MODEL ?? "qwen3-rerank";
  const dim = opts.dim ?? MEMORY_EMBEDDING_DIM;
  return {
    manifest: {
      name: "retrieval-dashscope", version: "1.0.0", kind: "tool",
      provides: ["llm.embedding", "llm.rerank"], requires: [], rLevel: "R0",
    },
    module: {
      start(ctx: KernelContext) {
        const apiKey = opts.apiKey ?? process.env.DASHSCOPE_API_KEY;
        if (!apiKey) throw new Error("DASHSCOPE_API_KEY 未配置(检索提供者拒绝启动,服务不半价)");
        ctx.provide(EMBEDDING_SERVICE, {
          dim, modelLabel: embModel,
          async embed(texts: string[]): Promise<number[][]> {
            const out: number[][] = [];
            for (let i = 0; i < texts.length; i += MEMORY_EMBED_BATCH_MAX) {
              const batch = texts.slice(i, i + MEMORY_EMBED_BATCH_MAX);
              const res = await fetchImpl(`${base}/compatible-mode/v1/embeddings`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ model: embModel, input: batch, dimensions: dim }),
              });
              if (!res.ok) throw new Error(`embedding 网关 ${res.status}: ${(await res.text()).slice(0, 200)}`);
              const data = (await res.json()) as { data?: { embedding: number[]; index: number }[] };
              const rows = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
              if (rows.length !== batch.length) throw new Error(`embedding 返回数量不符(${rows.length}/${batch.length})`);
              for (const r of rows) {
                if (r.embedding.length !== dim) throw new Error(`embedding 维度不符(${r.embedding.length}/${dim})`);
                out.push(r.embedding.map((x) => Number(x.toFixed(6))));
              }
            }
            return out;
          },
        });
        ctx.provide(RERANK_SERVICE, {
          modelLabel: rkModel,
          async rerank(query: string, documents: string[], topN?: number) {
            const res = await fetchImpl(`${base}/api/v1/services/rerank/text-rerank/text-rerank`, {
              method: "POST",
              headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
              body: JSON.stringify({
                model: rkModel,
                input: { query, documents },
                parameters: { return_documents: false, ...(topN !== undefined ? { top_n: topN } : {}) },
              }),
            });
            if (!res.ok) throw new Error(`rerank 网关 ${res.status}: ${(await res.text()).slice(0, 200)}`);
            const data = (await res.json()) as {
              output?: { results?: { index: number; relevance_score?: number }[] };
            };
            return (data.output?.results ?? []).map((r) => ({ index: r.index, score: r.relevance_score ?? 0 }));
          },
        });
      },
    },
  };
}
