// M0 内核能完成什么?——一个诚实的演示。
// "迷你任务" = 若干可逆效应的编排。演示六件事:
//   1. 任务执行:写两个文件 + 发一条通知(效应按 owner=agent 归属)
//   2. kill 任务:LIFO 回滚,文件消失、通知发更正(补偿 ≠ 假装没发过),账本全程留痕
//   3. rollbackTo:活内核回滚到任意历史位置,marker 入账
//   4. 崩溃:丢弃全部内存态,仅凭账本文件重放恢复,链校验通过
//   5. 恢回态直接回滚:未重绑效应无运行时句柄——内核诚实拒绝,不伪造 revert 条目
//   6. 效应重绑定:module.rebind 按 rebindArgs(随效应入账)重建服务与逆操作——回滚真正生效
// 注意:这里没有任何 LLM——M0 的"任务"是可逆操作编排;智能体回路(LLM 决策)是 M1 交付。

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerStore } from "../src/kernel/ledger.js";
import { Kernel } from "../src/kernel/kernel.js";
import { serviceKey } from "../src/kernel/types.js";
import type { KernelContext } from "../src/kernel/types.js";

const dir = mkdtempSync(join(tmpdir(), "samsara-demo-"));
const WORK_DIR = join(dir, "task-output");
const NOTIFY_LOG = join(dir, "notifications.log");
const OWNER = { kind: "agent" as const, id: "ag_task_001" };
const ACTOR = { kind: "human" as const, id: "owner", trust: "owner" as const };
const say = (t: string) => console.log(t);
const file = (n: string) => existsSync(join(WORK_DIR, n));

interface FsTools {
  writeFile(name: string, content: string): unknown;
  notify(message: string): unknown;
}
let tools: FsTools | undefined; // 服务对象经闭包持有插件 ctx(生产中由 Agent Loop 调用)

const store = new LedgerStore(dir);
const kernel = new Kernel(store);

function buildTools(ctx: KernelContext): FsTools {
  return {
    writeFile(name, content) {
      const path = join(WORK_DIR, name);
      return ctx.effect( // class 0 可逆:apply 建文件,revert 删文件
        `write ${name}`,
        () => { mkdirSync(WORK_DIR, { recursive: true }); writeFileSync(path, content); return path; },
        (p) => { rmSync(p as string); },
        { owner: OWNER, rebindArgs: { name } }, // 重绑定参数随效应入账(additive)
      );
    },
    notify(message) {
      return ctx.effect( // class 1 可补偿:已发出的消息不可撤回,补偿 = 追发更正
        `notify: ${message}`,
        () => { appendFileSync(NOTIFY_LOG, `[sent] ${message}\n`); return message; },
        (m) => { appendFileSync(NOTIFY_LOG, `[corrected] 撤回:${m}\n`); },
        { rClass: 1, owner: OWNER, rebindArgs: { message } },
      );
    },
  };
}

kernel.install(
  { name: "fs-tools", version: "1.0.0", provides: ["fs.report"], requires: [], rLevel: "R0" },
  {
    start(ctx: KernelContext) {
      const impl = buildTools(ctx);
      ctx.provide(serviceKey<FsTools>("fs.report"), impl);
      tools = impl;
    },
    rebind(rc) { // 崩溃恢复:重建服务 + 按 rebindArgs 重挂逆操作(纯运行时,不写账本)
      rc.provide(serviceKey<FsTools>("fs.report"), {
        writeFile: () => { throw new Error("恢复态任务应重新发起,而非复用旧实例"); },
        notify: () => { throw new Error("恢复态任务应重新发起,而非复用旧实例"); },
      });
      for (const e of rc.pendingEffects) {
        if (e.desc.startsWith("write ")) {
          const name = (e.rebindArgs as { name: string }).name;
          rc.reattach(e.token, () => { rmSync(join(WORK_DIR, name)); });
        } else if (e.desc.startsWith("notify:")) {
          const msg = (e.rebindArgs as { message: string }).message;
          rc.reattach(e.token, () => { appendFileSync(NOTIFY_LOG, `[corrected] 撤回:${msg}\n`); });
        }
      }
    },
  },
);

say("══ 1. 任务执行:两个可逆写入 + 一条可补偿通知 ══");
await kernel.activate("fs-tools@1.0.0");
const beforeTask = store.lastSeq;
await tools!.writeFile("draft.md", "# 周报草稿\n本周完成 M0 内核骨架,22 例测试全绿。\n");
await tools!.writeFile("stats.txt", "tests: 22 passed\n");
await tools!.notify("周报草稿已生成");
say(`磁盘: draft.md=${file("draft.md")}, stats.txt=${file("stats.txt")}`);
say(`通知流: ${JSON.stringify(readFileSync(NOTIFY_LOG, "utf-8").split("\n").filter(Boolean))}`);
say(`账本 seq: ${beforeTask} → ${store.lastSeq},链校验=${store.verifyChain().ok}`);

say("\n══ 2. kill 任务(revertOwner ag_task_001,LIFO)══");
const s1 = await kernel.revertOwner(OWNER, ACTOR);
say(`reverted=${s1.reverted.length}(两个文件), compensated=${s1.compensated.length}(通知)`);
say(`磁盘: draft.md=${file("draft.md")}, stats.txt=${file("stats.txt")}`);
say(`通知流(留下完整痕迹): ${JSON.stringify(readFileSync(NOTIFY_LOG, "utf-8").split("\n").filter(Boolean))}`);

say("\n══ 3. 重跑任务 → 活内核 rollbackTo 回滚到任务前 ══");
await tools!.writeFile("draft.md", "# 周报草稿(重跑)\n");
say(`重跑后磁盘: draft.md=${file("draft.md")}`);
const s2 = await kernel.rollbackTo(beforeTask, ACTOR);
say(`reverted=${s2.reverted.length}, rollback.marker 已入账,链校验=${store.verifyChain().ok}`);
say(`回滚后磁盘: draft.md=${file("draft.md")}(环境与账本一致)`);

say("\n══ 4. 再跑一次 → 中途'崩溃'(丢弃全部内存态,仅账本文件幸存)══");
await tools!.writeFile("draft.md", "# 周报草稿(第三次)\n");
const recovered = Kernel.recover(store);
say(`恢复: seq=${recovered.kernel.store.lastSeq}, 待重绑插件=${recovered.needsRebind.length}, 链校验=${recovered.kernel.store.verifyChain().ok}`);
say(`恢复投影: 效应时间线=${JSON.stringify(recovered.kernel.effectTimeline())}`);

say("\n══ 5. 恢复态内核上直接回滚 → 诚实拒绝(账本诚实优先)══");
const s3 = await recovered.kernel.rollbackTo(beforeTask, ACTOR);
say(`reverted=${s3.reverted.length}, unrebound=${s3.unrebound.length}(无运行时句柄,拒绝伪造撤销)`);
say(`磁盘: draft.md=${file("draft.md")}(仍在——内核如实报告无法回滚,而非谎称已回滚)`);
say(`账本未新增伪造 revert 条目,链校验=${store.verifyChain().ok}`);

say("\n══ 6. 效应重绑定:module.rebind 重建服务与逆操作 → 回滚真正生效 ══");
const seqBeforeRebind = store.lastSeq;
const rb = await recovered.kernel.rebind("fs-tools@1.0.0", {
  start() {}, // 恢复态不重放 start(apply 已是既成事实)
  rebind(rc) {
    for (const e of rc.pendingEffects) {
      if (e.desc.startsWith("write ")) {
        const name = (e.rebindArgs as { name: string }).name;
        rc.reattach(e.token, () => { rmSync(join(WORK_DIR, name)); });
      } else if (e.desc.startsWith("notify:")) {
        const msg = (e.rebindArgs as { message: string }).message;
        rc.reattach(e.token, () => { appendFileSync(NOTIFY_LOG, `[corrected] 撤回:${msg}\n`); });
      }
    }
  },
});
say(`重绑: reattached=${rb.reattached.length}, pendingRemaining=${rb.pendingRemaining.length};` +
    ` 账本 seq 不变(${seqBeforeRebind} → ${store.lastSeq},纯运行时操作)`);
const s4 = await recovered.kernel.rollbackTo(beforeTask, ACTOR);
say(`回滚: reverted=${s4.reverted.length}, unrebound=${s4.unrebound.length},链校验=${store.verifyChain().ok}`);
say(`磁盘: draft.md=${file("draft.md")}——环境与账本重新一致,"诚实拒绝"场景闭环`);
say(`通知流: ${JSON.stringify(readFileSync(NOTIFY_LOG, "utf-8").split("\n").filter(Boolean))}`);

rmSync(dir, { recursive: true, force: true });
say("\n结论:M0 内核能完成的'任务' = 可逆操作编排 + kill 回滚 + 补偿 + 崩溃恢复 + 效应重绑定;");
say("带 LLM 决策的智能体任务(对话/调研/写代码)需要 M1 任务回路——它将调用与今天完全相同的 effect 通道。");
