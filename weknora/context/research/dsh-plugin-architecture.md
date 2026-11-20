# dsh（DeepSeek Harness）插件体系深潜

> 作者：新加坡节点 2026-09-09（第 5 棒，dsh/opencode 研究窗口）。研究对象：
> @deepseek-ai/dsh@0.1.2-rc.1（npm 开发者预览版，node24 全局安装）。安装树
> $DSH=/home/ubuntu/.nvm/versions/node/v24.20.0/lib/node_modules/@deepseek-ai/dsh。
> 所有 lib/*.js 为 esbuild 产物但**未混淆**（保留 JSDoc 与 region 标记），关键包另附 src/*.ts。
> 配套实测环境：~/.dsh/profiles/{headless,web}，插件 @wxg-prc-cpg/dsh-weknora@0.1.0（官方）。

## 1. dsh 是什么：定位与包结构

DeepSeek 官方的编码智能体宿主（CLI），核心是把「智能体宿主」本身做成一个**插件化运行时**：
内核是 cordis（koishi 系的依赖注入容器），一切能力（文件、shell、工具、LLM 适配、会话持久化、
Web UI、headless）都是 cordis 插件。0.1.2-rc.1 共 70 个依赖，dsh-* 家族分层清晰：

| 层 | 包（示例） | 职责 |
|---|---|---|
| 内核 | @deepseek-ai/cordis、cordis-plugin-loader / -include / -hmr | 容器、插件加载、patch 叠加、热重载 |
| 引导 | dsh-app-boot、dsh-home-paths、dsh-cmdline | profile 发现与组装、~/.dsh 路径、命令行注入 |
| 能力后端 | dsh-fs-local、dsh-pwsh-local/-sandbox | ctx.fs / ctx.shell 契约实现（**不是工具**） |
| 模型工具面 | dsh-tool-fs/-pwsh/-web/-subagent/…、dsh-tools | ctx.tools 注册表 + 官方工具集 |
| LLM | dsh-llm-pi-ai、dsh-agent-default-model | 模型路由（pi-ai 适配器） |
| 会话 | dsh-session-persistence-jsonl、dsh-session-projection-cache、dsh-token-meter | zstd JSONL 事件日志 + 投影缓存 |
| 形态 | dsh-headless、dsh-web-app、dsh-sdk-app、dsh-acp-app | 单次 CLI / Web UI / SDK / ACP 四种宿主形态 |

注意分工：`dsh-fs-local` 实现 `ctx.fs` 契约，模型可见的 read/write/edit 工具在 `dsh-tool-fs`
（消费 ctx.fs）——后端与工具面分离，同一后端可换工具面。

## 2. 启动与 profile 组装（四层 patch 叠加）

`dsh` launcher（$DSH/lib/bin.js:74-148）只认 `--profile/--patch/--dump-config/--dump-default-config`，
其余参数**透传**给被启动的 app（`web` = `--profile web` 别名；`plugin` 子命令转发 pnpm）。

profile = `~/.dsh/profiles/<name>/` 目录（package.json + cordis.patch.yml + 自有 node_modules）。
组合顺序（profile-boot-BTzzdrGY.js:166-211，与 README 一致）：

```
空根（cordis.yml 每次启动重写为 []）
  ← ① bundle patches：package.json dsh.profile.bundles 顺序（dsh-base → dsh-headless → dsh-weknora）
  ← ② profile 自身 cordis.patch.yml
  ← ③ home 级 ~/.dsh/cordis.patch.yml
  ← ④ --patch overlays + telemetry 开关
```

patch 语义（app-boot index.js:59-108）：`id` 定位已有行→**整行覆盖不深合并**；`insert` 追加新行；
id 不存在只 warn。patchReload 决定热重载档位（startup/live），live 档额外挂 timer+hmr watch。
`dsh plugin add` = pnpm 装进 profile + 把声明了 `dsh.bundle` 的包**追加进 bundles 列表**
（plugin-F7ZVfRyo.js:46-78 reconcilePlugins）。

## 3. 插件加载器与 node≥22 的真相（排障点①的机制解释）

结论先行：**node≥22 的门槛不是 compile cache，而是 Node 22+ 才有的内部 ESM cascaded loader API**。

- cordis-plugin-loader/src/internal.ts:131-143：`major < 22` 直接 `return undefined`；
- 正常路径经 native addon `node-addon-require-builtin` require `internal/modules/esm/loader`
  拿 `getOrInitializeCascadedLoader()`，得到带 `import(name, parentURL)` / `register()` 的 loader
  （internal.ts:47-99 定义 V1/V2 两套接口）；
- **cross-tree resolution**：加载器代码住在 dsh 安装树，而插件条目必须从 profile 树解析。
  `internal.import(name, ctx.baseUrl)` 以 profile 目录 URL 为 parent 导入，等效"假装从 profile
  目录发起 import"，跨过两棵依赖树（app-boot index.js:1495 `ctx.baseUrl = dirname(configPath)`）；
- node20 下 `internal === undefined`，裸包名退化为 `import(name)` 按加载器自身 URL 解析
  （config/tree.ts:144-162），装在 profile 的树外插件（dsh-weknora）**解析不到且无报错**——
  这就是"node20 静默失效"的完整机制。app-boot README.md:136 明文承认此约束；
- 配套 `healProfilesModuleFallback`（app-boot index.js:657-667）把 dsh 依赖闭包 symlink 进
  `~/.dsh/profiles/node_modules`，让 profile 锚定的解析两头都能命中。

插件声明约定：**没有 cordis package.json 字段**。普通插件 = loader entry（name 为模块说明符），
入口导出 `apply(ctx, config)` 或 Service 子类（如 dsh-fs-local 默认导出 LocalFileSystem）。
bundle = package.json `dsh.bundle.patch` 字段 + exports 暴露 patch yml（dsh-headless/package.json:25-40 范例）。

## 4. 工具注册 API（ctx.tools.register + defineTool）

注册表在 @deepseek-ai/dsh-tools（dsh-base 挂载）。一等接口（types/index.d.ts:106-172）：

```ts
ctx.tools.register(defineTool({
  name, description,
  parameters: { field: { type, required?, description } },   // 简写形态；也接受完整 JSON Schema
  output: { schema, render(args, value): ContentBlock[] },   // 双契约：canonical JSON 值 + 模型面文本投影
  execute(args, exec) => Promise<value>,                      // exec.signal 协作取消；返回值须符合 output.schema
  timeoutMs?, isConcurrencySafe?(args)?,                      // 超时不发给模型；并行 opt-in
  presentCall?/presentResult?,                                // UI 呈现回调
}))
```

关键设计：**canonical 值与模型面文本分离**——execute 返回符合 schema 的 JSON（无损、可程序消费），
render() 负责投影成给模型看的文本（可裁剪、可省 token，dsh-weknora 的 describeScope 即例）。
注册返回 disposer，插件卸载即撤工具。官方工具范例：dsh-tool-fs/lib/index.js:331-343（read 工具）。

## 5. 模型路由：llm-pi-ai（排障点③的机制解释）

包 dsh-llm-pi-ai（运行时 @earendil-works/pi-ai）。dsh-base 里**休眠挂载**（零路由），
有 `llm-pi-ai:` settings/config 段才激活。手工声明 provider（cordis.patch.yml 的 llm-pi-ai 行）：

```yaml
providers:
  <route-key>:            # 如 dashscope；不在已装目录 = 手工网关，必填 api/baseURL/models
    api: openai-completions   # 仅 3 选：openai-completions / openai-responses / anthropic-messages
    baseURL: https://...      # Bedrock/Vertex/Azure/Codex 因凭证形态被刻意排除
    apiKeyEnv: DASHSCOPE_API_KEY   # 每请求经 credential seam 解析，不落配置文件
    models: [{ id, name, contextWindow }]   # 整体替换该 route 模型目录（非追加）
```

消费方：dsh-agent-default-model（Service，config `{provider, model}`；dsh-base 缺省
deepseek-official/deepseek-v4-flash）。profile patch 里两条 id 覆盖即可把整个 agent 指向
任意 OpenAI 兼容端点——**官方 e2e 正是用这招把 dsh 指向本地假模型服务器**
（packages/dsh-weknora/test/e2e/run-in-dsh.mjs:89-115 modelPatchRows）。

## 6. headless 模式：单次执行链路与轨迹提取

`dsh --profile headless "任务"`（startup.js:20-25：唯一参数 `[task...]`，**无 --json/--verbose**）：

```
headless-startup 解析 task → headless-runner（dsh-headless/lib/index.js:126-167）
  → agents.create(session-<uuid>, provider/model 来自 agent-default-model)
  → agent.followup(用户消息) → agent.whenIdle()（循环本体 dsh-agent-loop）
  → sessions.flush() → stdout = 最后一条 assistant 文本；stderr = 流式 reasoning
  → 退出码：turn/end reason == completed ? 0 : 1
```

**轨迹与用量全在盘上，事后可查**（headless 本身不打印）：
- `~/.dsh/sessions/--<cwd编码>--/session-<uuid>/session.jsonl.zstd`：zstd 压缩 JSONL 事件流。
  事件含 `tool/call`（callId+name+arguments）、`tool/result`、`request/context`（provider/model/
  contextWindow 快照）、`assistant/chunk`（text-delta / tool-call-delta / **usage**（逐次
  inputTokens/outputTokens/cacheReadTokens）/ finish）、`turn/start|end`、`session/title` 等；
- `~/.dsh/storages/session_projcache/sessions/session-<uuid>.json`：投影缓存（dsh-token-meter
  从事件日志 replay 折叠），含聚合 `tokenUsage`（uncachedInput/output/cacheRead/cacheWrite totals）。

自动化测试取数路径：跑完 → 找最新 session 目录 → `zstd -dc` 解析 JSONL → 提取工具序列+usage。

## 7. 官方 dsh-weknora 插件解读（@wxg-prc-cpg/dsh-weknora@0.1.0，961 行 dist）

结构：index.js（apply：resolveConfig → WeknoraClient → 注册 createTools 产物，inject=['tools']）/
config.js（127 行加载期全量校验）/ client.js（287 行 REST+SSE）/ tools.js（481 行四工具）/
render.js / harness.js（结构类型，保持零运行时依赖）。配置经 bundle 自带 cordis.patch.yml 的
`!!js process.env.WEKNORA_*` 求值注入。

四工具与我们 opencode-weknora 同名同 API 面，但有三处值得注意的设计差异：

| 设计点 | dsh-weknora（官方） | opencode-weknora（我方） |
|---|---|---|
| 输出契约 | canonical JSON schema + render() 文本投影双轨 | 直接给模型文本结果 |
| scope 解析 | 未配置时**自动解析全部可见 KB**（memoize），RAG 拒绝无 scope 请求的产品行为倒逼 | 同样自动解析（我方先实现） |
| search 增强 | 并行 findDocuments 按名找文档（fail-soft，老后端无此路由不受伤） | 同样有（我方先实现） |
| ask 管线 | RAG（knowledge-chat）+ agent（agent-chat）双路由，session_id 续问，web_search 开关 | 仅 RAG，session 续问有 |
| SSE 守护 | 无 `complete` 事件即抛错（部分答案不当完整答案交模型） | 同样守护 |

**勘误**：opencode-plugin-deepdive.md §4 称官方 dsh 插件"问答为主"——实读 0.1.0 的 ask 描述
（tools.js:379-383："Reserve it for broad or synthesis questions… prefer search: it is far faster"），
官方插件同样是**检索优先、问答兜底**的描述驱动路由，两插件策略一致（我方与官方独立趋同）。

另注意：插件 package.json engines 写 `node >=20.11`，但树外安装实际受加载器 major≥22 门槛约束
（§3）——插件元数据不足以预告该坑。

## 8. 沉淀与启示

- **排障点机制版**（接 handoff-20260905 09-09 深夜节）：①node≥22=内部 cascaded loader（§3）；
  ②密文解密=SYSTEM_AES_KEY AES-256-GCM；③模型路由=llm-pi-ai 手工网关 patch（§5）。
- **对我方 opencode 插件的可借鉴点**：canonical/render 双输出契约（为 UI/程序消费留无损通道）；
  ask 的 agent-chat 双管线与 web_search 开关（WeKnora 已有该路由，工具面未暴露）；
  engines 字段与真实运行门槛分离的教训（文档里写清宿主版本要求）。
- **e2e 范式**：官方 run-in-dsh.mjs 的「假模型 + mock WeKnora + 真宿主」三层脚手架是宿主级
  测试的黄金样板，已被本窗口复用为双宿主对照实验的确定性轨道（见 dual-host 报告）。
