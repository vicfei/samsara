# Bocha AI Search Provider 开发深潜（feat(web-search)，PR #3036，已合并 15727591）

> 作者：新加坡节点 2026-09-05~07 开发，09-07 合并进 upstream/main。
> 代码现状：`internal/infrastructure/web_search/bocha.go`（253 行）+ `bocha_test.go`。
> 本文行号以 upstream/main@647848f3 为准。

## 1. 这个功能是什么

为 WeKnora 新增「博查（Bocha）AI 网络搜索」供应商：租户在设置页创建 Bocha provider（填 API key，
可选 freshness/summary），智能体开 web_search 后，ReAct 循环里的 `web_search` 工具即经博查实时
检索，回答带真实网页引用。博查是面向中文的按次计费搜索 API，补齐了 WeKnora 中文场景的商用搜索选项。

## 2. WeKnora 网络搜索子系统架构（依赖地图）

```
前端 WebSearchSettings.vue（动态表单，零硬编码）
  ↑ GET /web-search-providers/types（config_fields 元数据驱动渲染）
应用服务层 WebSearchProviderService
  ├─ isValidProviderType 白名单（CRUD 准入）          ← 接线点③
  ├─ validateProviderParameters switch（参数校验分发）  ← 接线点④
  ├─ 凭据存储（SYSTEM_AES_KEY 加密，回显永不返回明文）
  └─ Registry（infrastructure/web_search/registry.go）
       └─ ProviderFactory map: id → New*Provider
            └─ BochaProvider 实现 interfaces.WebSearchProvider
                 （internal/types/interfaces/web_search.go:10：Name() + Search()）
运行时：session_agent_qa 的 web_search 工具 → 服务层取租户 provider 实例 → Search()
语义门：agent 配置 web_search_enabled && 请求级 web_search_enabled（AND）
存储：WebSearchProviderEntity（types 枚举+元信息 ← 接线点①；container 注册 ← 接线点②）
```

**四个接线点**：① types 枚举与 config_fields 元信息（freshness 下拉、summary 开关经 `/types` 下发，
前端动态渲染——这正是 UI 零代码改动就能显示表单的原因）；② container DI 注册 factory；③④ 服务层
白名单与参数校验 switch。这是该子系统的横切设计：**新增供应商要动 4 处**（S-18 登记的散射问题，
bocha 开发亲身踩中，见 §5）。

## 3. 实现细节与设计取舍（bocha.go）

| 设计点 | 实现 | 理由 |
|---|---|---|
| 端点 | 硬编码 `https://api.bochaai.com/v1/web-search`，不可配 | 照 metaso 模板：租户不可配 URL = 防 SSRF |
| 鉴权 | `Authorization: Bearer <key>` | 博查官方方式 |
| 超时/限流面 | 30s 超时；`LimitReader(4MB+1)` 硬顶响应体 | 恶意/异常大响应不拖垮服务 |
| 结果数 | clamp 1~50，默认 10 | 防御性默认 |
| freshness | 枚举 {noLimit,oneDay,oneWeek,oneMonth,oneYear}，校验失败即报错 | 博查特有参数，经 ExtraConfig 传入 |
| summary | 默认开（`!= "false"`） | 博查 AI 摘要质量高，snippet 优先取 summary 再退 snippet |
| 错误解析 | `message`/`msg` 双字段回退 + 裸体 4KB 截断 | **实测发现**的错误 wire format 见 §4 |
| code 字段 | 自定义 `bochaCode` 类型：字符串/数字双形态容错 | 同上 |
| 日期 | datePublished 三布局解析（RFC3339Nano/空格/日期）；**dateLastCrawled 的 Z 后缀修正为 +08:00** | 博查遗留字段把 UTC+8 墙钟标成 Z，实测抓到后只修此字段 |
| 结果清洗 | name+url 双空跳过；`Source:"bocha"` | 与官方家族一致的可溯源标记 |

## 4. 开发过程的关键实证：文档与线上的 wire format 不一致

博查官方文档在登录墙后，公开文档描述的错误形态是 `{"msg":..,"code":401}`（数字 code）。**用无效
key 直打真实端点**后发现真实形态：`{"message":"Invalid API KEY","code":"401"}`——字符串 code +
`message` 字段。若按文档实现：错误细节丢失、成功响应若 code 为字符串会 Unmarshal 失败。据此加了
`bochaCode` 双形态容错与 message/msg 回退（dca6b8a3）。拿到有余额的 key 后补测 happy path：
成功形态是数字 `code:200` + Bing 兼容 `data.webPages.value`（name/url/snippet/summary/
datePublished/dateLastCrawled），3/3 结果正确映射、count 截断、带 +08:00 偏移的 RFC3339 正确解析
（两次真实调用成本 ¥0.07）。

**教训**：外部 API 集成的契约必须以实测线格式为准，文档（尤其登录墙后的）只能作初始假设。

## 5. 集成测试抓到的真 bug（单测测不到的接线点）

在官方 compose 栈内换壳运行本分支二进制做集成测试：provider 能在 `/types` 列出、`/test` 通过，
但 `POST /web-search-providers` 创建被拒 `invalid provider type: bocha`——**服务层 CRUD 白名单
（接线点③）和参数校验 switch（接线点④）是独立于 factory 注册的第二个 wiring 面**，单测与原始凭据
测试端点都不经过这条路径。修复 471b7813 + 服务层测试。此发现直接催生本节点门禁规则
「先本机集成后推送」，也即登记簿 S-18 的实证案例。

## 6. 与官方同类实现的对比

官方家族 13 个供应商：baidu/bing/brave/duckduckgo/exa/google/keenable/metaso/ollama/proxy/
searxng/tavily/zhipu（均有 `_test.go` 的：brave/exa/keenable/metaso/searxng/zhipu/bocha）。

| 维度 | bocha（本实现） | metaso（模板来源） | 家族共性 |
|---|---|---|---|
| 接口形态 | Name+Search，Registry factory | 同 | 全家族一致 |
| 端点策略 | 硬编码防 SSRF | 硬编码 | 官方共识 |
| 特有参数 | freshness 枚举 + summary 开关 | scope=webpage 等 | 各家自有 ExtraConfig |
| code 容错 | **字符串/数字双形态** | 单形态 | bocha 独有（源于实测） |
| 日期修正 | dateLastCrawled Z→+08:00 | 无此处理 | bocha 独有 |
| 验证深度 | 单测+真实错误路径+真实 happy+服务内集成+agent 链路+UI | 单测为主 | 我们的验证矩阵超家族基线 |

差异的本质：官方 provider 多为「照 API 文档实现 + 单测」；本实现把验证推进到真实端点、真实服务
进程和真实智能体循环——多花的验证换来了两个文档不会告诉你的发现（错误形态、接线点缺口）。

## 7. 测试矩阵与有效性

| 层 | 项目 | 结果 |
|---|---|---|
| 单元 | bocha_test.go：映射/截断/日期/双格式错误/参数校验 | 7/7 |
| 适配器真连 | 无效 key 401 路径（真实端点） | 错误信息完整透出 |
| 适配器真连 | 有余额 key happy path | 3/3 映射，¥0.07 |
| 服务内集成 | /types、/test、CRUD、按 ID 检索、凭据不回显、删除 | 7/7（含抓到的接线 bug 修复后） |
| 智能体链路 | smart-reasoning + web_search_enabled 真实提问 | ReAct 4 次调用全走博查，回答带真实引用，模型自发迭代查询（含 site: 语法） |
| UI | 官方前端零改动 | 下拉/动态表单/测试连接与内置供应商行为一致 |

有效性论证：六层验证互相不可替代——单测保证映射逻辑，真连暴露线格式，服务内集成暴露接线缺口
（唯一抓住 471b7813 bug 的层），智能体链路证明端到端价值，UI 层证明元数据驱动设计的红利。

## 8. 益处

- **对上游用户**：中文场景多一个高质量商用搜索选项；凭据 AES 加密存储、回显不泄密；`/types`
  元数据使前端零改动扩展成为该子系统的标准路径。
- **对 WeKnora 工程**：bocha 成为 S-18（四点接线散射）的活案例与未来重构的回归基线；
  双形态 code 容错的写法可被后续国内供应商复用。
- **对团队**：验证矩阵升级为节点门禁；换壳工具链（compose override + 容器内编译）沉淀为可复用资产。

## 9. 关联

- issue #3035（提案）→ PR #3036（实现）→ 15727591（合并）。
- 后续：S-18 若被采纳（单一事实源化接线），bocha_test 的服务层用例即迁移目标。
