# opencode-weknora 插件开发深潜（feat，PR #3062 在途；npm `opencode-weknora@0.1.0` 已发布）

> 作者：新加坡节点 2026-09-06~07 开发。worktree：/home/ubuntu/weknora-opencode（分支
> opencode-weknora-plugin，基线 upstream/main@3d3bb7f6）。源码 packages/opencode-weknora，
> 五文件 1104 行 TypeScript，**零运行时依赖**。
> 配套：issue #3061（提案）、PR #3062（入库）、npm 包（发布名 opencode-weknora@0.1.0，
> 上游协调名 @wxg-prc-cpg/opencode-weknora 待官方确认）。

## 1. 这个功能是什么

给 opencode（编码智能体 TUI/CLI）装上 WeKnora 检索能力：四个工具让编码智能体在写代码时直接
查询组织的私有知识库——检索片段、按名找文档、整篇阅读、以及带 RAG 的问答。效果：编码助手
的答案可以落在**本组织的文档**上，而不是只有模型参数里的世界知识。

## 2. 双端架构与依赖地图

### 2.1 opencode 侧（插件宿主）

```
opencode 插件加载器（每个入口函数导出都被当作插件调用！→ index.ts 只导出 WeknoraPlugin）
  ↓ Plugin 接口（@opencode-ai/plugin）
WeknoraPlugin(input, options)
  ├─ resolveConfig：options > WEKNORA_* 环境变量 > 默认值，加载期全量校验
  │  （typo 在加载时报全部违规，而非首次调用时 mysterious 失败）
  └─ createTools：注册 4 工具（tool() + tool.schema 声明参数）
```

关键约束（加载器兼容，提交 a07fb5e 修复的要点）：入口模块**任何**函数导出都会被当插件执行，
所以 client/config/tools/render 全部放在兄弟模块、入口只导出一个 Plugin——这是把「库」和
「插件」分开的边界。

### 2.2 WeKnora 侧（被依赖的 API 面）

```
client.ts（433 行，全部能力的唯一出口）
  ├─ 鉴权：X-API-Key（走 WeKnora API key 能力体系）
  ├─ GET  /knowledge-bases               列知识库（名称/描述 → 供模型选择）
  ├─ POST /knowledge-search              混合检索（向量+关键词，无模型摘要，原文片段）
  ├─ GET  /knowledge/search?keyword=     按标题/文件名跨库找文档
  ├─ GET  /knowledge/:id                 文档元数据（含 WeKnora 存的生成摘要）
  ├─ GET  /chunks/:knowledge_id          分页拉取文档全部分块（整篇阅读）
  ├─ POST /sessions + /knowledge-chat    ask 工具：建会话 + SSE 流式 RAG 问答
  └─ resource_urls=public 模式：片段内存储引用改写为直链 URL；
     KB 受限 key 拒绝该模式时自动回退默认模式（client.ts:114-150 防御）
```

对应 WeKnora 内部链路：/knowledge-search → 检索服务（混合检索+可选 rerank 精排）；
/knowledge-chat → session QA 管线（chat_pipeline：检索→rerank→生成）；API key 经
apiKeyRetrieve/apiKeyChat 能力门与 KB 范围约束。**插件不依赖任何 WeKnora 私有协议，
全部走公共 REST/SSE**——这是它能被官方接纳为 packages/ 成员的前提。

## 3. 工具设计（tools.ts，394 行）

| 工具 | 用途 | 设计要点 |
|---|---|---|
| `weknora_list_knowledge_bases` | 列出可用库 | 让模型先看有什么，再决定查什么 |
| `weknora_search` | 混合检索片段 | **描述里的优先级设计**：落地组织文档一律用它；「像标题的查询」还会顺带返回所指文档；命中带 knowledge_id 供 read 链接 |
| `weknora_read_document` | 分页读整篇 | 与 search 构成多跳链（list→search→read） |
| `weknora_ask` | RAG 问答 | 描述明确「仅当不确定该查什么/入门性问题时用」——把检索优先、问答兜底的策略写进工具描述，让模型自主路由 |

这是本插件最核心的产品判断：**不做一个大而全的 ask，而是用工具描述塑造模型的行为策略**
（检索优先于问答、可溯源片段优先于模型转述）。用户 TUI 实测验证了该设计生效（§5）。

## 4. 与官方同类实现的对比

官方 packages/ 先例是 **dsh-weknora**（DeepSeek Harness 插件，PR #2759 入库）：本实现有意识
地沿用了它的入库规范，同时按 opencode 的宿主特性重写内核。

| 维度 | dsh-weknora（先例） | opencode-weknora（本实现） |
|---|---|---|
| 宿主 | DeepSeek Harness | opencode（@opencode-ai/plugin，tool+schema API） |
| 入库规范 | packages/ 目录 + 双侧契约测试 + 四语 README + tag 触发发布 | **完全沿用**（fixture 加 "opencode:" 前缀区分 Go 契约用例） |
| 发布 | @wxg-prc-cpg scope | 同 scope 协调；个人 npm 先行发布 opencode-weknora@0.1.0 验证安装链路 |
| 工具策略 | 问答为主 | 检索优先 + 多跳阅读 + 问答兜底（描述驱动路由） |
| 契约防御 | — | resource_urls=public 与 KB 受限 key 的组合防御 + 自动回退 |
| 加载器约束 | 无此问题 | 入口单函数导出约束（a07fb5e） |
| 依赖 | — | 0 运行时依赖（fetch 原生） |

另一条本可走的路：WeKnora 自身支持 MCP（内置 MCP 服务体系），opencode 也支持 MCP 客户端
——理论上「把 WeKnora 包成 MCP server」可达类似效果。插件路线的优势：工具描述、分页渲染、
配置校验都是宿主原生体验，且无需用户另起服务进程；MCP 路线的优势是跨宿主通用。两者互补
不互斥，插件先落地是因为 opencode 是我们编码智能体的实际宿主。

## 5. 测试矩阵与有效性

| 层 | 项目 | 结果 |
|---|---|---|
| 静态 | npm ci / typecheck / build | 全绿 |
| 单元 | node --test 17 项（映射/分页/配置校验/SSE 解析/回退逻辑） | 16 过 + 1 live 条件跳过 |
| 双侧契约 | WeKnora 仓库 Go 契约测试（fixture 前缀 opencode:）+ 插件侧对 mock-weknora 契约 | 双侧绿（宿主机 go1.26 直跑） |
| 打包 | npm pack 清单核对（dist/shasum d24fc145） | 一致 |
| 冒烟 | worktree dist 装进 opencode 加载 | 4 工具全部注册可见 |
| 安装链路 | 测试环境 plugin 入口改包名，opencode 自动从 npm 安装加载 | 成功 |
| 用户 TUI 实测 | ①暗号搜索命中 ②onboarding 问题——**模型按工具描述自主选择 weknora_search 而非 ask** ③再搜索 ④整篇阅读自发走 list→search→read 三连 | 4/4 |

有效性论证：单元与双侧契约保证「插件与 WeKnora API 的契约冻结」（上游 API 改动会在 CI 两侧
同时红灯）；冒烟与安装链路保证分发可用；**TUI 实测第②④轮是关键**——它们证明的不是代码正确，
而是工具描述的路由设计真的改变了模型行为（优先检索、自发多跳），这是本插件的设计目标本身。

## 6. 益处

- **对编码智能体用户**：组织私有知识（内部规范、架构决策、API 约定）进入编码上下文，
  答案可溯源（knowledge_id→原文），不再依赖模型猜测。
- **对 WeKnora 生态**：检索能力的消费面从聊天 UI 扩展到编码工具链；双侧契约测试把
  「API 是生态契约」变成 CI 可执行的断言。
- **对团队**：沉淀了 opencode 插件的完整开发范式（加载器约束、配置校验时机、工具描述
  即提示词工程的实证）；npm 2FA 发布的伪终端流程（script -fqec 网页授权）也走通了。

## 7. 状态与风险

- PR #3062 open 待 review；CI 内 e2e 为声明跟进项；@wxg-prc-cpg 包名待官方确认
  （个人 scope 已先行验证安装链路，官方确认后一条 tag 即可发协调名）。
- 若上游 #3093（排序核心统一）落地，ask 工具背后的检索链路质量随上游整体提升，插件零改动受益。
