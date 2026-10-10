# Samsara

**A self-hosted, safely self-improving agent runtime.** Samsara is a personal agent platform
built for Recursive Self-Improvement (RSI) *without* giving up auditability, reversibility,
or control: every state change lands on a hash-chained append-only ledger, every side effect
is reversible-or-accounted-for, and every self-modification passes tiered authorization gates.

> **Samsara**(轮回)—— the cycle of rebirth. The name is the architecture: roll back, replay,
> and improve, endlessly.

[中文版 README](README.zh-CN.md) · [Design docs (Chinese)](.context/design/) · [Governance ledger](.context/design/closure-ledger.yaml)

---

## Why Samsara Is Different

Most agent frameworks optimize for *capability*. Samsara optimizes for **composable trust** —
the property that makes recursive self-improvement survivable:

### 1. Time & Space Composability (L0 kernel)

- **Temporal composability** — every side effect is classified into three reversibility classes
  (reversible / compensable / irreversible-with-preapproval) and registered as an *effect* on the
  ledger. Kill an agent, dispose a plugin, or roll back to any point in history — the environment
  is restored honestly, including *"rolling back a rollback"* (generalized time travel: `rollbackTo(seq)` + `redo`).
- **Spatial composability** — plugins compose through reactive co-effects: suspending a provider
  cascades to its dependents; dependencies reactivating revive their waiters. The system converges
  no matter what order you activate things in.
- **Confluence, proven** — INV-1 ("any activation/deactivation sequence converges to the same
  quiescent state as dependency-ordered one-shot composition") is not a hope; it is pinned by
  property-based tests that randomize thousands of interleavings.

### 2. The Ledger Is the Truth, Everything Else Is a Projection

All state transitions — plugin lifecycles, effects, sessions, skills, memory writes, jobs,
trust changes, reviews — flow through **one hash-chained append-only log** (INV-4 single-writer).
Everything else (SQLite read models, Parquet traces, snapshots) is a *projection* that can be
deleted and rebuilt by replay. Crash recovery = load snapshot + replay tail + rebind effects.

### 3. Authorization Algebra (M3)

Spawned sub-agents obey three enforced inequalities — capabilities only shrink, budgets strictly
decrease, permission ceilings only lower — so **any derivation tree provably terminates**, with
no runtime supervisor needed. Depth beyond the soft limit requires owner approval (recorded in
the review ledger); the hard cap is absolute.

### 4. Workspace Write Capture with an SLO

File writes in a session workspace pass through a copy-on-first-write overlay backed by **one**
ledger effect per session (not per write) — measured interception overhead at 100 concurrent
sessions: **1.00–1.04×** vs raw writes (SLO ≤1.10×). `commit` archives a diff manifest to
content-addressed storage; `discard`/kill restores `git status`-level cleanliness.

### 5. Three-Layer Memory With Poisoning Defense

Episodic memory is distilled from conversations (idle-time or shutdown); semantic memory crosses
sessions only through a **trust-gated write path** (owner-only, content lint against
instruction/authorization patterns, full provenance). Recall = embedding similarity → rerank →
context injection, with graceful degradation to recency when retrieval is unavailable.

### 6. Governance as Code

The design itself is versioned and machine-checked:
- **Closure ledger** — 90 adjudicated entries (written-back / verified / designed) with
  machine-checkable assertions;
- **Spec constants registry** — 59 registered constants; every threshold in code must trace to an
  authority section in the docs;
- **Freeze checker + ledger asserter** — CI-style gates that turn red on documentation drift.

### 7. Channels Without Inbound Ports

WeChat personal-account bot (Tencent iLink): pure-outbound long polling — QR binding with
locally-rendered codes (no third-party QR service), typing indicators, media decryption
(AES-128-ECB from CDN), cross-restart conversation threading, trust-derived peer levels
(the binding owner is `owner`; strangers are `guest`), and bounded lane dispatch.

---

## Architecture

```
L3  Meta-improvement   tiered self-modification (R-gated, human review)      [M4/M5]
L2  Experience assets  skills / memory / branches — COW, version trees,
                       promotion pipelines with lint+shadow gates
L1  Execution          ReAct loop, spawner + authorization algebra,
                       workspace write capture, lane queues
L0  Composable kernel  Context / three-class effects / reactive co-effects /
                       hash-chain ledger / snapshots / crash recovery / projections
L0.5 Access plane      channels (WeChat iLink, WebChat), trust stack, worker isolation
```

Five constitutional invariants (INV-1 confluence, INV-2 reversibility, INV-3 capability
monotonic decay, INV-4 single writer, INV-5 constitution untouchable) are enforced by tests —
including exhaustive random derivation-tree tests and kill-without-residue (environment hash
restoration) suites.

## Status

| Milestone | Scope | State |
|---|---|---|
| **M0** | Composable kernel: effects, ledger, snapshots, replay, rebinding, time travel | ✅ shipped |
| **M1** | ReAct loop, WebChat, minimal L2 (skills), ReplayBundle, Parquet traces | ✅ shipped |
| **M2** | Scheduler (NL→cron), tools, three-layer memory, WeChat channel, trust stack, worker isolation, model registry | ✅ shipped (7/7 slices) |
| **M3** | Spawner + authorization algebra, bounded lanes, workspace write capture (SLO met) | ✅ shipped |
| **M4a/M4b** | Asset evolution / model routing | planned |
| **M5** | Hardening, soak, security audit | planned |

**156/156 tests green** (PBT conformance, crash-recovery fuzz, worker-isolation penetration
tests, SLO benchmarks, real-key smoke tests) · governance gates green.

## Quick Start

```bash
npm install
npm test                                   # 156 tests
npm run cli -- run "write a one-line status update"
npm run cli -- webchat                     # daemon: WebChat + scheduler + memory + WeChat
npm run cli -- job add "weekly report every Friday 9am"   # natural language → cron
npm run cli -- wechat bind                 # bind your WeChat (QR, locally rendered)
npm run cli -- wechat status               # binding & polling state
npm run cli -- memory ls                   # three-layer memory
npm run cli -- trust ls                    # peer trust mapping
npm run cli -- models ls --refresh         # model registry (credentials never persisted)
npm run cli -- workspace ls <sessionKey>   # session workspace diff
npm run cli -- doctor                      # ledger chain / CAS / projection / Parquet audit
npm run demo                               # seven kernel capability demos
npm run soak                               # M1 (34 tasks) + M3 mixed-load soak
```

Data lives in `~/.samsara` (or `$SAMSARA_HOME`): hash-chain log, SQLite projections, CAS blobs,
credentials (0600). Projections are disposable — replay rebuilds them. Model credentials are
resolved from environment variables only and never touch the ledger, traces, or logs.

## Project Layout

```
src/kernel/     L0: effects, ledger, snapshots, projections, lanes, workspace capture
src/agent/      L1: ReAct task loop, spawner + algebra, tools (calc/fs/skill/clock/search/spawn)
src/l2/         skills (COW branches, lint, promotion) · three-layer memory
src/channel/    WeChat iLink adapter · WebChat HTTP · peer trust derivation
src/scheduler/  natural-language → cron, misfire semantics, trust re-check on fire
src/llm/        chat / embedding / rerank adapters (model-as-plugin) · model registry
src/worker/     subprocess isolation for external plugins (protocol whitelist, effect mediation)
src/cli/        the samsara CLI
tests/          156 tests incl. PBT, fuzz, penetration, SLO, real-key smoke (isolated)
.context/design/  design docs (Chinese) + governance tools (freeze checker, ledger asserter)
```

## Development Workflow

All work flows through **issue → branch → PR (squash merge)**; `main` takes no direct commits.
Issues and PRs are written in **English**. A PR is mergeable only when the full suite is green
*and* both governance gates pass:

```bash
npm test
cd .context/design && python3 tools/freeze_check.py && python3 tools/ledger_assert.py
```

## License

Personal project — see commit history for provenance. Design docs are R3-level assets;
changes go through the RFC process described in the interface doc.
