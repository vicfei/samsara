// 渠道对端信任派生(M2-S5,§4.4/K.4):allowlist 映射 / 默认级 / 派生来源入账 / 二维授权端到端
// 二维授权端到端 = P4 verify 准则:微信 guest 对端 → 拒写语义记忆 + 拒晋升技能;owner → 均放行。

import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Kernel } from "../src/kernel/kernel.js";
import { Projection } from "../src/kernel/projection.js";
import { mockChatPlugin } from "../src/llm/chat.js";
import { mockEmbeddingPlugin } from "../src/llm/embedding.js";
import { Memory, MemoryGateError } from "../src/l2/memory.js";
import { Skills, SkillGateError } from "../src/l2/skills.js";
import { WeChatChannel } from "../src/channel/wechat-ilink.js";
import { deriveTrust, grantTrust, revokeTrust, loadTrustConfig } from "../src/channel/trust.js";
import { tmpStore } from "./helpers.js";

const OWNER = { kind: "human" as const, id: "owner", trust: "owner" as const };

function tmpTrustFile(): string {
  return join(mkdtempSync(join(tmpdir(), "samsara-trust-")), "trust.json");
}

describe("信任派生(§4.4/K.4)", () => {
  it("空配置:微信未列名=guest(K.4 谨慎默认),webchat=owner(回环宪法),未知渠道=untrusted", () => {
    const f = tmpTrustFile();
    expect(deriveTrust("wechat", "wx_stranger", f)).toMatchObject({ trust: "guest", source: "default" });
    expect(deriveTrust("webchat", "browser", f)).toMatchObject({ trust: "owner", source: "default" });
    expect(deriveTrust("telegram", "12345", f)).toMatchObject({ trust: "untrusted", source: "default" });
    rmSync(join(f, ".."), { recursive: true, force: true });
  });

  it("grant → allowlist 命中该级(幂等覆盖);revoke → 回退默认;非法级拒绝", () => {
    const f = tmpTrustFile();
    grantTrust("wechat", "wx_alice", "owner", "QR 绑定自动授予", f);
    expect(deriveTrust("wechat", "wx_alice", f)).toMatchObject({ trust: "owner", source: "allowlist" });
    grantTrust("wechat", "wx_bob", "known", undefined, f);
    expect(deriveTrust("wechat", "wx_bob", f).trust).toBe("known");
    // 同 peer 再授予 → 覆盖且只有一条
    grantTrust("wechat", "wx_bob", "guest", undefined, f);
    expect(loadTrustConfig(f).channels.wechat!.allowlist.filter((g) => g.peer_id === "wx_bob")).toHaveLength(1);
    revokeTrust("wechat", "wx_alice", f);
    expect(deriveTrust("wechat", "wx_alice", f)).toMatchObject({ trust: "guest", source: "default" });
    expect(() => grantTrust("wechat", "x", "root" as never, undefined, f)).toThrow(/非法信任级/);
    // 文件 0600
    const mode = (statSync(f).mode & 0o777).toString(8);
    expect(mode).toBe("600");
    rmSync(join(f, ".."), { recursive: true, force: true });
  });
});

describe("微信渠道信任流(派生信任随消息携带)", () => {
  it("未列名对端 → runner 收到 guest actor + trustSource=default;allowlist 对端 → owner/allowlist", async () => {
    const f = tmpTrustFile();
    grantTrust("wechat", "wx_owner", "owner", undefined, f);
    const seen: { trust: string; source?: string }[] = [];
    const channel = new WeChatChannel({
      runner: async (_goal, _sk, actor, ctx) => {
        seen.push({ trust: actor.trust, source: ctx?.trustSource });
        return { outcome: "success", reply: "ok", traceId: "tr_1" };
      },
      clientFactory: () => ({
        getUpdates: async () => ({ errcode: 499 }),
        getConfig: async () => ({ errcode: -1 }),
        sendTyping: async () => ({ errcode: -1 }),
        sendMessage: async () => ({ errcode: 0 }),
      }) as never,
      typingRefreshMs: 10_000,
      trustFile: f,
    });
    channel.start({ bot_token: "t", bound_at: "2026-10-06T00:00:00Z" });
    try {
      channel.ingest({ from_user_id: "wx_stranger", item_list: [{ type: 1, text_item: { text: "你好" } }] });
      channel.ingest({ from_user_id: "wx_owner", item_list: [{ type: 1, text_item: { text: "你好" } }] });
      await waitFor(() => seen.length === 2);
      expect(seen[0]).toEqual({ trust: "guest", source: "default" });
      expect(seen[1]).toEqual({ trust: "owner", source: "allowlist" });
    } finally {
      channel.stop();
      rmSync(join(f, ".."), { recursive: true, force: true });
    }
  });
});

describe("session.open 审计(trust_level/trust_source 入账)", () => {
  it("派生结果随会话开启入账(§4.4 第 3 条)", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const projection = Projection.open(t.dir, t.store);
    const skills = new Skills(kernel, projection);
    skills.openSession("wechat:dm:wx_x", { kind: "human", id: "wx_x", trust: "guest" }, { trustSource: "default" });
    skills.openSession("wechat:dm:wx_y", { kind: "human", id: "wx_y", trust: "owner" }, { trustSource: "allowlist" });
    const opens = kernel.store.all.filter((e) => e.kind === "session.open");
    expect(opens).toHaveLength(2);
    expect(opens[0]!.payload).toMatchObject({ trust_level: "guest", trust_source: "default" });
    expect(opens[1]!.payload).toMatchObject({ trust_level: "owner", trust_source: "allowlist" });
    // 投影 sessions.trust_level 同步
    const rows = projection.db.prepare(`SELECT session_key, trust_level FROM sessions ORDER BY session_key`).all();
    expect(rows).toContainEqual({ session_key: "wechat:dm:wx_x", trust_level: "guest" });
    t.cleanup();
  });
});

describe("渠道侧二维授权端到端(P4 verify 准则)", () => {
  it("guest 对端:语义记忆拒写(闸门)+技能晋升拒绝;owner:均放行", async () => {
    const t = tmpStore();
    const kernel = new Kernel(t.store);
    const projection = Projection.open(t.dir, t.store);
    const retr = mockEmbeddingPlugin();
    kernel.install(retr.manifest, retr.module);
    await kernel.activate("retrieval-mock@1.0.0");
    const memory = new Memory(kernel, projection);
    const skills = new Skills(kernel, projection);

    const guest = { kind: "human" as const, id: "wx_stranger", trust: "guest" as const };
    const owner = { kind: "human" as const, id: "wx_owner", trust: "owner" as const };
    skills.openSession("wechat:dm:wx_stranger", guest, { trustSource: "default" });
    skills.openSession("wechat:dm:wx_owner", owner, { trustSource: "allowlist" });

    // 二维授权矩阵投影:信任级 × 资产风险——语义记忆(跨会话生效)与技能晋升(全局库)均 owner-only
    await expect(memory.write("wechat:dm:wx_stranger", "semantic", "事实", guest, { source: "agent" }))
      .rejects.toBeInstanceOf(MemoryGateError);
    await expect(memory.write("wechat:dm:wx_stranger", "episodic", "访客事件", guest, { source: "distiller" }))
      .resolves.toBeDefined(); // guest 情景记忆放行(§6.5 闸门)
    skills.write("wechat:dm:wx_stranger", "greet", "---\nname: greet\n---\n打招呼", guest);
    expect(() => skills.promote("wechat:dm:wx_stranger", "greet", guest)).toThrow(SkillGateError);

    await expect(memory.write("wechat:dm:wx_owner", "semantic", "用户偏好", owner, { source: "agent" }))
      .resolves.toBeDefined();
    skills.write("wechat:dm:wx_owner", "report", "---\nname: report\n---\n写周报", owner);
    expect(() => skills.promote("wechat:dm:wx_owner", "report", owner)).not.toThrow();
    t.cleanup();
  });
});

async function waitFor(cond: () => boolean, ms = 3_000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor 超时");
    await new Promise((done) => setTimeout(done, 10));
  }
}
