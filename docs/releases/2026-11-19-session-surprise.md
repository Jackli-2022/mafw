# 2026-11-19 · T1 novelty v2：session 内相对 surprise（Phase 1）

- **分支**：`main`
- **实现 commits**：`1ba59195`（列 + merge）→ `4a0ff8f0`（打分）→ `6c156d96`（管线/内核接线）→ `380b20d8`（stats）→ `580d2132`（off-by-one 修复）→ `2bd085d3`（回填 + AUC）→ `ed6ce4b0`（阈值）
- **设计**：`docs/superpowers/specs/2026-11-19-session-surprise-design.md`
- **计划**：`docs/superpowers/plans/2026-11-19-session-surprise.md`
- **前置**：`docs/releases/2026-11-18-t1-novelty-mismatch.md`（global novelty AUC 0.43–0.48）

## 交付

Phase 1 只测量，不消费：

- `t1_turn_features.surprise`（`REAL`，`null` = 未评分），upsert `COALESCE` 保留。
- `surprise = 1 − cos(本轮正文, 同 session 紧邻上一轮正文)`；任一轮不满足 `isInformativeTurn`、没有上一轮、embed 失败 → `null`。
- `TurnPipeline` 通过 `getPrevTurnTrace` 取上一轮 trace，`readTrace` 取文本；失败只丢信号。
- `stats.t1.signals` 新增 `surprise` 分位数、`surpriseScored`、`highSurprise`。
- 回填脚本同时写 `surprise`，输出两个标签下的 AUC 对比。

## 线上结果

```json
{"features":4482,"eligible":4477,"informative":1107,"scored":1104,"surpriseScored":535,
 "surprise":{"p50":0.462,"p90":0.657,"p99":0.762,"max":0.865}}
```

`/api/memory/stats`：

```json
{"scored":1104,"surpriseScored":535,"highSurprise":54,
 "surprise":{"p50":0.462,"p90":0.657,"p99":0.762,"max":0.865}}
```

`surprise` 覆盖 535 / 1,104 个已评分回合（其余没有上一轮或任一轮被判非 cue）。阈值 `highSurprise 0.657`（≈p90）。

## 效度对比（同子集）

| 标签 | 正例 | novelty | mismatch | **surprise** |
|---|---|---|---|---|
| A：该轮产出的 unit 存在 | 79 | 0.444 | 0.559 | **0.595** |
| B：该轮产出的 unit 被检索过 | 22 | 0.439 | 0.583 | **0.530** |

## 审计：优势来自短指令轮

top 12 surprise 全是短命令：`修` → `继续`、`动手` → `提交`、`测试再改`、`确认`、`可以`、`没问题`。
它们与上一轮词面差异大，但不是“值得记住的新信息”。

把两边 `intent` 都要求 ≥12 字符后：只剩 **129** 个回合、**9** 个正例，AUC 降到 **0.523**。
也就是说 0.595 的优势由短命令轮驱动，不是由实质性工作驱动。

## 决定

**Phase 2 不启用**。门槛是 `AUC ≥ 0.60` 且正例 ≥ 100；当前 0.595 且 79 个正例，实质子集更低。
`surprise` 字段保留为 shadow 数据，供后续更大验证集使用；回放/反思/consolidation 均未改变。

## 测试

新增 **9** 个测试：

- `tests/unit/memory/t1-feature-signals.test.ts`（+1）：roundtrip + merge 保留。
- `tests/unit/recall/t1-signals.test.ts`（+6）：相同/不同相邻轮、无上一轮、上一轮非 cue、embed 失败、clamp、禁用。
- `tests/unit/recall/turn-pipeline-signals.test.ts`（+2）：写回上一轮 surprise；失败不阻塞。

门禁：

```text
gateway full     1009/1009 suites；8024 tests（8022 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
api contract     313/313
```

## 修复的真 bug

`getPrevTurnTrace` 最初查的是当前轮（`turn_seq = ?`），导致 `prevText === text`、surprise 恒为 0。
测试原本用两条都含 "reflection" 的文本没抓住；改成“上一轮含 reflection、当前轮不含”后 RED→GREEN，修复见 `580d2132`。

## 回滚

- `recall.t1Surprise = 'off'` → 不再计算；列与历史值不影响读路径。
- `UPDATE t1_turn_features SET surprise = NULL` 清空；脚本可重放。

## 仍 deferred

- **验证集**：正例只有 79（实质子集 9），任何 AUC 都缺置信度；需要更宽或人工标注的“值得记住”标签。
- **信号定义**：若继续，应比较 **intent/cue** 而不是整轮正文（工具输出会把短命令抬成高 surprise），但那需要重新测量。
- **Phase 2/3**：均未启用。
