# 交接：bocha + doubao 网络搜索能力 → 上海节点（2026-09-15，新加坡第 5 棒）

> 目的：让上海节点的 WeKnora 实例（fork 部署）也具备 bocha + doubao 两个网络搜索 provider。
> 本文自包含：两条路径（镜像级 5 分钟 / 源码集成），配方含全部已知坑。

## 一、现状（先读这段再动手）

| 功能 | 状态 | 代码位置 |
|---|---|---|
| bocha 搜索 | **已合并上游**（PR #3036，2026-09-07） | upstream/main（含 #3036 之后任一版本） |
| doubao 搜索 | **在审**（issue #3250 + PR #3251，CI 6/6 绿，两轮人工实测过） | fork `vicfei/WeKnora` 分支 `feat/doubao-web-search` |

doubao 分支三个提交（按序）：
- `b3c3ac7f` feat(web-search): add Volcano Doubao Search provider（适配器 doubao.go 253 行 + 全部接线 + 6 单测）
- `bf40aed2` docs(web-search): swagger 三文件枚举 + 服务层校验测试
- `6ed112a5` fix(ui): render text-type provider config fields as inputs（前端 config_fields 框架补 text 分支——**不带上这个，time_range 在 UI 上没有输入框**）

## 二、路径 A：镜像级部署（推荐，约 5 分钟，两个 provider 一次到位）

镜像已推 ghcr（**默认 private 包**，需与 vicfei 同账号/协作的 GitHub token 拉取）：

- `ghcr.io/vicfei/weknora-app:doubao-test` —— 后端（基线 upstream/main@2026-09-14 + 上述三提交，含 bocha+doubao）
- `ghcr.io/vicfei/weknora-ui:doubao-test` —— 前端（同提交的 vite 构建）

上海侧步骤：
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u vicfei --password-stdin
docker pull ghcr.io/vicfei/weknora-app:doubao-test
docker pull ghcr.io/vicfei/weknora-ui:doubao-test
```
然后在自己的 compose 加 override（示例，与新加坡测试栈同构）：
```yaml
services:
  frontend:
    image: ghcr.io/vicfei/weknora-ui:doubao-test
  app:
    image: ghcr.io/vicfei/weknora-app:doubao-test
```
起栈后：设置 → 网络搜索 → 添加搜索引擎 → 列表应有 Bocha AI Search 和 Volcano Doubao Search，各自填 key（bocha: open.bochaai.com 申请；doubao: 火山方舟方舟 feedcoopapi web_search 的 key）。

镜像内**无任何密钥**（key 只在各自实例 DB 加密存储）；DB 结构无新增迁移（web_search_providers 表上游已有），可直接覆盖现有栈的 app/ui 容器。

## 三、路径 B：源码集成（上海 fork 要把 provider 合进自己代码线时用）

1. `git fetch https://github.com/vicfei/WeKnora.git feat/doubao-web-search`，cherry-pick 上面三提交（顺序勿倒）。
2. 若与 fork 改动冲突，6 个接线点手工核对（漏任何一个的表现）：
   | 接线点 | 漏掉的表现 |
   |---|---|
   | `internal/types/web_search_provider.go` 常量 + ConfigFields 元信息 | /types 不下发表单字段 |
   | service 层 `isValidProviderType` 白名单 | POST 创建报 invalid provider type |
   | service 层 `validateProviderParameters` switch | 参数不校验 |
   | `container.go` registry.Register | 运行时找不到 provider |
   | 前端 union type | TS 编译错 |
   | swagger 三文件枚举 | API 文档不一致（CI 不拦，仅文档） |
3. bocha 直接从 upstream/main merge/rebase 即得（#3036 已在主线）。
4. 测试资产随提交携带：`internal/infrastructure/web_search/{doubao,bocha}_test.go`（httptest 全 mock，无网络依赖，`go test ./internal/infrastructure/web_search/` 可直接跑）。

## 四、自行重建镜像配方（若不用 ghcr 镜像）

后端（约 8 分钟）：
```bash
docker run --rm -v $WORKTREE:/src -v /tmp/out:/out -w /src golang:1.26-bookworm bash -c '
  apt-get update -qq && apt-get install -y -qq build-essential libsqlite3-dev curl >/dev/null &&
  go run cmd/download/duckdb/duckdb.go &&
  CGO_ENABLED=1 go build -o /out/WeKnora ./cmd/server'
# Dockerfile: FROM wechatopenai/weknora-app:latest  COPY WeKnora /app/WeKnora
```
前端（注意三坑）：
1. `NODE_OPTIONS=--max-old-space-size=4096`（上游 compose 同参数；**2048 会 V8 OOM 崩**，小内存机加 swap）
2. `frontend/.dockerignore` 排除 dist —— docker build 上下文用干净目录（cp dist 过去再 build）
3. 不要与 Go 编译并行（内存互杀）

## 五、边界与后续

- #3251 未合并期间，上海用镜像/分支属于预发布状态；合并后上海 rebase upstream/main 即可换回官方镜像（届时 doubao 进主线，bocha 已在）。
- 验证水位参考（新加坡已达）：单测 + swagger + 服务层测试 + API E2E 7/7（含凭据不回显、时间窗真搜）+ 两轮 UI 人工实测。E2E 脚本与记录见 PR #3251 评论链。
- doubao time_range 格式：`YYYY-MM-DD..YYYY-MM-DD`（留空=不过滤）；need_content 默认开（返回 markdown 正文进 Content 字段）。
- 汇报口径：上海侧完成后请在本登记体系（.context/）追加记录，注明来源交接文档本文件。
