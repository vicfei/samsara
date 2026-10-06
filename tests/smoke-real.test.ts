// 真 key 冒烟(隔离套件,issue #17):DashScope 检索 + 博查搜索。
// 从 memory.test.ts / tools-web.test.ts 迁出合并——单一归属 + 30s 每用例超时
// (网络等待不受套件满负载并行挤压;此前 5s 默认超时在负载下偶发超限,历史抖动根因之一)。
// 凭据从 ~/.samsara/credentials/providers.env 读取(不打印);无凭据时跳过。

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

function credKey(name: string): string | undefined {
  const credFile = `${homedir()}/.samsara/credentials/providers.env`;
  if (!existsSync(credFile)) return undefined;
  const m = new RegExp(`export ${name}="(.+)"`).exec(readFileSync(credFile, "utf-8"));
  return m?.[1];
}

describe("真 key 冒烟(隔离:30s 超时,免套件负载挤压)", () => {
  it("DashScope:text-embedding-v4 返回 1024 维;qwen3-rerank 返回相关性序", { timeout: 30_000 }, async () => {
    const key = credKey("DASHSCOPE_API_KEY");
    if (key === undefined) return; // 无凭据时跳过
    const { Kernel } = await import("../src/kernel/kernel.js");
    const { dashScopePlugin } = await import("../src/llm/embedding.js");
    const { cosine } = await import("../src/l2/memory.js");
    const { tmpStore } = await import("./helpers.js");
    const t = tmpStore();
    try {
      const kernel = new Kernel(t.store);
      const p = dashScopePlugin({ apiKey: key });
      kernel.install(p.manifest, p.module);
      await kernel.activate("retrieval-dashscope@1.0.0");
      const emb = kernel.service((await import("../src/llm/embedding.js")).EMBEDDING_SERVICE);
      const vecs = await emb.embed(["用户喜欢手冲咖啡", "部署在新加坡节点"]);
      expect(vecs).toHaveLength(2);
      expect(vecs[0]!.length).toBe(1024);
      expect(cosine(vecs[0]!, vecs[0]!)).toBeCloseTo(1, 5);
      expect(cosine(vecs[0]!, vecs[1]!)).toBeLessThan(0.99);

      const rr = kernel.service((await import("../src/llm/embedding.js")).RERANK_SERVICE);
      const ranked = await rr.rerank("咖啡怎么冲", ["用户每天喝手冲咖啡", "服务器在新加坡"], 1);
      expect(ranked.length).toBeGreaterThan(0);
      expect(ranked[0]!.index).toBe(0);
    } finally { t.cleanup(); }
  });

  it("博查 web_search:搜'Samsara agent runtime'返回带 URL 的结果", { timeout: 30_000 }, async () => {
    const key = credKey("BOCHA_API_KEY");
    if (key === undefined) return; // 无凭据时跳过
    const prev = process.env.BOCHA_API_KEY;
    process.env.BOCHA_API_KEY = key;
    try {
      const { Kernel } = await import("../src/kernel/kernel.js");
      const { toolRegistryPlugin } = await import("../src/agent/tools.js");
      const { webSearchToolPlugin } = await import("../src/agent/tools-web.js");
      const { tmpStore } = await import("./helpers.js");
      const t = tmpStore();
      try {
        const kernel = new Kernel(t.store);
        const reg = toolRegistryPlugin();
        kernel.install(reg.manifest, reg.module);
        const ws = webSearchToolPlugin();
        kernel.install(ws.manifest, ws.module);
        await kernel.activate("tool-registry@1.0.0");
        await kernel.activate("tool-websearch@1.0.0");
        const registry = kernel.service((await import("../src/agent/tools.js")).TOOL_REGISTRY);
        const tool = registry.get("web_search")!;
        const r = await tool.run({ query: "Samsara agent runtime", count: 3 }, kernel.contextFor("tool-websearch@1.0.0", { kind: "agent", id: "a1" }));
        expect(r.content).toContain("搜索");
        expect(r.content).toContain("http"); // 至少一条 URL
        console.log("  web_search 冒烟:", r.content.slice(0, 120));
      } finally { t.cleanup(); }
    } finally {
      if (prev === undefined) delete process.env.BOCHA_API_KEY;
      else process.env.BOCHA_API_KEY = prev;
    }
  });
});
