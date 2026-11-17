# T1 novelty v2：session 内相对 surprise 设计

- **状态**：待批准
- **日期**：2026-11-19
- **前置**：`2026-11-18-t1-novelty-mismatch-design.md`（E2 Phase 1）
- **证据**：`docs/releases/2026-11-18-t1-novelty-mismatch.md` §后续测量

## 1. 为什么

E2 的 `novelty = 1 − cos(本轮, 皮层记忆)` 在两个标签下 AUC 0.429 / 0.484，低于随机有效线。
同一批 553 个“有上一轮”的回合上，`1 − cos(本轮, 上一轮)` 的 AUC 是 **0.584**（36 正例），
而 global novelty 在同一子集是 0.484。

结论：预测“值得记住”的不是“离已有知识有多远”，而是**这一轮相对上一轮改变了多少**（session 内预测误差）。
这正是海马 RPE 的形式：比较的是预测与实际输入，而不是与整个皮层比距离。

## 2. 目标与非目标

**目标**

- 新增逐轮 `surprise`（session 内相对 surprise），与 `novelty` 并存，可对照。
- 在编码管线里计算、持久化、出分布，默认**不消费**。
- 回填历史并给出与 global novelty 的同子集 AUC 对比。

**非目标**

- 不改 `novelty` / `mismatch` 的定义或数值。
- 不用 surprise 做 episode 边界（分段仍是声明 + 推断）。
- 不做 episode 级 outcome 对比（缺 outcome 极性，见 E2 记录）。
- 不接回放/反思（Phase 2 仍需单独确认）。
- 不新增 HTTP 路由。

## 3. 定义

对同一 session 的相邻两轮 `t-1`、`t`：

```
surprise(t) = clamp(1 − cos(content_t, content_{t−1}), 0, 1)
```

- `content` = 整轮文本，`normalizeObservationText`；同一 embedder，`document` kind。
- 只比较**同 session 的紧邻上一轮**；不跨 session、不跨 turn 间隔。
- 当前轮或上一轮不满足 `isInformativeTurn` → `null`（不评分）。
- 没有上一轮（session 首轮 / 上一轮无 trace）→ `null`。
- embed 失败 → `null`，不阻塞归档。

注意：`surprise` 高不等于“重要”，它衡量的是**变化量**；与 `mismatch`（cue/content 同记忆差）正交。

## 4. 与现有字段的关系

| 字段 | 参照 | 语义 | 消费 |
|---|---|---|---|
| `novelty` | 全部 active 皮层记忆 | 与已知知识的距离 | 无 |
| `mismatch` | 最近的单条记忆 | 线索熟、正文不同 | 无 |
| `surprise`（新） | 同 session 上一轮 | 相对上一轮的变化 | 无 |

三者都只是排序信号；Phase 1 不改任何行为。

## 5. 计算位置

- `gateway/src/recall/t1-signals.ts` 新增：
  - `scoreSurprise(cosine: number | null): number | null`
  - `computeTurnSurprise(inputs, deps)`：输入 `{ traceId, text, prevText?, prevTraceId? }`；
    对 `prevText` 与 `text` 各 embed 一次（批量），返回 `Map<traceId, number>`。
  - 复用 `isInformativeTurn`、`normalizeObservationText`。
- `turn-pipeline.ts`：在现有 signals 之后，另取本批每轮的上一轮 trace（`t1_turns` 的 `turn_seq - 1`），
  `readTrace` 取文本；批量算 `surprise`，二次 upsert 回 feature。失败只丢信号。
- kernel：`surpriseFor` 选项，接线同 `signalsFor`（能力/配置门）。
- 配置：`recall.t1Surprise: 'on' | 'off'`（默认 `on`，只计算）。

## 6. 存储

```sql
ALTER TABLE t1_turn_features ADD COLUMN surprise REAL;   -- null = 未评分
```

- 只存标量；`upsertTurnFeature` 用 `COALESCE(excluded.surprise, surprise)` 保留。
- `stats.t1.signals.surprise`：`{p50,p90,p99,max}` + `highSurprise`（阈值从回填 p90 取）。
- `unscored` 仍按 `novelty IS NULL` 计（保持现有语义），另加 `surpriseScored`。

## 7. 验证与门槛

1. 回填全部有 feature 的回合，报告 `surprise` 覆盖与分布。
2. 同子集对比（有上一轮的回合）：
   - 标签 A：该轮产出的 unit 存在（`source_trace_ids` 命中）。
   - 标签 B：该轮产出的 unit 被检索过（现有 `t1_retrieval_events`）。
   - 报告 `novelty` / `surprise` / `mismatch` 的 AUC。
3. **只有同时满足** `AUC ≥ 0.60` 且正例 `≥ 100`，才提出 Phase 2（回放/反思消费）。
   当前正例约 36–74，因此本设计预期停在 Phase 1。
4. 人工审计 top 20 surprise：是否真的“相对上一轮有实质变化”，而不是换行/工具输出差异。

## 8. 风险

- **长间隔**：上一轮可能在数小时前，`surprise` 会高但语义上是“重新开始”。Phase 1 记录分布；若审计显示问题，再加 gap 门（>6h → null）。
- **上一轮是工具输出**：会抬高 surprise。`isInformativeTurn` 只挡遥测/系统提示，挡不住普通工具输出；审计里单独看。
- **覆盖率**：只有约一半回合有上一轮，`surprise` 天然比 `novelty` 稀疏。
- **换 embedder**：与 E2 相同，换模型必须重跑回填。

## 9. 回滚

- `recall.t1Surprise = 'off'` → 不再计算；列与历史值不影响任何读路径。
- `UPDATE t1_turn_features SET surprise = NULL` 清空；脚本可重放。

## 10. 验收标准

- 纯函数测试：同文本 → 0；不同文本 → >0；无上一轮 → null；任一轮不满足信息门 → null；embed 失败 → 空 Map。
- 管线测试：写入 `surprise`；缺上一轮时保持 null；失败不阻塞归档；重编码保留已有值。
- `stats.t1.signals.surprise` 与 `surpriseScored` 有测试。
- 回填 dry-run / apply 0 失败；线上 stats 与 dry-run 一致。
- 全量 gateway suite、tsc、build 绿。
- 报告同子集 AUC 与 top 20 审计；未达门槛时明确写“Phase 2 不启用”。
