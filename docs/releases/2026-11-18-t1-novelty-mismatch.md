# 2026-11-18 · T1 编码期 novelty / mismatch（E2 Phase 1）

- **分支**：`main`
- **实现 commits**：`b5e34729`（列 + merge upsert）→ `43f37233`（打分模块）→ `985c12dd`（管线/内核接线）→ `e31b9458`（stats）→ `80a4eeb5`（回填脚本）→ `12e83032`（boilerplate/序列化修复）→ `e19827dc`（阈值）→ `c954efb7`（mismatch 长度门）→ `510cd1c8`（同一记忆约束）
- **设计**：`docs/superpowers/specs/2026-11-18-t1-novelty-mismatch-design.md`
- **计划**：`docs/superpowers/plans/2026-11-18-t1-novelty-mismatch.md`

## 交付

Phase 1 只测量，不改回放：`replayPriority` 仍用常数 `0.5`，反思顺序与 consolidation 不变。

- `t1_turn_features` 新增 `novelty` / `mismatch`（`REAL`，`null` = 未评分）。
- `upsertTurnFeature` 用 `COALESCE(excluded.x, x)` merge，重编码不会抹掉已有分数。
- 新模块 `gateway/src/recall/t1-signals.ts`：
  - `novelty = 1 − max cos(content, active cortex memory)`
  - `mismatch = max(0, cueSim − contentSim)`，且 cue 与 content 必须补全到**同一条记忆**（CA1：一次检索结果对输入的比较）。
  - 参照集过滤：`!superseded_by`、`type !== 'episodic'`、非本轮的派生记忆、`created_at <= turn.last_ts`。
- `TurnPipeline` 在 atoms 之后打分并二次写回 feature；`signalsFor` 抛错只丢信号。
- `stats.t1.signals`：`scored/unscored`、`novelty/mismatch` 的 p50/p90/p99/max、`highNovelty/highMismatch/redundant`。
- 回填脚本 `gateway/scripts/backfill-t1-signals.ts`（`--apply`、`--reset`，默认 dry-run）。

## 线上结果

回填（模型 `llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf`）：

```json
{"features":4462,"eligible":4457,"scored":2315,"failed":0,"applied":2315,"writeFailed":0,
 "novelty":{"p50":0.344,"p90":0.449,"p99":0.507,"max":0.554},
 "mismatch":{"p50":0,"p90":0.034,"p99":0.101,"max":0.201}}
```

`/api/memory/stats`：

```json
{"scored":2315,"unscored":2147,
 "novelty":{"p50":0.344,"p90":0.449,"p99":0.507,"max":0.554},
 "mismatch":{"p50":0,"p90":0.034,"p99":0.101,"max":0.201},
 "highNovelty":224,"highMismatch":40,"redundant":247}
```

覆盖率 2,315 / 4,462 = **51.9%**。未评分的 2,147 条主要是：没有可解释的记忆候选（早期仓库还没有对应皮层条目）、短寒暄、agent 系统提示。

阈值按实测分布取分位数（`config.recall.t1SignalThresholds`）：
`highNovelty 0.45`（≈p90）、`highMismatch 0.085`（初始 p90，同记忆约束后未再下调）、`redundant 0.25`（≈p10）、`dup 0.95`（Phase 3 未启用）。

## 审计（20 + 20）

- **Top novelty 被 GUI 感知日志占据**（`【眼】f#688 moved #661 [36, 950, …]`）：长、词面特殊、与皮层记忆距离远，但不是有意义的“新经历”。novelty 目前衡量的是**词面/格式的新颖度**，不是语义重要性。
- **Top mismatch 在修复后仍有噪声**：短请求（`看看 gage`、`创建一个临时文件`）、`<facts>` 块、以及上游写入的 `[object Object]` 文本。加“同一记忆 + 正文 ≥120 字符”约束后 p50 归零，信号变得稀疏。
- 修复的三处真实问题：
  1. 结构化 observation 被拼成 `[object Object]` → `normalizeObservationText` 序列化。
  2. `You are a subagent …` / `[MAFW SYSTEM]` 系统提示进入打分 → `isInformativeTurn` 过滤。
  3. cue/content 命中不同记忆却算差值 → 要求同一条记忆（新增回归测试，RED→GREEN）。

## 代理效度（不通过）

标签：该轮产出的 unit（`source_trace_ids`）至少被检索过一次。正例只有 **52** 条：

```text
novelty   AUC 0.318
mismatch  AUC 0.484
```

两者都 `< 0.55`，按设计门槛 **Phase 2 不启用**。标签本身很弱（检索事件覆盖窄），因此结论只能说明“没有证据支持采用”，不能证明信号永远无效。

## 测试

新增 **23** 个 gateway 测试：

- `tests/unit/memory/t1-feature-signals.test.ts`（3）：roundtrip、merge 保留、显式覆盖。
- `tests/unit/recall/t1-signals.test.ts`（16）：复述/失配/无关、短轮、系统提示、`[object Object]`、superseded/episodic、未来记忆、空记忆池、embed 失败、clamp、同记忆约束、cortex lookup。
- `tests/unit/recall/turn-pipeline-signals.test.ts`（3）：写回、失败不阻塞、默认开启。
- `tests/unit/routes/memory-wiring.test.ts`（+1）：`t1.signals` 分布。

门禁：

```text
gateway full     1001/1001 suites；7984 tests（7982 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
api contract     313/313
```

## 回滚

- `recall.t1Signals = 'off'` → 不再打分；已有列与分数不影响任何读路径。
- `UPDATE t1_turn_features SET novelty = NULL, mismatch = NULL` 可清空；脚本可重放。

## 仍 deferred

- **mismatch 定义**：同记忆约束后仍有短请求噪声，AUC 0.484。保留字段但**禁止消费**，下一步要么换定义（例如 episode 级 outcome 对比），要么按 spec §9.5 记 null。
- **novelty 的语义效度**：GUI 日志/机器输出主导高分；需要“信息量”门（例如按概念密度或 source 类型加权），否则回放优先会被日志吃掉。
- **Phase 2/3**：回放/反思消费与 consolidation 去重预筛都未启用，需先解决上面两条。
- **上游 `[object Object]` 写入**：不是本计划的路径，但会污染所有文本派生信号。
