// 渠道对端信任派生(附录 K.4 → 主文档 §4.4"渠道对端信任派生",M2-S5)
// 信任栈 T1-T3 认证的是 WS 设备;聊天渠道的对端(微信 peer/浏览器 peer)无设备身份——
// 信任级别由渠道配置推导:peer→trust 映射(allowlist)+ 未列名默认(K.4:未列名私聊 guest,
// 谨慎优先 untrusted;webchat 回环=owner 属宪法层条款)。
// 映射载体:~/.samsara/trust.json(0600,渠道配置——非账本事实;运行时推导来源随
// session.open 入账(trust_source),审计可查。映射变更 = R2 级操作:文件仅 owner 本地可写)。

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TrustLevel } from "../kernel/types.js";

export interface TrustGrant {
  peer_id: string;
  trust: TrustLevel;          // owner / known / guest / untrusted
  granted_at: string;
  note?: string;              // 溯源(如 "wechat QR 绑定自动授予")
}

export interface ChannelTrustConfig {
  /** 未列名对端默认信任级;缺省用代码级默认(见 DEFAULT_TRUST) */
  default_trust?: TrustLevel;
  allowlist: TrustGrant[];
}

export interface TrustConfig {
  version: 1;
  channels: Record<string, ChannelTrustConfig>;
}

/** 渠道级代码默认(文件未配置时):微信私聊未列名=guest(K.4 谨慎优先);
 *  webchat=owner(回环绑定属宪法层条款,默认回环=本机主人);未知渠道=untrusted(宁严勿宽) */
export const DEFAULT_TRUST: Record<string, TrustLevel> = {
  wechat: "guest",
  webchat: "owner",
};
export const UNKNOWN_CHANNEL_TRUST: TrustLevel = "untrusted";

export interface DerivedTrust {
  trust: TrustLevel;
  source: "allowlist" | "default";  // K.4:推导来源随 session.open 入账
  grant?: TrustGrant;
}

const trustFileDefault = (): string =>
  join(process.env.SAMSARA_HOME ?? join(homedir(), ".samsara"), "trust.json");

const VALID_LEVELS: readonly TrustLevel[] = ["owner", "known", "guest", "untrusted"];

export function loadTrustConfig(file = trustFileDefault()): TrustConfig {
  try {
    if (!existsSync(file)) return { version: 1, channels: {} };
    const cfg = JSON.parse(readFileSync(file, "utf-8")) as TrustConfig;
    if (cfg.version !== 1 || typeof cfg.channels !== "object" || cfg.channels === null) {
      return { version: 1, channels: {} };
    }
    return cfg;
  } catch { return { version: 1, channels: {} }; }
}

export function saveTrustConfig(cfg: TrustConfig, file = trustFileDefault()): void {
  const dir = join(file, "..");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2));
  chmodSync(file, 0o600);
}

/** 授予/更新一条映射(幂等:同 peer 覆盖;R2 语义=仅 owner 本地进程可调) */
export function grantTrust(
  channel: string, peerId: string, trust: TrustLevel, note?: string, file = trustFileDefault(),
): TrustConfig {
  if (!VALID_LEVELS.includes(trust)) throw new Error(`非法信任级: ${trust}(合法:${VALID_LEVELS.join("/")})`);
  if (channel === "" || peerId === "") throw new Error("channel/peer_id 不能为空");
  const cfg = loadTrustConfig(file);
  const ch = cfg.channels[channel] ?? { allowlist: [] };
  const granted: TrustGrant = { peer_id: peerId, trust, granted_at: new Date().toISOString(), ...(note !== undefined ? { note } : {}) };
  ch.allowlist = [...ch.allowlist.filter((g) => g.peer_id !== peerId), granted];
  cfg.channels[channel] = ch;
  saveTrustConfig(cfg, file);
  return cfg;
}

/** 撤销映射(未列名回退默认级;幂等:不存在也成功) */
export function revokeTrust(channel: string, peerId: string, file = trustFileDefault()): TrustConfig {
  const cfg = loadTrustConfig(file);
  const ch = cfg.channels[channel];
  if (ch !== undefined) {
    ch.allowlist = ch.allowlist.filter((g) => g.peer_id !== peerId);
    cfg.channels[channel] = ch;
    saveTrustConfig(cfg, file);
  }
  return cfg;
}

/** 信任派生(§4.4):allowlist 命中→该级;否则渠道默认(文件覆盖或代码默认);未知渠道 untrusted */
export function deriveTrust(channel: string, peerId: string, file = trustFileDefault()): DerivedTrust {
  const cfg = loadTrustConfig(file);
  const ch = cfg.channels[channel];
  const grant = ch?.allowlist.find((g) => g.peer_id === peerId && VALID_LEVELS.includes(g.trust));
  if (grant !== undefined) return { trust: grant.trust, source: "allowlist", grant };
  const trust = ch?.default_trust !== undefined && VALID_LEVELS.includes(ch.default_trust)
    ? ch.default_trust
    : DEFAULT_TRUST[channel] ?? UNKNOWN_CHANNEL_TRUST;
  return { trust, source: "default" };
}
