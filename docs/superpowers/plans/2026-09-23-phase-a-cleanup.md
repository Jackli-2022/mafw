# Phase A · 清理与统一 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删死管线 `memory:distill`；统一 `abstraction_level` 映射（`abstractionLevelFor`）；stats 暴露抽象度分布。

**Architecture:** 新增纯函数 `abstractionLevelFor(type)`（episodic→1 / semantic|procedural→2 / global→3），替换 7 处写路径；移除 no-op `memory:distill`；给索引条目补 `abstraction_level` 使 stats 可廉价统计。

**Tech Stack:** TypeScript (CJS)、Jest（`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-09-23-memory-dual-system-restructure-design.md`（Phase A）

## Global Constraints

- 统一映射：`episodic→1`，`semantic|procedural→2`，`global→3`。
- 不改 OKF 存储格式；不改 boundary recall；fail-open。
- 测试命令在 `gateway/` 下执行。

---

### Task 1: `abstractionLevelFor` 纯函数

**Files:**
- Create: `gateway/src/core/memory/abstraction-level.ts`
- Test: `gateway/tests/unit/abstraction-level.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { abstractionLevelFor } from '../../src/core/memory/abstraction-level';

describe('abstractionLevelFor', () => {
  test('episodic→1, semantic/procedural→2, global→3', () => {
    expect(abstractionLevelFor('episodic')).toBe(1);
    expect(abstractionLevelFor('semantic')).toBe(2);
    expect(abstractionLevelFor('procedural')).toBe(2);
    expect(abstractionLevelFor('global')).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/abstraction-level.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
/**
 * Unified abstraction degree for a memory system (orthogonal to `type`):
 * episodic=1 (concrete instance), semantic|procedural=2, global=3.
 * Replaces the per-write-path mappings that had drifted (procedural→3, global→4).
 */
export function abstractionLevelFor(type: string): number {
  if (type === 'episodic') return 1;
  if (type === 'global') return 3;
  return 2;
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/abstraction-level.ts gateway/tests/unit/abstraction-level.test.ts
git commit -m "feat(gateway): abstractionLevelFor 统一抽象度映射"
```

---

### Task 2: 替换 7 处写路径

**Files:** Modify `mcp/handlers/add-memory.ts:45`、`index.ts:6039`、`core/mcp/tools.ts:465`、`core/compression/hybrid-compressor.ts:80`、`recall/reflection.ts:288`、`core/memory/t1-to-t2-compressor.ts:135`、`recall/constraints-migrate.ts:64`

- [ ] **Step 1: Replace** 每处 `abstraction_level: <expr>` → `abstraction_level: abstractionLevelFor(<type>)`（`add-memory`/`index`/`tools`/`hybrid-compressor` 用变量；`reflection`/`t1-to-t2`/`constraints-migrate` 用字面量 `'semantic'`/`'episodic'`/`'semantic'`）。
- [ ] **Step 2: Build + 全量套件** → 全绿
- [ ] **Step 3: Commit** `git commit -m "refactor(gateway): 统一 7 处 abstraction_level 映射"`

---

### Task 3: 删死管线 `memory:distill`

**Files:** Modify `automation-engine.ts:41-52`、`mcp/tool-registry.ts:398/455`；Create/标注 `core/memory/abstraction-distiller.ts`

- [ ] **Step 1: 移除** `automation-engine.ts` 的 `actionRegistry.set('memory:distill', …)` 块与 `runDistillation` import。
- [ ] **Step 2: 移除** `tool-registry.ts:398/455` 枚举里的 `"memory:distill"`。
- [ ] **Step 3: 标注** `abstraction-distiller.ts` 为 deprecated（保留 regex 函数，移除 no-op `runDistillation` 或加注释）。
- [ ] **Step 4: Build + 全量套件** → 全绿
- [ ] **Step 5: Commit** `git commit -m "chore(gateway): 移除死管线 memory:distill"`

---

### Task 4: stats 暴露抽象度分布

**Files:** Modify `core/memory/harmonic-types.ts`（`HarmonicIndexEntry` 加 `abstraction_level?`）、`core/memory/harmonic-index.ts`（`addEntry` 存该字段）、`memory/harmonic-file-store.ts`（调用处传）、`index.ts`（stats 分布）

- [ ] **Step 1: 加字段**：`HarmonicIndexEntry.abstraction_level?: number`；`addEntry` 存 `unit.abstraction_level`；file-store 调用处传 `abstraction_level: targetUnit.abstraction_level`。
- [ ] **Step 2: stats**：`/api/memory/stats` 增 `abstractionLevels: { '1': n, '2': n, '3': n, unknown: n }`（从 index entries 统计）。
- [ ] **Step 3: Build + 全量套件** → 全绿
- [ ] **Step 4: Commit** `git commit -m "feat(gateway): stats 暴露 abstraction_level 分布"`

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-23-phase-a-cleanup.md`. 执行方式：① Subagent-Driven ② Inline。
