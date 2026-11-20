#!/bin/bash
# 显式红绿把关:全 pass 才 exit 0(绝不依赖 shell 链的退出码语义)
PR=$1
for i in $(seq 1 12); do
  sleep 20
  out=$(gh pr checks "$PR" 2>&1)
  pass=$(echo "$out" | grep -c "	pass	")
  fail=$(echo "$out" | grep -c "	fail	")
  pending=$(echo "$out" | grep -c "pending")
  echo "poll: pass=$pass fail=$fail pending=$pending"
  if [ "$fail" -gt 0 ]; then echo "VERDICT: RED"; exit 1; fi
  if [ "$pass" -ge 2 ] && [ "$pending" -eq 0 ]; then echo "VERDICT: GREEN"; exit 0; fi
done
echo "VERDICT: TIMEOUT"; exit 1
