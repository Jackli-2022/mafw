# Memory Vector Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 阻断 route-write skip 产生新孤儿向量，并让 Harmonic 覆盖率按非 superseded 条目的真实交集计算。

**Architecture:** 路由决策只使用局部临时向量，不在决策阶段写共享向量库；真正落盘后仍由现有 indexer 嵌入。覆盖率由共享纯函数按 active id 与 vector id 求交，旧 raw 计数保留用于诊断。

**Tech Stack:** TypeScript、Jest、现有 MemoryVectorStore、TypeBox 契约。

**Spec:** `docs/research/2026-11-18-memory-health-root-causes.md` §1。

## Global Constraints

- 实施者是 `gateway/volcengine/deepseek-v4.1-flash` 子代理；主 checkout，不建 worktree、不 push。
- TDD RED→GREEN；不得清理或重写现有向量数据，不运行 backfill。
- 不修改硬删除/merge/unmerge 等其它路径；它们作为残留单独记录。
- 不覆盖其他会话未提交改动；子代理不 commit、不 build/restart，由父会话验收。

## Review Focus

- skip 的临时向量不得残留，但已有 canonical 向量必须保持不变 → Task 1 store 断言。
- create/update 的检索决策仍能使用临时向量 → Task 1 现有 route-write 全套。
- active 有向量、superseded 无向量、orphan 有向量时 coverage 必须等于 active 交集比例且不超过 1 → Task 2 纯函数测试。
- entries/vectors 为空及 runtime 缺失 → Task 2 零值测试。
- 老客户端不因新增诊断字段破坏 → Task 2 optional schema/契约测试。

---

### Task 1: skip 决策不得写共享向量库

**Files:**
- Modify: `gateway/src/memory/route-write.ts:90-109`
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Consumes: 现有 `decideRouting(unit, deps)` 与 `VectorStoreLike`。
- Produces: 相同 `RoutingOutcome`；不改函数签名。

- [ ] **Step 1: 写失败测试**

在现有 near-identical skip 测试中断言：`v.get('n1')` 为 `undefined`、`v.size()` 仍为 1、`v.get('dup')` 仍是原向量。新增一个 create 决策测试，断言 outcome 不变且决策阶段也不提前写入 `n1`。

- [ ] **Step 2: 验证 RED**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts --runInBand`

Expected: 新断言 FAIL，当前代码在 decision 阶段 upsert `n1`。

- [ ] **Step 3: 最小实现**

删除 `decideRouting` 内的 `deps.vectors.upsert(unit.id, vec)`，保留局部 `vector = vec` 供 `searchByCosine` 使用；不增加防御性 remove，不改其它分支。

- [ ] **Step 4: 验证 GREEN**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts --runInBand`

Expected: 文件内全部测试 PASS，新增测试数量记录下来。

### Task 2: Harmonic 覆盖率使用 active 交集

**Files:**
- Create: `gateway/src/memory/vector-coverage.ts`
- Create: `gateway/tests/unit/memory/vector-coverage.test.ts`
- Modify: `gateway/src/routes/memory.ts`
- Modify: `gateway/src/kernel.ts` 的 embedding runtimeState 统计
- Modify: `gateway/src/routes/schemas/memory-stats.ts`
- Modify: `packages/gateway-sdk/src/types.ts` 对应 stats 类型（若存在）
- Test: `gateway/tests/unit/routes/memory-wiring.test.ts`
- Test: `gateway/tests/unit/api-contract.test.ts`

**Interfaces:**
- Produces: `computeHarmonicVectorCoverage(entries, vectors)`，输入只需 `id/superseded_by` 与 `size()/ids()`；返回 `{ vectors, indexEntries, activeEntries, activeWithVectors, orphanVectors, coverage, rawCoverage }`。
- `coverage = activeEntries ? activeWithVectors/activeEntries : 0`；`rawCoverage = indexEntries ? vectors/indexEntries : 0`，不得 clamp 掩盖异常。
- API 保留 `vectors/indexEntries/coverage`，新增诊断字段均为 optional。

- [ ] **Step 1: 写纯函数和 route 失败测试**

fixture：active A/C 有向量，superseded B 无向量，另有 ORPHAN。断言 activeEntries=2、activeWithVectors=2、orphanVectors=1、coverage=1、rawCoverage=1.5。另测空库、全部缺失、重复 id  defensive 行为。route 测试断言响应字段与 helper 一致。

- [ ] **Step 2: 验证 RED**

Run: `cd gateway; npx jest tests/unit/memory/vector-coverage.test.ts tests/unit/routes/memory-wiring.test.ts --runInBand`

Expected: helper 不存在或新响应字段缺失而 FAIL。

- [ ] **Step 3: 实现共享统计并接入两个出口**

用 active id Set 与 vectors.ids() 求交；`memory.stats` 和 `kernel.runtimeState` 都调用同一 helper。schema/SDK 新字段全部 optional，不改旧 required 字段。

- [ ] **Step 4: 验证 GREEN 与契约**

Run: `cd gateway; npx jest tests/unit/memory/vector-coverage.test.ts tests/unit/routes/memory-wiring.test.ts tests/unit/api-contract.test.ts --runInBand`

Expected: PASS；新增 optional 字段不破坏旧契约。

- [ ] **Step 5: 类型门禁与文档**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`

更新 `docs/architecture/memory.md` 的统计现状与残留（历史孤儿仍在、其它硬删除路径未在本切片修）。记录 RED/GREEN 和新增测试数，交由父会话做全量验证与提交。
