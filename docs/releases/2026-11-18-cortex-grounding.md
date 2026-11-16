# 2026-11-18 · 皮层接地（T1 episode ↔ Harmonic）

- **分支**：`main`
- **实现 commits**：`1daee7df`（helper）… `7aa5c128`（backfill）
- **设计**：`docs/superpowers/specs/2026-11-18-cortex-grounding-design.md`
- **计划**：`docs/superpowers/plans/2026-11-18-cortex-grounding.md`

## 问题

T1 已经是可用的海马体闭环，但皮层条目几乎指不回去：

- 审计时索引有 17,559 条（其中约 1,300 条是历史重复；去重后真实 16,251 条），只有 701 条有精确 `source_trace_ids`（4.3%）；
- **0 条**有 `episode_id`；
- reflection 明明知道处理的是哪个 episode，却没有把链接写进 unit；
- `mafw_add_memory`（MCP）也不派生 episode；
- 更隐蔽的是：`HarmonicIndexManager.addEntry` 的字段白名单会**静默丢掉** `episode_id`，即使 OKF frontmatter 有，索引里也看不到。

## 交付

- `deriveEpisodeId(lookup, traceIds)`：取第一条可解析 trace 的 episode；查不到/抛错返回 `null`（fail-open）。
- reflection：从本批 episode 建 `trace → episode` 映射，insight 写入 `episode_id`；无 trace 时回退到本批最后一个 episode。
- MCP `mafw_add_memory` + HTTP `/api/memory/add`：同一 helper，服务端派生，客户端不能设置。
- consolidation merge：`incoming.episode_id ?? target.episode_id`，更新不丢链接。
- `addEntry`：补上 `episode_id` 白名单透传（本次修复的关键 bug）。
- `/api/memory/stats.t1.provenance`：新增 `withEpisode` / `episodeCoverage`。
- `mafw_get_memory`：返回的 `memory` 已带 `episode_id`；OKF round-trip 测试钉住。
- 一次性回填脚本：`gateway/scripts/backfill-cortex-grounding.ts`（默认 dry-run，`--apply` 才写）。

## 线上回填

回填前 dry-run：

```json
{"total":17585,"candidates":715,"resolved":715,"unresolved":0,"ungrounded":16870}
```

`--apply` 结果：**715 条写入，0 失败**。

但回填暴露了一个更深的索引 bug：`HarmonicIndexManager.addEntry` 对已存在的 id 是 **append** 而不是 upsert。715 次回填把条目复制成 18,300 条（`withExact` 从 715 涨到 1,430）。进一步去重发现索引里原本就有 **1,334 条历史重复**（正常 update/merge 也会触发）。

- 修复：`addEntry` 按 id upsert（新增 RED→GREEN 测试）。
- 第二层修复：upsert 若直接替换 entry 会丢掉 index 既有字段（`last_decay_at` 等）；改为 merge spread，并从备份恢复 **464 条**被回填覆盖的衰减基线（新增测试）。
- 一次性去重：18,300 → **16,251** 条唯一 unit（移除 2,049 条重复）。
- 去重后 `withEpisode = 701`、`episodeCoverage = 4.31%`；14 条被回填的 unit 在去重前已因 supersede/清理不在索引里。
- 结论：之前 stats 的 17,559 条高估了约 1,300 条；真实皮层 unit 数是 **16,251**。

## 测试

新增 **13** 个 gateway 测试：

- `deriveEpisodeId`：首条命中、空输入、查不到、抛错、去重
- reflection：insight 的 OKF frontmatter 带 `episode_id`
- MCP add-memory：有可解析 trace 时带 episode；无 episode 时保持 absent
- OKF：`episode_id` round-trip；index 白名单不再丢字段；重写不重复；重写保留 `last_decay_at` 等既有字段
- stats：`withEpisode` / `episodeCoverage`
- backfill planner：可回填 / unresolved / ungrounded / 已接地跳过

门禁：

```text
gateway full     986/986 suites；7884 tests（7882 passed，2 skipped，0 failed）
gateway tsc      rc=0
gateway build    rc=0
sdk build        rc=0
sdk tests        242/242
api contract     320/320
```

> 注：执行期间另一会话在 `gateway/src/kernel.ts` 留有未提交 WIP（`outcome.lastError`），曾短暂阻塞全局 tsc/build；对方提交后重跑，tsc/build/全量均通过。本计划未修改其文件。

## 回滚

- 删除 OKF frontmatter 的 `episode_id` 并重建索引即可；无 schema 变更。
- `episode_id` 只是软提示：检索/召回不依赖它，缺失时行为与之前一致。

## 已知限制

- 15,550 条无 trace 的旧 unit 仍未接地；不做 session/time 猜测。
- 一个 unit 可能来自多个 episode，字段只存一个软提示（首条可解析 trace）。
- 去重后仍有 1,998 条 legacy episodic、5,025 条 superseded（读时过滤）；属于 E3 卫生计划。
- 真正提升召回还需要 E2 的 novelty/mismatch 和 E4 的 surprise 驱动 replay。
