# Consolidation 零 UPDATE 审计（2026-09-29 初判）

> Plan B Task 2 交付物。判定对日志（`~/.mafw/logs/consolidation-pairs.jsonl`）已随 B-Task1 上线，
> 但需要生产流量积累——本文件为**初判**，pair 数据攒够后（≥50 判定或 ≥3 天）补终判。

## 现场证据（2026-09-29）

| 信号 | 数值 | 来源 |
|---|---|---|
| consolidation 判定计数 | judged 62 / updates **0** / creates 60 / skipped 14 | `/api/memory/stats`（跨重启持久化） |
| MinHash 合并活动 | **0 行**（当前日志窗口 09-28 起） | `~/.mafw/logs/mafw.log` grep |
| consolidation merge 行 | 0 行（`merged ... (cosine candidate)` 从未出现） | 同上 |
| 向量池（llamacpp 文件） | 6248 向量中 **133 条已 superseded** + **2311 条不在索引**（孤儿） | 现场脚本比对 |
| 索引 | 3944 entries，137 superseded | 同上 |

## 三预设假设 + 新 H4 的初判

| 假设 | 判据 | 初判 |
|---|---|---|
| **H1 MinHash 抢先合并** | MinHash 合并计数 ≥ 判定候选数 | **弱**——当前窗口零 MinHash 活动，无从"抢先" |
| **H2 判官 CREATE 偏置** | pair 样本人工抽查：语义上应 UPDATE 的被判 create | **最可能但未证实**——62 次 100% create 的分布形态可疑；需 pair 数据（判定对 jsonl）抽查 ≥10 对 |
| **H3 cosine 0.8 过高** | cosine 直方图集中 0.72-0.80 | **否**——62 次 judged 说明 ≥0.8 的候选大量存在，阈值没有挡住任何人 |
| **H4 候选池含死条目**（审计新发现） | 向量池中 superseded/孤儿占比 | **部分证实**——133 条已废弃 + 2311 条孤儿向量仍在池里；但仅占 2%，**不足以单独解释 0/62** |

## 已执行的修复（本次随审计落地）

1. **候选池过滤**（`consolidation-service.ts`）：判官前过滤 superseded 与孤儿候选——合并进死条目会复活它。TDD 三例钉住（`consolidation-pairs.test.ts`）。
2. **向量池清理脚本**（`gateway/scripts/prune-vectors.ts`）：删除已废弃/孤儿向量，dry-run 默认（对齐 harvest-cue-anchors 约定）。双份文件（llamacpp 6248 + onnx 2709）均处理。

## 待办（终判条件）

- [ ] pair jsonl 攒到 ≥50 判定后：verdict 分布 + cosine 直方图 + 抽 10 对人工判（H2 确认/否决）
- [ ] 若 H2 证实 → 修 `JUDGE_SYSTEM` prompt（UPDATE 判据前置 + 1-shot 示例）
- [ ] 若 H2 否决（候选确实都是 SEPARATE/CREATE）→ **健康带重定义**：update ratio 现行 16-22% 目标对个人库（写入量低、主题分散）不适用，改按"合并数/周"监控，AGENTS §3.5 同步
- [ ] 健康带重算时把 MinHash merges 与 consolidation updates 合并计（两个合并面）

## 附注

- 日志窗口内 ConsolidationService 被反复 re-enable（09-28 一晚 8 次）——config watcher 重建 embedding 服务的频率偏高，与本审计无关但值得单独看一眼（rebuild 是否丢 pending 状态）。
