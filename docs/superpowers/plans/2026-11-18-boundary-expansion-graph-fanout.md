# Boundary Expansion Graph Fan-out Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 secondary query-expansion pass 中重复的图扩展 SQL，同时保留基础 BM25 pass 的图召回与全部质量门。

**Architecture:** 在 boundary recall 的 SearchRecallOptions 中透传既有 `graphExpand` 开关；仅 entity/subquery expansion 调用设为 false，基础查询不设置该开关。一次只改这个变量，quality 或延迟不达标即撤回。

**Tech Stack:** TypeScript、Jest、现有 HarmonicIndex `searchScored`、personal-recall 离线重放。

**Spec:** `docs/research/2026-11-18-memory-health-root-causes.md` §3。

## Global Constraints

- 实施者是 `gateway/volcengine/deepseek-v4.1-flash` 子代理；主 checkout，不建 worktree、不 push。
- 不改 FOK、topK、recency、note-board、snapshot、dense、graph seed 数或基础 pass。
- 不重启/build、不 commit、不跑全量 suite；父会话审查后再做完整验证。
- 固定 40 条不得改期望；若离线 AUTO<18/30、exact<10/10、current<6/10、implicit<2/10、false>0、stale>0、agreement<26/30，撤回并报告。

## Review Focus

- 基础 pass 仍允许 graph expansion，secondary pass 必须显式 false → Task 1 options 断言。
- entity 与 multi-hop 两类 expansion 都覆盖 → Task 1 结构测试。
- legacy `search()` fallback 与 dense/scan 合并不变 → 既有 recall-context 全套。
- 不以 wall-clock 单测制造 flaky；用调用次数/选项做结构门，再用同一冻结索引测性能。

---

### Task 1: secondary expansion 禁止重复图扩展

**Files:**
- Modify: `gateway/src/recall/recall-context.ts:121-158,187-195,320-330`
- Create: `gateway/tests/unit/recall/expansion-graph-fanout.test.ts`
- Existing tests: `gateway/tests/unit/recall-context-entities.test.ts`, `recall-context-scoring.test.ts`, `recall-context-scan-budget.test.ts`

**Interfaces:**
- `SearchRecallOptions` 新增 optional `graphExpand?: boolean`。
- `fetchScored` 将该字段传给 `index.searchScored`；缺省时不传，保持调用方原行为。
- `expandQuery` 的 entity/subquery 二次搜索传 `{graphExpand:false}`；`searchRecallMemories` 基础 pass 不改。

- [ ] **Step 1: 写失败结构测试**

构造能触发 entity 与 subquery expansion 的 fake index，记录每次 `searchScored(query,topK,options)`。断言首个基础调用不含 `graphExpand:false`，所有 secondary 调用均为 false；断言 expansion 仍能贡献候选且既有排序规则不变。

- [ ] **Step 2: 验证 RED**

Run: `cd gateway; npx jest tests/unit/recall/expansion-graph-fanout.test.ts --runInBand`

Expected: 当前 secondary options 没有 graphExpand:false，测试 FAIL。

- [ ] **Step 3: 最小实现**

只透传 optional 字段并在两个 expansion 调用点设置 false；不得顺手修改 expansionMaxSearches 或权重。

- [ ] **Step 4: 验证 focused GREEN**

Run: `cd gateway; npx jest tests/unit/recall/expansion-graph-fanout.test.ts tests/unit/recall-context-entities.test.ts tests/unit/recall-context-scoring.test.ts tests/unit/recall-context-scan-budget.test.ts tests/unit/recall --runInBand`

Expected: 全部 PASS；记录新增测试数与总通过数。

- [ ] **Step 5: 单变量离线质量/性能重放**

使用真实模块和只读冻结索引，对同一固定 40 条比较 before/after，不改 fixture。另用调查中的 23/69/538/685 字查询比较 graph SQL 次数与耗时；长查询的 secondary 图调用应归零，基础图调用保留。

Expected quality: AUTO≥18/30、exact=10/10、current≥6/10、implicit≥2/10、false=0/10、stale=0、agreement≥26/30。任何回退都停止并撤回。性能记录 p50/p95/max，不把单次抖动当收益。

- [ ] **Step 6: 类型门禁与文档**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`

Expected: exit 0。更新 `docs/architecture/memory.md` 的延迟现状，只描述实测值；若尚未达到 100ms，明确写未达标。交父会话独立 review、全量 suite、build/restart 与 live 40 条复测。
