# Samsara —— 窗口接入（项目层）

> 全局协同协议见 https://github.com/vicfei/protocol 的 `COORDINATION.md`（协同拓扑）与 `DISCIPLINES.md`（全局行为纪律）——均为唯一真相源。
> 本文件只做**本项目映射**，不复制全局准则。

- 节点名：`singapore`
- 会话登记：`~/sessionlog/sessions/YYYY-MM/YYYY-MM-DD-singapore.md`
- 任务条目：`~/worklog/log/YYYY-MM/YYYY-MM-DD-singapore.md`
- `.context` 快照去向：`brainvault/samsara/context/`（批次收尾跑 `~/brainvault/sync.sh`）
- 本项目边界令：代码变更须 `npm test` 全绿 + 治理双门槛（`tools/freeze_check.py`、`tools/ledger_assert.py`）绿灯才 commit；守护进程停/启分两条命令执行（防 pkill 自匹配）；凭据只进 `~/.samsara/credentials/`（0600），永不入仓。

## 项目纪律（项目层，只放本项目专属；全局纪律见 protocol/DISCIPLINES.md）

- 交接卡生成本项目窗口时：工作总结 + 逐字复制 `protocol/TEMPLATES/handoff.md` 启动块（2026-11-21 起）。
- 相对时间与日期表述遵守全局钟源纪律（DISCIPLINES.md §1）。
