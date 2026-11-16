# 2026-11-18 · 皮层接地 minors（P1–P5）

- **分支**：`main`
- **实现 commits**：`6c6721c8`（cortex 构成）→ `d27454da`（批量索引写）→ `123127e9`（`episode_hint` 类型/持久化/schema）→ `47027f5b`（hint 规划器）→ `66717ae2`（系统提示过滤 + 回填脚本）
- **设计**：`docs/superpowers/specs/2026-11-18-cortex-grounding-design.md`（决策 4：不猜，hint 与 `episode_id` 分离）
- **计划**：`docs/superpowers/plans/2026-11-18-cortex-grounding-minors.md`
- **前置记录**：`docs/releases/2026-11-18-cortex-grounding.md`

## 交付

### P1 皮层构成 stats

`/api/memory/stats.t1.cortex`：

```json
{ "total": 16267, "active": 9861, "legacyEpisodic": 1998, "superseded": 5077, "exactGrounding": 702, "hintGrounding": 2185 }
```

- `active` = `!superseded_by && type !== 'episodic'`
- `legacyEpisodic` = `type === 'episodic'`（两层分离后不再新写，但存量可读）
- `superseded` = 有 `superseded_by`（读时过滤）
- `exactGrounding` / `hintGrounding` = 有 `episode_id` / `episode_hint`

### P2 批量索引写

`HarmonicIndexManager.addEntry(unit, tier, { save?: boolean })` 与 `HarmonicUnitFileStore.write(unit, tier?, { save?: boolean })`：`save:false` 只改内存索引，调用方每 500 条 `save()` 一次。默认仍立即落盘，存量调用方行为不变。

### P3 `episode_hint` 类型与持久化

```ts
type EpisodeHintBasis = 'session_single' | 'session_latest_after';
interface EpisodeHint { episodeId: string; basis: EpisodeHintBasis; confidence: number }
```

- 写入 `HarmonicUnit` / `HarmonicIndexEntry`、OKF frontmatter、`HarmonicUnitSchema`（openapi 已重生成）。
- 语义：**shadow-only 软提示**，永不覆盖 `episode_id`，检索侧当前不消费。
- `memory.search` 的 `MemoryUnitSchema` 未透出 hint（保持对外契约不变）。

### P4 hint 规划器

`planEpisodeHints(entries, episodesBySession)`（`gateway/src/memory/cortex-grounding.ts`）：

| 情形 | 结果 |
|---|---|
| 已有 `episode_id` / `episode_hint` | `skippedExisting` |
| 无 `source_session_id` | `noSession` |
| session 无 episode | `noEpisode` |
| 单 episode | `session_single`，confidence 0.8 |
| 多 episode 且 `created_at >= 最新 episode.endedAt` | `session_latest_after`，confidence 0.6 |
| 时间非法 / 早于最新 episode | `ambiguous`（不猜） |
| episode 的 intent 是系统提示或过短 | `unusable` |

`isUsableEpisodeIntent` 过滤：`You are a subagent spawned…` / `another session` / `system prompt` / `^instructions` / `^[MAFW SYSTEM]` / 长度 < 3。

### P5 线上回填

`gateway/scripts/backfill-cortex-hints.ts`（默认 dry-run；`--apply`；`--reset` 先清旧 hint 再重放）：

```json
{"reset":true,"removed":2188}
{"dryRun":false,"total":16266,"sessions":1583,"candidates":2185,"skippedExisting":702,
 "noSession":504,"noEpisode":4569,"ambiguous":3449,"unusable":4857,"applied":2185,"failed":0}
```

覆盖率：**2,185 / 16,267 = 13.4%**（精确 702 另计，hint 只覆盖无 trace 的存量）。

## Hint 语义审计

第一版回填 6,939 条；抽样 20 条发现 `session_single` 里大量 episode 的 intent 是 subagent 系统提示（`You are a subagent spawned by another session.`），链接在结构上成立、语义上无信息，因此加了 `isUsableEpisodeIntent` 并 `--reset` 重放，降到 **2,185**。

过滤后全量校验（遍历所有 hint，不抽样）：

```json
{"hinted":2185,"counts":{"session_single":306,"session_latest_after":1879},"missing":0,"unusable":0,"trivial":0}
```

- `missing: 0`：每个 hint 都能在 `t1_episodes` 找到对应 episode。
- `unusable: 0` / `trivial: 0`：没有指向系统提示或超短 intent 的 hint。
- `session_single` 的 306 条里仍有 intent 为空或语义偏松的 episode（如「先记下来，然后继续呈现…」通用开场），confidence 0.8 偏高；因为 shadow-only、不参与排序，先按 0.6 级别的实际价值看待。
- `session_latest_after` 用 unit 的写入时间对比 episode 结束时间，只证明「写于该 episode 之后」，不证明「来自该 episode」。

## 测试

新增 **8** 个 gateway 测试：

- `tests/unit/memory/harmonic-index-batch.test.ts`（2）：`save:false` 延迟写、`store.write` 透传。
- `tests/unit/memory/okf-provenance.test.ts`（+1）：`episode_hint` frontmatter/index roundtrip。
- `tests/unit/memory/cortex-hints.test.ts`（5）：单 episode、多 episode 时间判定、跳过已有/无 session/无 episode、非法时间不猜、系统提示与超短 intent 过滤。
- `tests/unit/routes/memory-wiring.test.ts`：扩展 `t1.cortex` 断言（未新增用例）。

门禁：

```text
gateway full     988/988 suites；7892 tests（7890 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
api contract     320/320
sdk build        rc=0（openapi / api-schema 已重生成）
```

## 回滚

- 删除索引/OKF 里的 `episode_hint` 即可，`episode_id`、检索、schema 行为都不依赖它。
- `save:false` 是 opt-in，回滚批量写不影响既有调用方。
- `t1.cortex` 是只读统计，无写路径。

## 仍 deferred

- **P6 `episode_ids` 多值**：一个 unit 可能来自多个 episode，目前只存单个软提示。
- **legacy episodic 物理归档**：1,998 条仍留在索引里，只靠读时过滤；未做独立归档目录。
- **hint 进入检索**：当前 shadow-only；要用它做召回/重排，需要先有离线命中率评估（`session_latest_after` 的语义强度尚不足以直接上排序）。
