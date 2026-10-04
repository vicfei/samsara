#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Samsara 收敛账本断言器 —— v1.0 冻结门槛④（主文档附录 K.9 / C3 / 批次五 T2）

检查内容：
  1. 账本条目 status ∈ {designed, written-back, verified}；
  2. written-back / verified 条目必须携带 assert 字段（机检断言）；
  3. assert 逐条机检——格式「文档§章节=关键词」，分号分隔：
       - md 文档（接口/数据模型/功能/主文档）：章节存在 且 章节文本含关键词（空格归一比对）；
       - 无章节（如「接口=关键词」）：整篇文档含关键词；
       - spec-constants / closure-ledger：整文件含关键词；
       - tools：design/tools/<关键词> 文件存在；
  4. 主文档版本行计数对账（L1 持续守卫）：「账本 N 条，X written-back / [Y verified /] Z designed」
     必须与账本实际计数一致。

用法：python3 tools/ledger_assert.py  （design/ 目录树内任意位置均可）
退出码：存在 FAIL → 1。仅依赖 Python 3 标准库。
本脚本与文档同库，自身为 R3 级资产，变更走 RFC。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # design/

from freeze_check import DOC_FILES, load_doc, find_section, norm  # noqa: E402

LEDGER_PATH = ROOT / "closure-ledger.yaml"
TOOLS_DIR = ROOT / "tools"
FLAT_DOCS = {
    "spec-constants": ROOT / "spec-constants.yaml",
    "closure-ledger": LEDGER_PATH,
}
DOC_ALIASES = {
    "接口": "接口设计文档",
    "数据模型": "数据模型设计文档",
    "功能": "功能说明文档",
    "主文档": "主文档",
}
ITEM_KEYS = ("id", "ruling", "target", "verify", "status", "assert")
VALID_STATUS = {"designed", "written-back", "verified"}


def parse_items(text: str):
    items = []
    for raw in text.splitlines():
        m = re.match(r"^\s*-\s*\{(.*)\}\s*$", raw)
        if not m:
            continue
        parts = re.split(r",\s*(?=(?:id|ruling|target|verify|status|assert):)", m.group(1))
        item = {}
        for p in parts:
            k, _, v = p.partition(":")
            k, v = k.strip(), v.strip()
            if len(v) >= 2 and v[0] == v[-1] == '"':
                v = v[1:-1]
            item[k] = v
        if "id" in item:
            items.append(item)
    return items


def parse_claim(claim: str):
    """「主文档§12=关键词」→ (doc_key, ref, keyword)；「tools=x.py」→ ('tools', None, 'x.py')"""
    left, sep, keyword = claim.partition("=")
    if not sep:
        return None, None, None
    left, keyword = left.strip(), keyword.strip()
    if left in FLAT_DOCS or left == "tools":
        return left, None, keyword
    for alias, full in DOC_ALIASES.items():
        if left.startswith(alias):
            ref = left[len(alias):].lstrip()
            if ref.startswith("§"):
                ref = ref[1:]
            return full, (ref or None), keyword
    return None, None, None


def main() -> int:
    fails = []
    if not LEDGER_PATH.exists():
        print("[FAIL] closure-ledger.yaml 缺失")
        return 1
    ledger_text = LEDGER_PATH.read_text(encoding="utf-8")
    items = parse_items(ledger_text)
    if not items:
        print("[FAIL] closure-ledger.yaml 解析结果为空（格式漂移？）")
        return 1

    # 文档索引
    docs = {}
    for alias, fname in DOC_FILES.items():
        path = ROOT / fname
        if not path.exists():
            fails.append(f"[FAIL] 文档缺失: {fname}")
            continue
        lines, sections = load_doc(path)
        docs[alias] = {"lines": lines, "sections": sections,
                       "whole": norm("\n".join(lines))}

    counts = {"designed": 0, "written-back": 0, "verified": 0}
    for it in items:
        iid = it.get("id", "?")
        status = it.get("status", "")
        if status not in VALID_STATUS:
            fails.append(f"[FAIL] {iid}: 非法 status（{status!r}）")
            continue
        counts[status] += 1
        if status == "designed":
            continue
        claims_raw = it.get("assert", "").strip()
        if not claims_raw:
            fails.append(f"[FAIL] {iid}: status={status} 但缺少 assert 字段（门槛④要求）")
            continue
        for claim in claims_raw.split(";"):
            claim = claim.strip()
            if not claim:
                continue
            doc_key, ref, keyword = parse_claim(claim)
            if doc_key is None:
                fails.append(f"[FAIL] {iid}: assert 无法解析（{claim!r}）")
                continue
            kw = norm(keyword)
            if doc_key == "tools":
                if not (TOOLS_DIR / keyword).exists():
                    fails.append(f"[FAIL] {iid}: tools 文件不存在（{claim}）")
                continue
            if doc_key in FLAT_DOCS:
                if kw not in norm(FLAT_DOCS[doc_key].read_text(encoding="utf-8")):
                    fails.append(f"[FAIL] {iid}: 断言不成立（{claim}）")
                continue
            if doc_key not in docs:
                fails.append(f"[FAIL] {iid}: assert 文档未知（{claim}）")
                continue
            d = docs[doc_key]
            if ref is None:
                if kw not in d["whole"]:
                    fails.append(f"[FAIL] {iid}: 断言不成立（{claim}）")
                continue
            sec = find_section(d["sections"], ref)
            if sec is None:
                fails.append(f"[FAIL] {iid}: assert 章节不存在（{claim}）")
            elif kw not in norm(sec["text"]):
                fails.append(f"[FAIL] {iid}: assert 关键词不在章节内（{claim}）")

    # 主文档版本行计数对账（L1 守卫）
    ver_text = "\n".join(docs["主文档"]["lines"][:6]) if "主文档" in docs else ""
    m = re.search(
        r"账本\s*(\d+)\s*条[^\n]*?(\d+)\s*written-back\s*(?:/\s*(\d+)\s*verified\s*)?/\s*(\d+)\s*designed",
        ver_text)
    total = sum(counts.values())
    if not m:
        fails.append(f"[FAIL] 主文档版本行未找到账本计数（L1 对账失败）；账本实际: {total} 条 = "
                     f"{counts['written-back']} written-back / {counts['verified']} verified / {counts['designed']} designed")
    else:
        claimed = (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0), int(m.group(4)))
        actual = (total, counts["written-back"], counts["verified"], counts["designed"])
        if claimed != actual:
            fails.append(f"[FAIL] 主文档版本行计数 {claimed} ≠ 账本实际 {actual}（L1 对账失败）")

    for f in fails:
        print(f)
    print(f"账本条目: {total} = {counts['written-back']} written-back / "
          f"{counts['verified']} verified / {counts['designed']} designed")
    print(f"结果: FAIL {len(fails)}")
    if fails:
        print("冻结门槛④：未达标")
        return 1
    print("冻结门槛④：绿灯")
    return 0


if __name__ == "__main__":
    sys.exit(main())
