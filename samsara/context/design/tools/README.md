# design/tools — 文档治理工具

实现主文档附录 K.0.2（冻结检查器）与 K.9（门槛④断言）的"验证半边"。与文档同库，自身为 R3 级资产，变更走 RFC。

| 脚本 | 冻结门槛 | 职责 |
|---|---|---|
| `freeze_check.py` | ② | spec-constants ↔ 四文档一致性：authority 指针可达、字面量存在（单位规范化：`1MB↔1048576`、`5k+↔5000`、`0.95↔95%`、`10⁵↔100000`）、不指向附录 K；示意值标记纪律（WARN 级，冻结前清零） |
| `ledger_assert.py` | ④ | closure-ledger 逐条机检：written-back/verified 必须有 `assert` 字段（「文档§章节=关键词」，分号分隔），逐条验证；主文档版本行计数对账（L1 守卫） |

## 运行

```bash
cd design/
python3 tools/freeze_check.py && python3 tools/ledger_assert.py
```

两个脚本均零第三方依赖（Python 3 标准库）；任一 FAIL 退出码为 1，可直接接入 CI。

## assert 字段格式（账本条目）

```yaml
- {id: X, ruling: …, target: …, verify: …, status: written-back,
   assert: "接口§3.4=深度软限 3;数据模型§5=depth_approval_ref;tools=freeze_check.py"}
```

- `接口/数据模型/功能/主文档` + `§章节`（或 `附录K.6`、`C.2`、`H.6`、`F-05`、`B.0`、`D.1` 等标题引用）`=` 关键词；
- 省略章节 = 整篇文档检索；`spec-constants`/`closure-ledger` = 整文件检索；`tools` = 文件存在性；
- 关键词比对经空格/逗号归一（「硬顶 5」≡「硬顶5」）。

## 已知边界

- freeze_check 的示意值纪律只对"形态足够独特"的字面量（长度 ≥ 3）报 WARN，避免 30/4/3 这类短数字满屏误报；k 后缀形式（如 yaml 示例中的 `50k`）歧义过高，不参与 WARN，仅参与权威侧字面量匹配；
- markdown 代码围栏内的 `#` 不视为标题（SKILL.md/yaml 示例）；两脚本内置的极简 YAML 解析器只认当前文件格式，若注册表/账本改用块式 YAML 或引入 PyYAML，请同步更新解析器（变更走 RFC）。
