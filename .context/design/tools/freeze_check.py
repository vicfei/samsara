#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Samsara 冻结检查器 —— v1.0 冻结门槛②（主文档附录 K.0.2 / K.9）

检查内容：
  [C2-可达]   每个常量的 authority 文档存在、章节存在，且不指向附录 K（过渡层）；
  [C2-字面量] authority 章节包含该常量值——经单位规范化（K.0.2/批次五 T1）：
              纯数字 / KB·MB·GB·k 后缀（1MB↔1048576、5k+↔5000）/
              百分比（0.95↔95%）/ 科学计数（10⁵↔100000）均视为同一字面量；
  [示意值]    authority 不在主文档的常量，若字面量出现在主文档，±2 行内应有
              「示意 | 权威 | 常量 | 注册表 | spec-constants」标记（WARN 级，冻结前清零）。

用法：python3 tools/freeze_check.py  （design/ 目录树内任意位置均可）
退出码：存在 FAIL → 1；仅 WARN → 0。仅依赖 Python 3 标准库。
本脚本与文档同库，自身为 R3 级资产，变更走 RFC。
"""
from __future__ import annotations

import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # design/

DOC_FILES = {
    "接口设计文档": "Samsara接口设计文档.md",
    "数据模型设计文档": "Samsara数据模型设计文档.md",
    "功能说明文档": "Samsara功能说明文档.md",
    "主文档": "Samsara自进化智能体-开发文档.md",
}
REGISTRY_PATH = ROOT / "spec-constants.yaml"

ALIAS_ORDER = ["接口设计文档", "数据模型设计文档", "功能说明文档", "主文档"]
MARKER = re.compile(r"示意|权威|常量|注册表|spec[-_]constants")
SUP = str.maketrans("0123456789", "⁰¹²³⁴⁵⁶⁷⁸⁹")
WS_COMMA = re.compile(r"[\s,，]+")


def norm(s: str) -> str:
    return WS_COMMA.sub("", s)


def canonical_forms(value) -> set:
    """值的所有可接受字面形式（K.0.2 单位规范化）。"""
    forms = set()
    if isinstance(value, str):
        return forms
    if isinstance(value, float) and not value.is_integer():
        forms.add(f"{value:g}")
        p = value * 100
        if 0 < value < 1 and abs(p - round(p)) < 1e-9:
            forms.add(f"{round(p):g}%")
        return forms
    v = int(value)
    forms.add(str(v))
    for suf, div in (("KB", 1024), ("MB", 1024 ** 2), ("GB", 1024 ** 3)):
        if v and v % div == 0:
            forms.add(f"{v // div}{suf}")
    if v and v % 1000 == 0:
        forms.add(f"{v // 1000}k")
    if v > 1:
        e = round(math.log10(v))
        if 10 ** e == v:
            forms.add("10" + str(e).translate(SUP))
    return forms


# ── 文档加载与章节索引 ──────────────────────────────────────────

def load_doc(path: Path):
    lines = path.read_text(encoding="utf-8").splitlines()
    marks = []
    in_fence = False
    for i, ln in enumerate(lines):
        if ln.lstrip().startswith("```") or ln.lstrip().startswith("~~~"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue  # 代码围栏内的 '#' 不是标题（如 SKILL.md 示例、yaml 注释）
        m = re.match(r"^(#{1,6})\s+(.+)$", ln)
        if m:
            marks.append((i, len(m.group(1)), m.group(2).strip()))
    sections = []
    for idx, (start, level, title) in enumerate(marks):
        end = len(lines)
        for j in range(idx + 1, len(marks)):
            if marks[j][1] <= level:
                end = marks[j][0]
                break
        sections.append({
            "level": level, "title": norm(title), "start": start, "end": end,
            "text": "\n".join(lines[start:end]),
        })
    return lines, sections


def find_section(sections, ref: str):
    refn = norm(ref)
    refn_np = refn[2:] if refn.startswith("附录") else refn
    for s in sections:
        if s["title"].startswith(refn) or s["title"].startswith(refn_np):
            return s
    return None


# ── spec-constants.yaml 极简解析（无第三方依赖）──────────────────

def _strip_comment(s: str) -> str:
    out, in_q = [], False
    for ch in s:
        if ch == '"':
            in_q = not in_q
        if ch == "#" and not in_q:
            break
        out.append(ch)
    return "".join(out).rstrip()  # 保留行首缩进（YAML 结构信息）


def parse_registry(path: Path):
    constants, cur, in_const = [], None, False
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = _strip_comment(raw)
        if not line:
            continue
        if re.match(r"^constants:\s*$", line):
            in_const = True
            continue
        if not in_const:
            continue
        m = re.match(r"^  ([A-Za-z0-9_]+):\s*$", line)
        if m:
            cur = {"id": m.group(1)}
            constants.append(cur)
            continue
        m = re.match(r"^    (value|authority|note):\s*(.*)$", line)
        if m and cur is not None:
            key, val = m.group(1), m.group(2).strip().strip('"')
            if key == "value":
                try:
                    cur["value"] = int(val)
                except ValueError:
                    try:
                        cur["value"] = float(val)
                    except ValueError:
                        cur["value"] = val
            else:
                cur[key] = val
    return constants


def parse_authority(s: str):
    """'接口设计文档 §3.4 mode.set' → ('接口设计文档', '3.4')；'主文档 附录 K.3' → ('主文档', '附录K.3')"""
    for alias in ALIAS_ORDER:
        if s.startswith(alias):
            rest = s[len(alias):].lstrip()
            m = re.match(r"(?:§\s*|附录\s*)([0-9A-Za-z][0-9A-Za-z.\-]*)", rest)
            if m:
                ref = m.group(1)
                if rest.startswith("附录"):
                    ref = "附录" + ref
                return alias, ref
            return alias, None
    return None, None


# ── 主流程 ──────────────────────────────────────────────────────

def main() -> int:
    fails, warns = [], []

    docs = {}
    for alias, fname in DOC_FILES.items():
        path = ROOT / fname
        if not path.exists():
            fails.append(f"[FAIL] 文档缺失: {fname}")
            continue
        docs[alias] = load_doc(path)

    if not REGISTRY_PATH.exists():
        print("[FAIL] spec-constants.yaml 缺失")
        return 1
    constants = parse_registry(REGISTRY_PATH)
    if not constants:
        print("[FAIL] spec-constants.yaml 解析结果为空（格式漂移？）")
        return 1

    main_lines, _main_sections = docs.get("主文档", ([], []))
    main_norm_lines = [norm(l) for l in main_lines]

    for c in constants:
        cid = c.get("id", "?")
        value = c.get("value")
        if not isinstance(value, (int, float)):
            fails.append(f"[FAIL] {cid}: value 非数值（{value!r}）")
            continue
        authority = c.get("authority", "")
        doc_alias, ref = parse_authority(authority)
        if doc_alias is None:
            fails.append(f"[FAIL] {cid}: authority 无法解析（{authority!r}）")
            continue
        if "附录K" in norm(ref or "") or re.search(r"附录\s*K", authority):
            fails.append(f"[FAIL] {cid}: authority 指向附录 K 过渡层（C2 禁指）: {authority}")
            continue
        if doc_alias not in docs:
            fails.append(f"[FAIL] {cid}: authority 文档未知（{doc_alias}）")
            continue
        if ref is None:
            fails.append(f"[FAIL] {cid}: authority 未给章节（{authority}）")
            continue
        _, sections = docs[doc_alias]
        sec = find_section(sections, ref)
        if sec is None:
            fails.append(f"[FAIL] {cid}: authority 章节不存在（{authority}）")
            continue
        forms = canonical_forms(value)
        secn = norm(sec["text"])
        if not any(f in secn for f in forms):
            fails.append(
                f"[FAIL] {cid}: authority 章节未包含字面量（规范化形式: {'/'.join(sorted(forms))}；authority: {authority}）")
            continue

        # 示意值纪律（WARN）：权威不在主文档的常量出现在主文档时，附近应有标记。
        # k 后缀形式（如 50k）歧义过高（示例值常用简写），不参与 WARN，仅参与权威侧字面量匹配。
        if doc_alias != "主文档":
            distinctive = [f for f in forms if len(f) >= 3 and not f.endswith("k")]
            for i, ln in enumerate(main_norm_lines):
                if any(f in ln for f in distinctive):
                    window = "\n".join(main_lines[max(0, i - 2): i + 3])
                    if not MARKER.search(window):
                        warns.append(
                            f"[WARN] 示意值: {cid}（{value}）出现于主文档 L{i + 1} 附近无标记: {main_lines[i][:60]}")

    print(f"spec-constants 常量总数: {len(constants)}")
    for w in warns:
        print(w)
    for f in fails:
        print(f)
    print(f"结果: {len(constants) - len(fails)}/{len(constants)} 通过；FAIL {len(fails)}，WARN {len(warns)}")
    if fails:
        print("冻结门槛②：未达标")
        return 1
    print("冻结门槛②：绿灯" + ("（存在 WARN，冻结前需清零）" if warns else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
