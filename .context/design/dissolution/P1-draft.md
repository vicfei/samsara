# 附录 K.1 消融草案:P1(副作用三分类与补偿协议)正文改写

> 状态:草案(账本 P1 条目挂载物)。v1.0 冻结消融时机械合并进正文对应章节,合并后本文件转世为变更记录。
> 依据:M0 内核实现(`src/kernel/kernel.ts`)+ 测试(`tests/effects.test.ts` 等 22 例全绿,2026-10-05)。
> 本草案同时吸收了实现期发现的两个新语义(见文末"实现期发现"),消融时须一并写入。

---

## 1. §2.3 INV-2 措辞改写(替换原句)

原:
> INV-2(可逆性):任意时刻可将系统回滚至任意历史快照,包括"回滚一次回滚"。

改为:
> **INV-2(可逆性,系统内限定)**:任意时刻可将**系统内状态**(账本投影、CAS 资产、分支引用)回滚至任意历史快照,包括"回滚一次回滚"。外部副作用不在此承诺范围内,按 §3.2.2 的三分类治理:可逆者精确复原、可补偿者执行补偿动作、不可逆者必须前置审批且不伪造撤销。

## 2. §3.2.2 改写(替换整节,标题改为「效应(三分类)」)

- 效应分三类,分类挂点复用 ToolPlugin `sideEffect` 字段(K.1 表):**可逆**(none/read,revert 后环境状态 ≡ apply 之前)、**可补偿**(write,逆操作=补偿动作,不保证状态全等)、**不可逆**(destructive,无 revert 语义,必须前置审批)。
- `ctx.effect(desc, apply, revert, {rClass, owner})` 契约:
  - **先验后动**:可逆/可补偿的 revert 存在性、不可逆的审批有效性,均在 `apply` 执行**之前**校验——失败不留半截副作用;
  - `revert` 接收 `apply` 的返回值(如注册句柄、前置状态快照),不接收环境全局;
  - 同步 `apply` 同步入账返回 token;异步 `apply` 在解析时入账;
  - `owner` 默认归属当前插件;agent/session/job 场景显式指定(GAP1),效应栈按 owner 组织,kill(owner) 即按 LIFO 回滚其全部效应。
- 不可逆效应走 `ctx.irreversible(desc, preapprovalSeq, apply)`:`preapprovalSeq` 必须是账本中真实存在的 `effect.preapproval` 条目,否则同步拒绝(`PREAPPROVAL_REQUIRED`)。
- 回滚语义:`revertOwner`/`rollbackTo` 对三类分别落账 `effect.revert` / `effect.compensate` / (不可逆)不落账、仅如实上报 `irreversibleSkipped`——**既成事实不被伪造撤销,这是账本诚实的一部分**。
- 账本新 kind:`effect.compensate`、`effect.preapproval`(已入数据模型 §3.1 枚举)。

## 3. §3.4 契约测试改写(按类分层,替换原「契约测试」条目)

- **class 0(可逆)**:对每条效应断言 apply→revert 后环境哈希不变(原契约,仅限定本类);
- **class 1(可补偿)**:断言补偿动作存在且在回滚时被执行,账本出现 `effect.compensate`;不断言环境复原;
- **class 2(不可逆)**:断言审批前置——无有效 `effect.preapproval` 时 apply 根本不执行;回滚时进入 `irreversibleSkipped` 上报;
- 汇流性 PBT 与崩溃恢复模糊测试维持不变(已实现:`tests/confluence.pbt.test.ts` 150 轮、`tests/recovery.fuzz.test.ts` 40 种子)。

## 4. 附录 B.2 补写(「立即」介入行后追加)

> **安全点定义(K.1)**:最近安全点 = 所有在途效应均为可逆类、或补偿已完成的最近账本位置。内核据此实现 `rollbackTo(seq)`——记 `rollback.marker` 后按 LIFO 逆应用其后全部 applied 效应;"立即"介入即回滚至最近安全点后注入消息,不存在中间态暴露(INV-7)。

## 5. 附录 F.2 补写(节点类型列表后追加一条)

> 不可逆工具节点(`sideEffect: destructive`)必须位于 `human-gate` 节点之后——编译器拒绝将未过人审的不可逆操作编入 DAG。

---

## 实现期发现(消融时须同步写入对应章节)

1. **激活意愿必须入账(数据模型 §3.1 补充语义,additive)**:`plugin.activate` 条目以 `ref.reason="waiting"` 记录"依赖未就绪的激活请求"(§3.3 resolved 态);`plugin.suspend` 的 `ref.reason` 取值 `operator`(操作者意愿释放)/ `dependency`(级联连带,意愿保留)/ `failed`(启动失败自动释放)。否则崩溃重放会丢失等待中的激活请求——恢复后的系统将与崩溃前产生可观测分歧。
2. **requires ≠ 代为激活(§3.2.3 措辞澄清)**:声明依赖表示"我运行时需要它",不表示"替我启动它"。反应式自动激活只作用于**已被请求**且依赖已满足的插件;依赖方的启动是操作者(或上层编排)的决定,内核不越权代劳。
