# 交接 Prompt：上海节点集成 bocha + doubao 网络搜索 provider（2026-09-15，新加坡第 5 棒交付）

## 你是谁、在哪
你是上海节点（VM-16-17-ubuntu，118.25.124.129）的 ZCode agent，主 worktree `/home/ubuntu/WeKnora`（分支 feature/agent-lab，U-13/U-15 工作中），dev 栈 compose 项目 weknora（docker-compose.dev.yml，fork-v3 自建镜像）。新加坡节点已通过 SSH 把两个网络搜索 provider 的完整 git 资产预置进你的仓库。

## 背景
- **bocha**：已合并上游（Tencent/WeKnora PR #3036，squash 合并体=单提交 `15727591`，含全部改动 11 文件 +521/-6）
- **doubao**：新加坡在审 PR #3251（CI 全绿、两轮人工实测过），分支 feat/doubao-web-search 三提交
- 详细背景、接线点表、坑清单：**先读 `.context/handoff-shanghai-bocha-doubao-20260915.md`**（新加坡写的完整交接文档，含本机专属附注）

## 第 0 步：交付核验（动手前必做）
```bash
cd ~/WeKnora
git log --oneline -1 origin/bocha-3036-for-shanghai        # 应为 15727591 bocha squash 提交
git log --oneline -3 origin/feat/doubao-web-search         # 应为 6ed112a5/bf40aed2/b3c3ac7f
git diff --stat 15727591^1 15727591 | tail -2              # 应显示 11 files, +521
git show origin/feat/doubao-web-search:internal/infrastructure/web_search/doubao.go | head -1  # 应输出 package web_search
```
任何一项失败 → 停止，通过用户转告新加坡节点补资产（勿自行 fetch GitHub）。

## 重要环境事实（勿踩）
1. **本仓库是 shallow clone**（.git/shallow 存在）：窗口内对象完整、cherry-pick 无碍；但**不要**尝试 `git fetch` GitHub——上海→GitHub 443 当前被限（TLS 中断/连不上），交付就是为此走的 bundle 通道。
2. **不要用 ghcr.io/vicfei/*doubao-test 镜像覆盖本机栈**：那是 upstream 基线，会回退 fork-v3 的 agent-lab 等 fork 资产。本机必须走源码集成。
3. `15727591` 是 squash 单父提交——**不要**去找 bocha 的四个 PR 原始提交（不在 main 历史，已证不存在于本地对象库）。

## 任务：把两个 provider 集成进 fork 并部署验证

### 1. 集成
- 从 feature/agent-lab 当前 HEAD 切集成分支（建议名 `feature/web-search-providers`），不动 agent-lab 在途工作
- cherry-pick 顺序（勿倒）：`15727591` → `b3c3ac7f` → `bf40aed2` → `6ed112a5`
- 冲突时按交接文档第三节 6 接线点表逐个核对（types 常量+ConfigFields / isValidProviderType / validateProviderParameters / container.go Register / 前端 union type / swagger）。漏装症状都在表里。
- **`6ed112a5`（前端 text 字段渲染修复）不可跳过**：没有它，doubao 的 time_range 在 UI 上只有标签没有输入框（新加坡已实测踩过）。

### 2. 测试（全绿才继续）
```bash
go test ./internal/infrastructure/web_search/... ./internal/application/service/... -run 'WebSearch|Bocha|Doubao' -v
cd frontend && npm ci && npm run type-check && npm test   # type-check 必须零错
```

### 3. 重建镜像（沿用本机 fork-v3 → fork-v4 流水线）
- 后端：golang:1.26-bookworm 容器内（本机已有该镜像）apt build-essential libsqlite3-dev curl → `go run cmd/download/duckdb/duckdb.go` → CGO_ENABLED=1 go build → 换装进基础镜像
- 前端：`NODE_OPTIONS=--max-old-space-size=4096`（**2048 会 V8 OOM 崩**）；`frontend/.dockerignore` 排除 dist，docker build 上下文要用干净目录；勿与 Go 编译并行（内存互杀）

### 4. 部署 + 验证
- dev 栈按本机既有方式滚动到 fork-v4 镜像（compose 项目 weknora，卷不动、无新增 DB 迁移）
- API 验证：登录后 `GET /api/v1/web_search/types` 应含 `bocha` 和 `doubao` 条目，doubao 的 config_fields 含 time_range(type=text) 与 need_content(type=select)
- UI 验证：设置→网络搜索→添加引擎→下拉应有 Bocha AI Search 与 Volcano Doubao Search；选 doubao 后 **Time range 必须出现文本输入框**（输入格式 `YYYY-MM-DD..YYYY-MM-DD`）
- 有真实 key 则连测：bocha（open.bochaai.com）/ doubao（火山 feedcoopapi web_search）；key 按保密件处理，不打印不落盘，测完清理测试数据

## 纪律（与全节点一致）
- 证据先核验再动手；过程追加到本机会话日志/登记簿（注明来源=本交接）
- 密钥不打印不落盘；批量 rm 前 ls 验证目标名；测试租户/数据用后清理
- 完成后写一条完成记录（集成提交号、测试结果、部署状态），供用户带回新加坡侧对账

## 边界
- doubao 上游未合并（#3251 在审）：本集成属 fork 预采纳；上游合并后可对齐官方实现（预期无差异，分支即 PR 头）
- 遇对象缺失/异常：停止并报告，勿强推勿 reset 共享引用
