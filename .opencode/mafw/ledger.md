# MAFW Ledger — 审计日志

> 记录所有工具调用、Δ 注入、降级事件、用户干预。

## 格式

```
[YYYY-MM-DD HH:MM:SS] [LEVEL] [CATEGORY] message
```

## 示例

```
[2026-06-21 15:00:00] [INFO] [LOOP] Started Loop 1 for goal=001-auth
[2026-06-21 15:05:00] [WARN] [REVIEW] Review failed: coverage 60 < 80
[2026-06-21 15:05:01] [INFO] [LESSON] Wrote lesson to lessons/001-auth.md
[2026-06-21 15:05:02] [INFO] [DELTA] Extracted delta review-coverage-v2
[2026-06-21 15:30:00] [INFO] [LOOP] Loop 2 started
[2026-06-21 15:50:00] [ERROR] [DEGRADE] L3 Circuit broken: delta=review-coverage-v2
```
