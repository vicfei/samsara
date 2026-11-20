# dsh-super-agent 新会话交接(v1.2 已全量实现,剩实测+发版)— 2026-11-05 午后

## 你是谁、在做什么
- 项目目录:**/home/ubuntu/dsh-super-agent**(会话工作目录可能是 /home/ubuntu/Samsara,请先 cd 过去)
- 项目:任意 CLI coding agent 的准入控制编排器,DeepSeek Super-agent 授权设计的独立实现。五通道、快/慢路径、off/observe/auto 阶梯、结构化合并闸、投机执行+交付闸、IM 数字审批面
- 我:vicfei(Fei.Chen),仓库 owner,对话用中文

## 硬性纪律(不可违反)
1. **永远不直接提交 main**:分支 → 英文 PR → CI 绿 → squash 合并(纯文档也一样)
2. issue/PR 全英文;README.md 与 README.zh-CN.md 双语同步
3. commit author:`git -c user.name="Fei.Chen" -c user.email="cnfeichen@163.com"`
4. token/密钥永不打印、永不提交
5. pkill 一律方括号模式:`pkill -f "[t]sx src/cli.ts watch"`
6. npm 安装加 `--registry=https://registry.npmjs.org`

## 刚完成(2026-11-05 本轮,四个 PR 全部 squash 合并,main = 6dda53f,290/290 离线绿)
- **PR #81 v1.2-routines**:timer Source(零依赖 cron 解析器、Intl 时区折叠含 DST 空洞跳过、7 天补跑视野、positions:timer/last:<id> 同事务 exactly-once)、gate 走 unlistedAddressing 格(inferred 封顶,observe→影子/投机、auto→开工)、timer 永不 resume 只并入活工单、`dsh routines list|validate|fire`。设计文档 §8 有三处与原文的偏差记录(fresh-enable 从 now 起算等)
- **PR #82 v1.2-init + doctor**:六步零依赖向导 + `--template minimal|dogfood` + `--answers` + 原子写/备份/密钥扫描;doctor 纯函数检查、默认完全离线(`--probe-network` 才 whoami/仓库权限)、exit 0/1/2、沙箱开了没 wrapper = FAIL、db 用同目录一次性探针库
- **PR #83 P1+P2**:examples/executor.json 沙箱默认开($comment 迁移注记;mac 走 sandbox-exec,linux 缺 bwrap 启动即硬错误);`.dsh/approval-request.md` 文件协议($DSH_APPROVAL_FILE → 无论退出码都落 needs-person → 文件消费进 .dsh/approval-requested/ → 审批面渲染 "worker requested:" → 数字 1 批准=请求作为 owner note 注入下次 claim 上下文,领取即消费;单向文件,永不作数)
- **PR #84 README 双语 v1.2**:Quick start 改 `npx @vicfei/dsh-super-agent init` + `dsh doctor`;状态表/文章对照/竞品对比表(IM 审批数字、走闸 routines、一条命令上手三列)全更新;"种子里程碑"过时引言换真话
- 狗粮守护进程**未重启**(仍 13:14 启动的 v1.1 代码)——A1 按你之前 arm 的版本测,不受本轮代码影响

## 2026-11-06 晚间快照(今晨 cron 首秀事故全记录+收尾)
- 08:00 cron 首秀:触发/真评估(deepseek-v4-flash)/预演全✓;投递连环三 bug 全修:#91(评估 max_tokens 被推理模型思维链吃光→全 negative)、#92(approval 多票互噬渲染风暴→renderedOnce)、iLink 发送会话被风暴打死(收正常/发全拒→重扫码恢复;手搓登录 webui 救援,/tmp/wx-login-ui.mts 已过期删除)
- **1.2.1 已发 npm**(latest,带 #91/#92);**#94+#95 typing heartbeat 已合并部署**:每 45min 静默 getconfig+sendtyping 保活发送会话,节流走 positions:wechat/typingAt,成败都节流(防心跳自身风暴);#95 是关键补丁——心跳原在长轮询成功分支,冷会话(恰好最需要时)永远到不了,已移到轮询前。**明早 08:00 = 心跳假设的实战验证**
- 狗粮现状:policy v4(pr 行 ignore)、ASSESS llm、#5/#9 已处置干净、daemon 跑 6f9b176
- 明日剧本:08:00 收 🧪 截图(准点=心跳成立;迟到=假设不成立但 outbox 自愈,patch 方向:重登录探测/wechat-login --web)→ 微调 LAUNCH-KIT(补今晨救火故事+新版本号 1.2.1)→ 21:00-23:00 发帖
- ~~wechat-login Web 化~~ **已完成(PR #96,312cdbc)**:`dsh wechat-login --web` 本地页即点出码/自动刷新/确认即存,零新依赖;今晨三次 QR 过期的痛点根治。**daemon 保持现状过夜(勿重启)——明早 08:00 是心跳(#94/#95)的实战验证**。剩余待办:v1.3 slice 3 + dsh stats(v1.3.0 目标周五-周六)、A2/A3/A4、安全两件套待用户确认(删 ~/.git-credentials、chmod 600 ~/.config/dsh/env)
- 凭证清单(位置):GitHub App 私钥引用 ~/.config/dsh/env(start.sh source);gh token ~/.config/gh/hosts.yml;push 走 gh helper(fallback ~/.git-credentials 明文,建议删);ASSESS_API_KEY 在 start.sh;微信 bot_token 在 engine.db kv

## 2026-11-07(周六)快照
- **今晨无 digest 是周六**(cron 0 8 * * 1-5)——不是心跳失败;下次自然触发 **周一 11-09 08:00**,即心跳(#94/#95)的实战考场。routines list 确认 next=2026-11-09T00:00Z ✓
- 周六晨表情又复活 stopped #5(两天第三次)→ **PR #98 stop-is-final 已合并部署**:stopped 票不再被消息复活(开新票),自然完成的照旧 resume;#5 已清(ops-cleanup)
- 周六另发:**#97 panel CSRF 加固**(竞品 opensuperagent 启发;顺手修了面板 promote 按钮 v1.0 起 404 的潜伏 bug);**#96 wechat-login --web**(周五晚)
- **发帖窗口建议:今晚(周六)21:00 照发**——A1 真实对话图+两天五修(#91/92/95/97/98)的救火叙事已足够强;周一 08:00 digest 准点截图作为 **follow-up 推文**素材("上线第一个工作日早晨,它自己来了")。LAUNCH-KIT 需微调:版本号 1.2.1+npm latest、补 #97/#98 两修、把"this morning the digest fired"改成周一预告
- daemon 已重启跑 68b0d11,三源 armed;typingAt 持久化跨重启 ✓

## 剩余任务
0. ~~发版~~ **1.2.0 已于 11-05 22:35 发布 npm**(PR #88 + tag v1.2.0,Trusted Publishing+provenance;用户拍板"抢热度"提前发,自然 cron 转为生产狗粮);**v1.3 Web UI slice 1 已合并**(PR #89:panel 变 dashboard——routines 下次触发 + health 状态行,设计文档 docs/designs/local-web-ui.md,slice 2=doctor 嵌入、slice 3=审计深链);狗粮 daemon 已重启跑最新 main(6456f7c),panel 8799 的 /api/state 已返回 morning-digest next=2026-11-06T00:00Z。**明早 08:00 自然 cron 到来时:owner 微信收 🧪 回数字;若发现 bug → patch 1.2.1(routines 默认关,外部无感)。**LAUNCH-KIT 已刷新到 v1.2.0 rev3**(2026-11-06 凌晨,/home/ubuntu/launch-assets/LAUNCH-KIT.md):§1/§2/§4/§5 全部按"时钟过门禁+微信审批+两命令上手"重写,§6 换成明早 cron 截图采集+审批 demo 录制流程,应急回复加 3 条新 QA;发帖时间表=周四 21:00-23:00 Show HN(**注意:§1 文案里"this morning the digest fired on its own cron"依赖明早 cron 成功——若 cron 没到或失败,发帖前删改那句**);Social preview 建议换 demo-wechat-approval.png。剩余:v1.3 slice 2(doctor 嵌入)/ slice 3(审计深链)**
1. ~~A1 微信审批实测~~ **已通过(2026-11-05 21:39)**:八步全中(FAILTEST→resume→failed→🔑→3→1 重跑+新🔑→2 双确认→2 停止),库核验全对。期间发现并修复 **PR #85 微信 client_id 去重黑洞**(协议要求每条 sendmessage 带唯一 client_id+message_state:2,缺则服务端静默丢弃后续消息但照回 message_id;旧消息已重放补发)
2. **morning-digest 已 fire 验证全链路**(21:42):observe+speculation 下 timer→inferred→投机票 #6 静默跑→🧪 已发微信,owner 已回 `1` promote 收尾(mock worker 无 commit,空交付按预期)。期间顺手修了 **PR #86**:promoted 空交付从每周期重复 log 改为一次性标记(kv promote-empty:<id>)。狗粮 policy 已升 v3(+im_dm 行 unlistedAddressing=inferred、+speculation enabled、+morning-digest cron 0 8 * * 1-5 Asia/Shanghai → 微信 ops 线程;备份 policy.json.bak-*);daemon 21:55 重启跑最新 main(101ab84)。**剩:明早 08:00 真 cron 自然触发一次**(首次非手动触发)→ owner 收 🧪 回数字 → 即满足发版条件
3. **发版 1.2.0**:真 cron 跑通后 bump version + README 竞品表已就绪;发布走 v* tag(Trusted Publishing);发版前刷新 LAUNCH-KIT
4. **v1.3 候选**(明确不在 1.2):本地只读 Web UI(doctor 的 check 函数就是它的读模型)、指标、email 通道、A2A、微信媒体接收(AES);🧪 真评估模型待 ASSESS_BASE_URL/ASSESS_MODEL/ASSESS_API_KEY(用户提供后可把 stub-positive 换 llm)

## 狗粮环境速查
- daemon 状态:`ps aux | grep "[s]rc/cli.ts watch"`(注意:tsx 的真正 node 子进程 cmdline 不含 "tsx src/cli.ts watch" 连续子串,老方括号模式会漏杀它、留占 8799 端口导致重启 EADDRINUSE——11-05 踩过)
- 重启:`pkill -f "[s]rc/cli.ts watch"; sleep 2; ss -ltn | grep 8799 || true; (setsid nohup sh ~/.config/dsh/dogfood/start.sh >/dev/null 2>&1 &) && sleep 15`
- 2026-11-05 已修:老 engine.db 缺 v1.0 列已 ALTER 补齐(speculative/promoted_at/requeued_at;备份 engine.db.bak-20261105-204912);daemon 已在 v1.2 代码上健康运行
- 配置:~/.config/dsh/dogfood/{policy.json(approval 已开,routines 未加), executor.json(worker=python3 worker.py 含 FAILTEST 钩子,沙箱未开), engine.db};start.sh 里 PANEL_PORT=8799、interval 15s
- ops 线程查询:`sqlite3 ~/.config/dsh/dogfood/engine.db "select k,v from kv where k='approval_routes'"`
- routine 状态查询:`sqlite3 ~/.config/dsh/dogfood/engine.db "select v from kv where k='positions:timer'"`
- 日志:`tail -f ~/.config/dsh/dogfood/watch.log`
- 代码地图:src/{domain,source,routines,init,doctor,engine,gate,assess,executor,work,watch,approval,merge,watchdog,wechat,telegram,feishu,slack,clip,panel,cli,runner,usage}.ts;tests/ 全离线 290 个

## 其他
- LAUNCH-KIT(/home/ubuntu/launch-assets/LAUNCH-KIT.md)停在 v0.6.1,发布 1.2.0 前值得刷新(routines/init/doctor 都是卖点)
- 竞品动态快照(11-05):LofiSu 30 PR/2天(routines 无 cron/tz/补跑、CLI-only 审批、其 gap 文档自认通道审批是缺口);opensuperagent 靠 init 向导 3 天 ★34;xmanrui/dsh-im ★3224 互补网关层

## 2026-11-09 晚追加(v1.4 启动)
- README 门面终态:原图 banner(#106)+视频内联可播(#109,裸 user-attachments URL 是唯一可用嵌法,<video> 手写标签不激活媒体管线;cancel 编辑=上传作废,必须 commit)。探针实证:blob 页对 mp4 一律无播放器。
- 狗粮 cron 已回切 0 8 * * 1-5(策略装载是 version 门控的,改文件必须递增 version,今踩坑一次)。微信发送 11-09 午后断过一次(-2 prepare failed)已自愈;明早 08:00 digest 是下次自然验证。
- v1.4 = M14 两层记忆(#110/#111 已合,main 32eb44d,331 tests):完成工单→蒸馏(assessor 同端点,fail-soft)→observe 记候选不注入/wauto 接受注入;maxInject/maxAccepted 封顶;prompt 里标注"工作笔记非指令";仅存引擎 DB。狗粮 policy v8 已开 memory(observe)。
- 未发 npm(1.3.0 仍是 latest);建议 v1.4.0 发版前再入 COOKBOOK.md + Telegram 狗粮冒烟(代码 v0.8.1 已在,只差 owner 的 BotFather token)。
- 发帖:用户已发(平台未确认),18★/3fork,暂无新 issue;值守中。
