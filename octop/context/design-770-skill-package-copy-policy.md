# #770 技能包复制管控 — 方案设计（2026-09-23，待维护者对齐后实施）

issue: https://github.com/TencentCloud/Octop/issues/770
代码核验基线: upstream/develop（copy 端点 skills.py:569、assert_can_mutate skill_package_store.py:185、
_guard_package_only_skill_write skills.py:202 已解析 frontmatter）

## 威胁模型（先立边界，写进 PR 与文档）

防：UI/API 层的一键复制、副本改写、无痕再分发。
不防（明确声明）：①挂载技能内容进入子用户 Agent 上下文后的转述外泄（LLM 读了就能说出去）；
②同机 OS 用户对文件的直接读写（单机自托管信任模型）。
强保证只承诺 deny；lock 是界面/API 级只读+溯源水印，agent 工具层只读需闭源 harness 配合（Phase 2）。

## Phase 1（单个 PR，独立可交付）

1. DB：skill_packages 加 copy_policy TEXT NOT NULL DEFAULT 'snapshot'（应用层枚举校验
   snapshot|lock|deny）。迁移 019 对 + migrate.py ensure 助手 + 全仓版本断言 18→19。
   ⚠️ 排序依赖：018 在 PR #1024 未合并——本 PR 必须排在 #1024 合并之后，或届时 renumber。
2. infra：SkillPackageRow.copy_policy；store.assert_can_copy(row, user)：
   admin/创建者恒可；其余 policy=deny → OctopError(SKILL_PACKAGE_COPY_DENIED)（403）。
3. copy 端点（skills.py:569）：repo.get 后加 store.assert_can_copy(row, user)。
   复用同文件 push 端点的 assert_can_mutate 模式。
4. lock 水印：copy_package_skills_to_workspace（infra/skills/skill_transfer.py:125）
   在 policy=lock 时给副本 SKILL.md frontmatter 写 origin: <package_id> + locked: true
   （机制与 _guard_package_only_skill_write 读 removed 同构）。
5. 写守卫扩展：_guard_package_only_skill_write 现逻辑"工作区有未 removed 副本即放行"
   → 扩展为：副本 frontmatter locked: true 且请求者非源包创建者/admin
   → 403 SKILL_PACKAGE_LOCKED。该守卫被两个写路径（PUT/DELETE/push）调用，覆盖
   dashboard 全部技能写 API。agent 工具层写入不在此防线（文档声明）。
6. API 面：GET 包列表/详情返回 copy_policy + can_copy（admin||created_by||policy!=deny）；
   PATCH 包端点接受 copy_policy（走 assert_can_mutate，天然创建者/admin 限定）。
   新 ErrorCode：SKILL_PACKAGE_COPY_DENIED / SKILL_PACKAGE_LOCKED
   （infra/errors.py + i18n errors.* en/zh + dashboard apiErrors 镜像，测试要求键一致）。
7. dashboard：包编辑抽屉加策略单选（默认 snapshot，仅 can_mutate 可见）；
   "复制技能"按钮按 can_copy 禁用+tooltip；锁定副本加锁标（GET 返回 locked）。
8. 审计：copy 成功 / deny 拒绝 / locked 写拒绝各写 audit（复用 #1024 的 audit 模式）。

## Phase 2（等 harness 表态，与 #1014 octop_run_limits 同通道提需求）

- agent 工具层对 locked 副本目录的写保护（BackendWorkspace deny-write 或 harness 工具校验）。
- 溯源贯穿：push-to-package 时源带 locked/origin 则目标包继承水印；
  管理员可查"哪些包/技能源自 lock 包"。

## 明确放弃（写进 PR 说明）

- C 方案（拆权限键/全局开关）：动权限模型，与 #456 方向重叠，留维护者产品决策。
- 文件系统 chmod 只读：同 OS 用户可绕、Windows 语义复杂，假安全。

## 测试设计

- store 策略矩阵：3 policy × admin/创建者/子用户 × assert_can_copy
- 端点：deny→403 且 ErrorCode 正确；lock 复制后 frontmatter 断言 origin/locked
- 守卫：locked 副本 PUT/DELETE/push→403；普通副本不受影响；removed 行为不回退
- 迁移幂等 + 老库默认 snapshot（行为零变更）；i18n parity 自动覆盖

## 体量估计

后端 ~250 行 + 测试 ~200 行 + dashboard ~150 行 + 迁移/文案 ≈ 一个中等 PR；
认领评论要点：方案 A 骨架 + B 轻量水印版 + 指出报告人 B 方案在 agent 工具层的窟窿 +
威胁模型边界 + 三待定项（A/B/C 取舍、lock 是否要 harness 配合、copy 端点是否同时收紧
"必须已挂载"）。
