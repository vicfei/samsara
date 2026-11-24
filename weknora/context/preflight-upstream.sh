#!/usr/bin/env bash
# preflight-upstream.sh — 承诺点地面真值预检（commitment-point ground-truth check）
#
# 必跑时点（硬约束，缺一即违规）：
#   1. 创建任何工作分支之前
#   2. 每次 push 之前
#   3. 开 PR 之前
#   4. 开工实现之前（若距上次查重 > 2 小时）
#
# 用法: bash ~/WeKnora/.context/preflight-upstream.sh [目标issue号]
# 任何 ⚠️ 行出现 = 停手，先处理该事实，再继续动作。
#
# 源起：三次同族事故——
#   R72  fork main 误当 upstream（PR #5591 CI 红，A 案重做 E 案）
#   R79  rebase 冲突 --theirs 反噬（旧生成物覆盖上游新方案，双 CI 红）
#   R81  陈旧 remote-tracking 引用盲建分支（#5721 已合而不知，#5728 全天沉没）
# 共同根因：在承诺时刻依据陈旧状态决策。本脚本把"重新取真值"变成机械动作。

set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /home/ubuntu/WeKnora)"

ISSUE=${1:-}
WARN=0

# --- 1. 永远现场 fetch，绝不信任本地 remote-tracking 引用 ---
git fetch upstream main --quiet 2>/dev/null || { echo "⚠️ upstream fetch 失败——网络/远端问题，禁止在未知状态下行动"; exit 1; }
UPHEAD=$(git rev-parse --short upstream/main)
echo "upstream_head=$UPHEAD (fetched just now)"

# --- 2. 当前分支（或基准）与上游的漂移 ---
CURBRANCH=$(git branch --show-current)
if [ -n "$CURBRANCH" ] && [ "$CURBRANCH" != "main" ]; then
  BASE=$(git merge-base HEAD upstream/main)
  DRIFT=$(git rev-list --count ${BASE}..upstream/main)
  echo "branch=$CURBRANCH base_behind=$DRIFT"
  if [ "$DRIFT" -gt 0 ]; then
    echo "⚠️ 上游领先本分支 $DRIFT 个提交——push 前必须先 fetch 基线评估/rebase"
    OVERLAP=$(git diff --name-only "${BASE}..upstream/main" | sort -u > /tmp/pf-up-files
      git diff --name-only "${BASE}..HEAD" | sort -u | comm -12 - /tmp/pf-up-files | head -5)
    [ -z "$OVERLAP" ] || echo "⚠️ 与上游新提交文件重叠（冲突高危）: $OVERLAP"
    WARN=1
  fi
fi

# --- 3. 目标 issue 的竞争态（现场查，不用缓存） ---
if [ -n "$ISSUE" ]; then
  STATE=$(gh issue view "$ISSUE" --repo Tencent/WeKnora --json state --jq .state 2>/dev/null || echo unknown)
  PRS=$(gh api "repos/Tencent/WeKnora/issues/$ISSUE/timeline" --paginate \
    --jq '[.[] | select(.event=="cross-referenced") | select(.source.issue.pull_request != null) | "#\(.source.issue.number)(\(.source.issue.state))"] | join(" ")' 2>/dev/null)
  echo "issue_$ISSUE=$STATE competing_prs=${PRS:-none}"
  [ "$STATE" = "OPEN" ] || { echo "⚠️ 目标 issue 已非 OPEN——工作前提消失，停手确认"; WARN=1; }
  [ -z "$PRS" ] && echo "竞争面：干净" || { echo "⚠️ 存在竞争 PR——评估差异化或放弃，禁止盲发"; WARN=1; }
fi

# --- 4. 结论 ---
if [ "$WARN" -gt 0 ]; then
  echo "== 预检未过：处理完上述 ⚠️ 再行动 =="
  exit 2
fi
echo "== 预检通过 =="
