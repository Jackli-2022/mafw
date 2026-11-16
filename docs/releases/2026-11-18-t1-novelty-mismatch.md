# 2026-11-18 · T1 编码期 novelty / mismatch（E2 Phase 1）

- **分支**：`main`
- **实现 commits**：`b5e34729`（列 + merge upsert）→ `43f37233`（打分模块）→ `985c12dd`（管线/内核接线）→ `e31b9458`（stats）→ `80a4eeb5`（回填脚本）→ `12e83032`（boilerplate/序列化修复）→ `e19827dc`（阈值）→ `c954efb7`（mismatch 长度门）→ `510cd1c8`（同一记忆约束）→ `d7089872`（共享 lookup）
- **Minors commits**：`cd07a1ab`（host 插件结果序列化）→ `3081bee0`（scorer 工厂 + mismatch intent 门）→ `cd1783c3`（遥测排除）→ `81407c84` / `bce17bc2`（阈值重定）
- **设计**：`docs/superpowers/specs/2026-11-18-t1-novelty-mismatch-design.md`
- **计划**：`docs/superpowers/plans/2026-11-18-t1-novelty-mismatch.md`

## 交付

Phase 1 只测量，不改回放：`replayPriority` 仍用常数 `0.5`，反思顺序与 consolidation 不变。

- `t1_turn_features` 新增 `novelty` / `mismatch`（`REAL`，`null` = 未评分）。
- `upsertTurnFeature` 用 `COALESCE(excluded.x, x)` merge，重编码不会抹掉已有分数。
- 新模块 `gateway/src/recall/t1-signals.ts`：
  - `novelty = 1 − cos(content, best active cortex memory)`
  - `mismatch = cos(cue, M) − cos(content, M)`，只当 cue 与 content 补全到**同一条记忆** `M`、正文 ≥120 字符、`intent` ≥12 字符时计算（CA1 是一次检索的比较）。
  - 参照集过滤：`!superseded_by`、`type !== 'episodic'`、非本轮的派生记忆、`created_at <= turn.last_ts`。
- `TurnPipeline` 在 atoms 之后打分并二次写回 feature；`signalsFor` 抛错只丢信号。
- `stats.t1.signals`：`scored/unscored`、`novelty/mismatch` 的 p50/p90/p99/max、`highNovelty/highMismatch/redundant`。
- 回填脚本 `gateway/scripts/backfill-t1-signals.ts`（`--apply`、`--reset`，默认 dry-run）。

## 线上结果

回填（模型 `llamacpp:Qwen3-Embedding-0.6B.Q4_K_M.gguf`，minors 修复后）：

```json
{"features":4465,"eligible":4460,"scored":1223,"failed":0,"applied":1223,"writeFailed":0,
 "novelty":{"p50":0.318,"p90":0.400,"p99":0.463,"max":0.540},
 "mismatch":{"p50":0,"p90":0.023,"p99":0.106,"max":0.201}}
```

`/api/memory/stats`：

```json
{"scored":1223,"unscored":3245,
 "novelty":{"p50":0.318,"p90":0.400,"p99":0.463,"max":0.540},
 "mismatch":{"p50":0,"p90":0.023,"p99":0.106,"max":0.201},
 "highNovelty":124,"highMismatch":122,"redundant":123}
```

覆盖率 1,223 / 4,465 = **27.4%**。未评分的 3,245 条里大头是机器遥测（`【眼】` 感知日志）、agent 系统提示、短寒暄与历史 `[object Object]` 残留——这些不是可比较的人类经历。

阈值按实测分布取分位数（`config.recall.t1SignalThresholds`）：
`highNovelty 0.40`（≈p90）、`highMismatch 0.023`（≈p90）、`redundant 0.23`（≈p10）、`dup 0.95`（Phase 3 未启用）。

## Minors 修复（2026-11-19）

1. **kernel 接线可测**：抽出 `createTurnSignalScorer({ enabled, embedder, vectors, unitFor })`，kernel 只负责能力/配置装配；新增 3 个测试（禁用、启用、缺依赖时惰性），kernel 不再有自己的分支逻辑。
2. **`[object Object]` 源头**：host 插件 `toolResultText()` 把 `{content:[{type:'text',text}]}` 拼成文本，`executeTool` 与 `execute.after` 共用。上游不再写坏文本；历史残留由 `isInformativeTurn` 的包含判断挡掉。插件测试 35/35。
3. **遥测主导 novelty**：`【眼】` 前缀、正文含 `[object Object]`、非散文（字母/CJK 占比 < 35%）一律不评分。Top novelty 的 GUI 日志从 20/20 降到 0。代价：`scored` 从初版 2,315 降到 1,223，评的是“人类经历”而不是全部 T1 行。
4. **mismatch 降噪**：同一条记忆 + `intent ≥ 12 字符`；`ok` / `继续` / `nihao` 不再产生 mismatch。top mismatch 剩下的主要是 `<facts>` 块与结构化输出提示，仍属噪声。

## 审计（20 + 20）

- **novelty**：修复后 top 10 是真实的用户/agent 回合（论文问题、感知实验、`看看 c 盘下有什么文件`、调研请求），不再被感知日志占据。
- **mismatch**：仍有 `<facts>` 知识块、`Call the mafw_submit_result …` 这类结构化提示。它们“线索熟、正文不同”，符合公式字面，但对回放没有意义。
- 审计过程修掉的真实问题：
  1. 结构化 observation 被拼成 `[object Object]`（gateway 侧 `normalizeObservationText` + host 侧 `toolResultText`）。
  2. `You are a subagent …` / `[MAFW SYSTEM]` / `【眼】` 进入打分 → `isInformativeTurn` 过滤。
  3. cue/content 命中不同记忆却算差值 → 要求同一条记忆。
  4. 单词意图（`ok`、`继续`）制造 mismatch → intent 长度门。

## 代理效度（不通过）

标签：该轮产出的 unit（`source_trace_ids`）至少被检索过一次。过滤遥测后正例只剩 **21** 条：

```text
novelty   AUC 0.443
mismatch  AUC 0.580
```

mismatch 名义上过了 0.55，但 21 个正例不足以支撑任何结论；novelty 仍低于门槛。结论：**Phase 2 不启用**。标签本身很弱（检索事件覆盖窄），只能说明“没有证据支持采用”。

## 测试

新增 **29** 个测试（gateway 28 + host 插件 1）：

- `tests/unit/memory/t1-feature-signals.test.ts`（3）：roundtrip、merge 保留、显式覆盖。
- `tests/unit/recall/t1-signals.test.ts`（21）：复述/失配/无关、短轮、系统提示、遥测、`[object Object]`、superseded/episodic、未来记忆、空记忆池、embed 失败、clamp、同记忆约束、cortex lookup、scorer 工厂 3 例。
- `tests/unit/recall/turn-pipeline-signals.test.ts`（3）：写回、失败不阻塞、默认开启。
- `tests/unit/routes/memory-wiring.test.ts`（+1）：`t1.signals` 分布。
- `tests/plugin-v2.test.ts`（+1）：结构化 `content` parts 序列化。

门禁：

```text
gateway full     1005/1005 suites；8003 tests（8001 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
root tsc         rc=0
plugin tests     35/35
api contract     313/313
```

> 注：首轮全量曾出现 2 个失败，复跑为 0；期间其他会话在改 goal/plugin 文件，判定为并发编辑的瞬态。

## 回滚

- `recall.t1Signals = 'off'` → 不再打分；已有列与分数不影响任何读路径。
- `UPDATE t1_turn_features SET novelty = NULL, mismatch = NULL` 可清空；脚本可重放。

## 仍 deferred

- **mismatch 定义**：同记忆 + intent 门之后仍被 `<facts>` / 结构化提示污染，正例太少无法验证。保留字段但**禁止消费**；下一步换 episode 级 outcome 对比，或按 spec §9.5 记 null。
- **novelty 的语义效度**：遥测已排除，但它仍是“与皮层记忆的距离”，不等于“值得回放”；需要 episode 级验证集。
- **Phase 2/3**：回放/反思消费与 consolidation 去重预筛都未启用。
- **历史 `[object Object]` 行**：不再新增，旧行仍在 T1 里（不删原始数据）。
