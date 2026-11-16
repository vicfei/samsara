# dsh-super-agent 新会话交接(v1.2 实现阶段)— 2026-11-05

## 你是谁、在做什么
- 项目目录:**/home/ubuntu/dsh-super-agent**(会话工作目录可能是 /home/ubuntu/Samsara,请先 cd 过去)
- 项目:任意 CLI coding agent 的准入控制编排器(admission-control orchestrator),DeepSeek Super-agent 授权设计的独立实现。五通道(GitHub/飞书/Slack/Telegram/微信)、快/慢路径、off/observe/auto 阶梯、结构化合并闸、投机执行+交付闸、IM 数字审批面
- 现状:npm **@vicfei/dsh-super-agent@1.1.0**(注意裸名 dsh-super-agent 是别人的包),204/204 测试离线全绿,零开放 issue/PR,main 干净
- 我:vicfei(Fei.Chen),仓库 owner,对话用中文

## 硬性纪律(不可违反)
1. **永远不直接提交 main**:分支 → 英文 PR → CI 绿 → squash 合并(纯文档也一样)
2. issue/PR 全英文;README.md 与 README.zh-CN.md 双语同步
3. commit author:`git -c user.name="Fei.Chen" -c user.email="cnfeichen@163.com"`
4. token/密钥永不打印、永不提交
5. pkill 一律方括号模式:`pkill -f "[t]sx src/cli.ts watch"`
6. npm 安装加 `--registry=https://registry.npmjs.org`

## 刚完成(2026-11-05)
- PR #79:主页架构图重绘为 v1.1 版(docs/architecture.svg,五通道/沙箱/Watchdog/合并闸/人的审批面),已合并
- 竞品扫描结论:LofiSu/deepseek-super-agent 两天合 30 个 PR(routines #150/#156、CLI-only 审批 #151、本地只读 UI、Mesh、语义记忆、Skills);thefullgc/opensuperagent(11-02 建)3 天 ★34 靠 `init` 向导+Web UI;xmanrui/dsh-im ★3224 是互补网关层。LofiSu 自己的 docs/COMPETITIVE_GAP.md 承认"通道审批"是其缺口——**我们 v1.1 的 IM 数字审批领先**
- PR #80:**v1.2 设计三件套已合并**到 docs/designs/:`routines-source.md`、`init-wizard.md`、`v1.2-scope.md` —— 这是后续实现的唯一依据,先读它们
- A1 预备完成:狗粮 policy 已加 `"approval": {"enabled": true}`;worker.py 装了 FAILTEST 钩子(任务含 FAILTEST → exit 3 → needs-person);daemon 已重启且健康(微信源 armed、App 认证 OK);`approval_routes` kv 会在我下一条微信 DM 进来时自动注册

## 任务队列(按序推进,除 A1 外都不需要我动手)
1. **v1.2-routines(timer Source)**:按 routines-source.md 测试先行——零依赖 cron 解析器表测试 → IANA 时区折叠(Intl,无扫描)→ 补跑合并(kv `routine-last:<id>`,漏 N 次只补 1 次)→ routine sweep 挂进 watch.ts 循环(排在最前)→ CLI `dsh routines list/validate/fire`。**关键决策不要改**:触发器 `source:"timer"` 直接落在 reportTo 真实线程上(复用回帖路由/上下文并入/审批路由全套),不是 `routine:` 命名空间;必须走准入表,observe 模式下静默
2. **v1.2-init 向导 + doctor**:按 init-wizard.md,零依赖 readline 交互六步 + `--template minimal|dogfood` 非交互进 CI;doctor 只读检查、exit 0/1/2
3. **v1.2-P1/P2**:沙箱配置默认开(bwrap 存在时);`.dsh/approval-request.md` 文件协议(worker 有发言权、永远没有决定权,按 v1.2-scope.md P2 节)
4. 验收:全量测试离线绿;狗粮跑通一条真实 `morning-digest`(cron `0 8 * * 1-5`、tz Asia/Shanghai、reportTo=ops 微信线程)后才发 1.2.0;README §Quick start 改为 `npx @vicfei/dsh-super-agent init` + `dsh doctor`
5. **A1 等我实测**(不阻塞你):我会在微信发含 FAILTEST 的消息,预期 15–30 秒内收到 🔑 [approval needed] … 1 approve · 2 stop · 3 detail,回数字走状态机;我把收到的消息原文贴给你后排查/修复。🧪 投机路径另需 `ASSESS_BASE_URL/ASSESS_MODEL/ASSESS_API_KEY`(慢路径评估模型,尚未配置,等我提供)

## 狗粮环境速查
- daemon 状态:`ps aux | grep "[t]sx src/cli.ts watch"`
- 重启:`pkill -f "[t]sx src/cli.ts watch" && sleep 2 && (setsid nohup sh ~/.config/dsh/dogfood/start.sh >/dev/null 2>&1 &) && sleep 12`
- 配置:~/.config/dsh/dogfood/{policy.json(approval 已开), executor.json(worker=python3 worker.py,未开沙箱), engine.db(kv:wechat_auth/cursor/route、positions:*)},start.sh 里 PANEL_PORT=8799
- 日志:`tail -f ~/.config/dsh/dogfood/watch.log`
- 代码地图:src/{domain,source,engine,gate,assess,executor,work,watch,approval,merge,watchdog,wechat,telegram,feishu,slack,clip,panel,cli,runner,usage}.ts;tests/ 全离线;触发器五源枚举在 domain.ts,Source/ReplyChannel 契约在 source.ts

## 其他
- 最近三个 merge:#80(设计)、#79(架构图)、#77(v1.1 审批面实现)
- 推广被持续推迟(我的选择:先开发);LAUNCH-KIT(/home/ubuntu/launch-assets/LAUNCH-KIT.md)停在 v0.6.1,过期
- v1.3 候选(明确不在 v1.2):本地只读 Web UI、指标、email 通道、A2A
