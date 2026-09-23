# P-A · 锚点边 IDF 加权 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `AnchorGraphStore.upsertUnit` 按锚点度数现算 IDF 作边权 → hub 边降增益（不删 hub）。

**Architecture:** 只改 `upsertUnit` 的权重计算（`weight = Σ idf(anchor)`，`idf = log(N/df)` 现算）；`getNeighbors` 排序自动受益。

**Tech Stack:** TypeScript (CJS)、better-sqlite3、Jest（`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-09-23-anchor-edge-idf-design.md`

## Global Constraints

- 不删 hub 边（保留，降增益）；不改存储结构；不改 `getNeighbors` 的 `maxNeighbors` cap。
- fail-open；测试命令在 `gateway/` 下执行。

---

## File Structure

- **Modify** `gateway/src/graph/anchor-graph-store.ts`（`upsertUnit` 权重）
- **Create** `gateway/tests/unit/anchor-graph-store.test.ts`

---

### Task 1: 边权现算 IDF

**Files:**
- Modify: `gateway/src/graph/anchor-graph-store.ts:33-74`
- Test: `gateway/tests/unit/anchor-graph-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/anchor-graph-store.test.ts`:

```ts
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { AnchorGraphStore } from '../../src/graph/anchor-graph-store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('AnchorGraphStore IDF weighting', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: AnchorGraphStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchorg-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    store = new AnchorGraphStore(db);
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('稀有锚点边权 > hub 锚点边权', () => {
    for (let i = 0; i < 60; i++) store.upsertUnit('h' + i, ['hub']);
    store.upsertUnit('a', ['rare']);
    store.upsertUnit('b', ['rare']);
    const rareW = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    const hubW = [...store.getNeighbors(['h0'], 100).get('h0')!.values()][0]!;
    expect(rareW).toBeGreaterThan(hubW);
  });

  test('新锚点（df=1）边权最大（未被误杀）', () => {
    store.upsertUnit('a', ['brand-new']);
    store.upsertUnit('b', ['brand-new']);
    expect(store.getNeighbors(['a'], 10).get('a')!.get('b')).toBeGreaterThan(0);
  });

  test('getNeighbors 按权重降序', () => {
    for (let i = 0; i < 60; i++) store.upsertUnit('h' + i, ['hub']);
    store.upsertUnit('a', ['hub', 'rare']);
    store.upsertUnit('b', ['rare']);
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    const weights = [...nb.values()];
    for (let i = 1; i < weights.length; i++) expect(weights[i - 1]).toBeGreaterThanOrEqual(weights[i]);
  });

  test('removeUnit 清边', () => {
    store.upsertUnit('a', ['x']);
    store.upsertUnit('b', ['x']);
    store.removeUnit('b');
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/anchor-graph-store.test.ts --runInBand`
Expected: FAIL — 稀有/hub 边权相等（`sharedAnchors.size` 恒 1）

- [ ] **Step 3: Implement**

In `gateway/src/graph/anchor-graph-store.ts`, replace the candidate-gathering + weight block in `upsertUnit`:

```ts
    // 2. 对每个锚点，找共享单元并建边（边权 = 共享锚点的 IDF 和，现算度数）
    const n = (this.rawDb.prepare('SELECT COUNT(DISTINCT unit_id) AS c FROM anchor_units').get() as { c: number }).c;
    const idfOf = (anchor: string): number => {
      const df = (this.rawDb.prepare('SELECT COUNT(DISTINCT unit_id) AS c FROM anchor_units WHERE anchor = ?').get(anchor) as { c: number }).c;
      return Math.log(n / Math.max(1, df));
    };
    const candidates = new Map<string, Set<string>>(); // unitId -> shared anchors
    const sel = this.rawDb.prepare('SELECT unit_id FROM anchor_units WHERE anchor = ?');
    for (const anchor of unique) {
      if (this.idf && this.idf.isNoisy(anchor)) continue;
      const rows = sel.all(anchor) as Array<{ unit_id: string }>;
      for (const row of rows) {
        if (row.unit_id === unitId) continue;
        if (!candidates.has(row.unit_id)) candidates.set(row.unit_id, new Set());
        candidates.get(row.unit_id)!.add(anchor);
      }
    }

    const insEdge = this.rawDb.prepare(
      `INSERT INTO anchor_edges (unit_a, unit_b, shared_anchors, weight) VALUES (?, ?, ?, ?)
       ON CONFLICT(unit_a, unit_b) DO UPDATE SET
         shared_anchors = excluded.shared_anchors,
         weight = excluded.weight,
         updated_at = unixepoch()`,
    );
    for (const [otherId, sharedAnchors] of candidates) {
      const [a, b] = this.normalizePair(unitId, otherId);
      const weight = [...sharedAnchors].reduce((sum, anchor) => sum + idfOf(anchor), 0);
      insEdge.run(a, b, sharedAnchors.size, weight);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/anchor-graph-store.test.ts --runInBand`
Expected: PASS (4 tests)

- [ ] **Step 5: Regression + build**

Run: `npx jest tests/unit/anchor-backfill.test.ts --runInBand` then `npm run build` then `npx jest --runInBand`
Expected: build exit 0；全绿

- [ ] **Step 6: Commit**

```bash
git add gateway/src/graph/anchor-graph-store.ts gateway/tests/unit/anchor-graph-store.test.ts
git commit -m "fix(gateway): 锚点边权现算 IDF（hub 降增益，不删 hub）"
```

---

## Self-Review

- **Spec §3 设计** → Task 1 Step 3 ✅
- **Spec §5 测试** → Task 1 Step 1 ✅
- Placeholder：无。
- 类型一致性：`upsertUnit` 签名不变；`getNeighbors` 不变。

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-23-anchor-edge-idf.md`. 执行方式：① Subagent-Driven ② Inline。
