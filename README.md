# Samsara

自托管、可安全自我改进的个人智能体运行时。当前阶段:**M2 进行中**(调度器/工具/微信渠道/三层记忆已落地)。

## 仓库布局

```
src/kernel/          L0 内核:Context / 三分类效应 / 反应式余效应 / 哈希链账本 / 崩溃恢复 / SQLite 投影
src/agent/           ReAct 任务回路(§5.1 五步)+ 工具注册表(calc/fs/skill/clock/web_search)
src/channel/         WebChat 回环 HTTP + 微信 iLink 渠道(QR 绑定/长轮询)
src/scheduler/       自然语言→cron 调度器(附录 C:misfire 三态/重放恢复)
src/l2/              最小 L2:技能三件套 + 三层记忆(§6.5:闸门写入/情景提炼/召回注入)
src/llm/             模型适配器:chat(OpenAI 兼容)+ 检索(embedding/rerank,DashScope)
tests/               汇流性 PBT、崩溃恢复模糊、三分类契约、链篡改检测、投影一致性、记忆层
.context/design/     设计文档 v0.21(六轮评审收敛)+ 治理工具(冻结门槛②④)
.context/design_dep0*/  评审历史档(只读)
```

## 快速开始

```bash
npm install
npm test                        # 94 例:M0/M1/M2 出口标准全绿
npm run cli -- run "写一句周报"  # 单轮任务(设 OPENAI_API_KEY 用真实模型,否则 mock)
npm run cli -- webchat           # 常驻守护:WebChat(127.0.0.1:18790)+ 调度器 + 微信渠道 + 记忆蒸馏
npm run cli -- job add "每周五 9 点写周报"   # 自然语言创建定时任务
npm run cli -- wechat bind       # 微信扫码绑定(个人号 Bot 通道)
npm run cli -- memory ls         # 三层记忆管理(ls/forget/rollback)
npm run demo                    # 七段内核能力演示(三分类/重绑/前滚/快照…)
npm run cli -- doctor           # 账本哈希链 + CAS + 投影 + Parquet 对账
npm run soak                    # 真实负载压测(34 任务)
```

数据目录:`SAMSARA_HOME`(默认 `~/.samsara`),含 `ledger/head.log`(追加日志)、`ledger/index.sqlite`(投影读模型,WAL)与 `assets/blobs/`(CAS)。投影可随时删除——重启后从账本全量重建(数据模型 §7 可重建性)。凭据经 `~/.samsara/credentials/`(0600),永不入账本/轨迹。

## 开发工作流(2026-10-06 起,issue #1)

一切开发工作走 **issue → 分支 → PR**,main 不再直接提交:

1. 工作项先立 issue(目标 + 验收标准);开发分支命名 `<type>/<issue号>-<slug>`(feat/fix/docs/chore);
2. 实现遵循既有纪律:**测试全绿 + 治理工具双绿**(见下节)才可提 PR;
3. PR 描述关联 issue(`Closes #N`),正文含变更摘要、测试与治理结果、文档回写(账本批次号);
4. 合并采用 **squash**(保持 main 线性历史)。

## 治理

设计文档为 R3 级资产:四文档 + spec-constants 注册表 + closure-ledger 收敛账本,由
`.context/design/tools/` 下两个检查器守护(冻结门槛②④),任何文档漂移会在下次运行时变红:

```bash
cd .context/design
python3 tools/freeze_check.py && python3 tools/ledger_assert.py
```
