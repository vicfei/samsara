# Samsara

自托管、可安全自我改进的个人智能体运行时。当前阶段:**M0 可组合内核(L0)骨架**。

## 仓库布局

```
src/kernel/          L0 内核:Context / 三分类效应 / 反应式余效应 / 哈希链账本 / 崩溃恢复 / SQLite 投影
src/cli/             samsara CLI 壳(daemon start/status/stop、doctor)
tests/               汇流性 PBT(INV-1)、崩溃恢复模糊、三分类契约、链篡改检测、余效应生命周期、投影一致性
.context/design/     设计文档 v0.14(六轮评审收敛)+ 治理工具(冻结门槛②④)
.context/design_dep0*/  评审历史档(只读)
```

## 快速开始

```bash
npm install
npm test                        # 52 例:M0 出口标准 + M1 任务回路在内
npm run cli -- run "写一句周报"  # 单轮任务(设 OPENAI_API_KEY 用真实模型,否则 mock)
npm run demo                    # 七段内核能力演示(三分类/重绑/前滚/快照…)
npm run cli -- daemon start     # 进程内自检启动(常驻服务随 M2)
npm run cli -- doctor           # 账本哈希链 + CAS + 投影对账
```

数据目录:`SAMSARA_HOME`(默认 `~/.samsara`),含 `ledger/head.log`(追加日志)、`ledger/index.sqlite`(投影读模型,WAL)与 `assets/blobs/`(CAS)。投影可随时删除——重启后从账本全量重建(数据模型 §7 可重建性)。

## 治理

设计文档为 R3 级资产:四文档 + spec-constants 注册表 + closure-ledger 收敛账本,由
`.context/design/tools/` 下两个检查器守护(冻结门槛②④),任何文档漂移会在下次运行时变红:

```bash
cd .context/design
python3 tools/freeze_check.py && python3 tools/ledger_assert.py
```
