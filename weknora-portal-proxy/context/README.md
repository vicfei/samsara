# WeKnora-portal-proxy 上下文目录

本目录存储 AI 辅助开发所需的设计文档、数据库模型、决策记录与进度（借鉴 WeKnora 仓库的 `.context` 惯例）。

- `design/`: 架构与功能设计、数据模型、接口契约
- `schema/`: 数据库 DDL（portal_proxy 独立库）
- `sessions/`: 决策记录（decisions.md）、进度追踪（progress.md）

> 本目录被 `.gitignore` 忽略——本地元数据不入库（同 WeKnora 惯例）。若团队需要共享设计文档，另建 `docs/` 提交，勿直接取消忽略。

## 项目一句话定位

B1 路线：独立门户代理服务。模仿完整 SSO 登录 + 后端管理的门户系统，持有「用户↔知识库」权限表，
经 tenant-key API 通道（signed_token 虚拟 principal）调用 WeKnora，逐请求按用户过滤。
**WeKnora fork 零代码改动**是本路线的存在前提。


## 对外内容铁律（用户 2026-09-23 明令，不限本项目，一切项目一切会话永久生效）

1. 任何 issue / PR / 评论等公开文本禁止出现 "Generated with ZCode"、"Generated with ..."、🤖
   及任何 AI 工具署名/水印/落款；署名决定权在用户，默认永远不加。
2. 对外留言去除 AI 味，用真人工程师行文：不滥用加粗、不用 emoji 与装饰符号、短内容不套
   模板、不写客套铺垫、证据给原始输出。发布前自查：ZCode / Generated with / 🤖。
（同步已写入 ~/.claude/CLAUDE.md 与 ~/.codex/AGENTS.md 全局指令文件）

