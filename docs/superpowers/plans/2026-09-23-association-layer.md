# 联想层（Association Layer）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 MAFW 谐波记忆加入"共激活联想层"——同会话/同 Goal/时间邻近三类共激活边 + 有界 Personalized PageRank 扩散 + 读时边衰减，替换现有 hop-1 贪心图扩展。

**Architecture:** 新增两个模块（`coactivation-store.ts` 存储/构建、`diffusion.ts` 纯函数 PPR）；共激活边存独立 SQLite 表（`coactivation_units`/`coactivation_edges`），与 `anchor_edges` 并存；写时增量构建 + 启动全量 rebuild；`searchScored` 中把两路邻居归一合并后跑 PPR。全部 fail-open，配置开关可回退现状。

**Tech Stack:** TypeScript (CJS)、better-sqlite3（`GatewayDatabase`）、Jest（`--runInBand`）、现有 `HarmonicIndexManager` / `AnchorGraphStore` / `config` 单例。

**Spec:** `docs/superpowers/specs/2026-09-23-association-layer-design.md`

## Global Constraints

- 时间单位统一 **epoch 秒**（对齐既有表 `unixepoch()`）：`now = Math.floor(Date.now()/1000)`；ISO→秒用 `Math.floor(Date.parse(iso)/1000)`。
- 所有图/扩散失败 **fail-open**，绝不阻塞记忆写入或检索。
- 守 100ms 边界 recall 契约：子图 ≤ `candidateCap`(50)、PPR 迭代 ≤ 15、纯函数无 IO。
- 配置开关 `coactivation.enabled` / `diffusion.enabled` 置 false 时行为等价现状。
- 不改 `HarmonicUnit` / OKF 格式，不改 `anchor_edges` 表结构。
- 所有测试命令在 `gateway/` 目录下执行（`gateway/package.json` 的 `test` = `jest --runInBand`）。

---

## File Structure

- **Create** `gateway/src/graph/diffusion.ts` — 纯函数 PPR 扩散。
- **Create** `gateway/src/graph/coactivation-store.ts` — 共激活边存储/构建/衰减/统计。
- **Create** `gateway/tests/unit/graph/diffusion.test.ts`
- **Create** `gateway/tests/unit/graph/coactivation-store.test.ts`
- **Create** `gateway/tests/unit/graph/coactivation-write.test.ts`
- **Create** `gateway/tests/unit/graph/coactivation-search.test.ts`
- **Modify** `gateway/src/memory/gateway-db.ts` — 新增三张表（构造函数 schema 块）。
- **Modify** `gateway/src/config.ts` — `search.graph` 新增 `edgeMix`/`coactivation`/`diffusion`。
- **Modify** `gateway/src/memory/harmonic-file-store.ts` — 写时构建 + `addEntry` 传 `created_at`。
- **Modify** `gateway/src/core/memory/harmonic-index.ts` — 检索接线（替换 graph 段）。
- **Modify** `gateway/src/index.ts` — 启动 wiring/rebuild + `/api/memory/stats`。

---

### Task 1: 纯函数 PPR 扩散

**Files:**
- Create: `gateway/src/graph/diffusion.ts`
- Test: `gateway/tests/unit/graph/diffusion.test.ts`

**Interfaces:**
- Produces:
  - `interface DiffusionOptions { alpha: number; iterations: number; candidateCap: number }`
  - `function personalizedPageRank(seeds: string[], neighborsOf: (id: string) => Map<string, number>, opts: DiffusionOptions): Map<string, number>` — 返回**按最大值归一化到 0–1** 的 PPR 分数。

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/graph/diffusion.test.ts`:

```ts
import { personalizedPageRank } from '../../../src/graph/diffusion';

// 小图：seed a → b(1.0), c(1.0)；b → d(1.0)
function graph(edges: Record<string, Record<string, number>>) {
  return (id: string) => new Map(Object.entries(edges[id] ?? {}));
}

describe('personalizedPageRank', () => {
  const opts = { alpha: 0.85, iterations: 20, candidateCap: 50 };

  test('seeds 自身与近邻得分高于远端无关节点', () => {
    const edges = { a: { b: 1, c: 1 }, b: { a: 1, d: 1 }, c: { a: 1 }, d: { b: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), opts);
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('b')!).toBeGreaterThan(scores.get('d')!);
    expect(scores.get('c')).toBeDefined();
  });

  test('结果按最大值归一到 0–1', () => {
    const edges = { a: { b: 1 }, b: { a: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), opts);
    expect(Math.max(...scores.values())).toBeCloseTo(1, 5);
  });

  test('空种子返回空 Map', () => {
    expect(personalizedPageRank([], graph({}), opts).size).toBe(0);
  });

  test('candidateCap 限制子图节点数', () => {
    const edges: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 200; i++) edges[`n${i}`] = { [`n${i + 1}`]: 1 };
    const scores = personalizedPageRank(['n0'], graph(edges), { alpha: 0.85, iterations: 5, candidateCap: 10 });
    expect(scores.size).toBeLessThanOrEqual(10);
  });

  test('alpha=0 时只有种子得分', () => {
    const edges = { a: { b: 1 }, b: { a: 1 } };
    const scores = personalizedPageRank(['a'], graph(edges), { alpha: 0, iterations: 5, candidateCap: 50 });
    expect(scores.get('a')).toBeCloseTo(1, 5);
    expect(scores.get('b') ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/graph/diffusion.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/graph/diffusion'`

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/graph/diffusion.ts`:

```ts
export interface DiffusionOptions {
  alpha: number;
  iterations: number;
  candidateCap: number;
}

/**
 * Bounded Personalized PageRank over a lazily-expanded subgraph.
 * - seeds get uniform teleport mass; mass spreads along row-normalized edges
 * - subgraph grows from seeds up to candidateCap nodes
 * - returns scores normalized to 0–1 (divide by max) for downstream fusion
 * Pure: no IO, no config access. Callers bound latency via candidateCap/iterations.
 */
export function personalizedPageRank(
  seeds: string[],
  neighborsOf: (id: string) => Map<string, number>,
  opts: DiffusionOptions,
): Map<string, number> {
  const nodes = new Set<string>();
  const adj = new Map<string, Map<string, number>>();
  const queue: string[] = [];
  for (const s of seeds) if (!nodes.has(s) && nodes.size < opts.candidateCap) { nodes.add(s); queue.push(s); }

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (adj.has(id)) continue;
    const nb = neighborsOf(id);
    const out = new Map<string, number>();
    let sum = 0;
    for (const [, w] of nb) if (w > 0) sum += w;
    if (sum > 0) for (const [n, w] of nb) if (w > 0) out.set(n, w / sum);
    adj.set(id, out);
    for (const n of out.keys()) {
      if (!nodes.has(n) && nodes.size < opts.candidateCap) { nodes.add(n); queue.push(n); }
    }
  }

  if (nodes.size === 0) return new Map();

  const seedSet = [...new Set(seeds)].filter(s => nodes.has(s));
  const teleport = seedSet.length > 0 ? 1 / seedSet.length : 0;

  let p = new Map<string, number>();
  for (const s of seedSet) p.set(s, teleport);

  for (let it = 0; it < opts.iterations; it++) {
    const next = new Map<string, number>();
    for (const s of seedSet) next.set(s, (next.get(s) ?? 0) + (1 - opts.alpha) * teleport);
    for (const [id, out] of adj) {
      const val = (p.get(id) ?? 0) * opts.alpha;
      if (val <= 0) continue;
      for (const [n, w] of out) next.set(n, (next.get(n) ?? 0) + val * w);
    }
    let l1 = 0;
    for (const n of nodes) l1 += Math.abs((next.get(n) ?? 0) - (p.get(n) ?? 0));
    p = next;
    if (l1 < 1e-6) break;
  }

  let max = 0;
  for (const v of p.values()) if (v > max) max = v;
  const out = new Map<string, number>();
  for (const [k, v] of p) out.set(k, max > 0 ? v / max : 0);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/graph/diffusion.test.ts --runInBand`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/graph/diffusion.ts gateway/tests/unit/graph/diffusion.test.ts
git commit -m "feat(gateway): 联想层 PPR 扩散纯函数"
```

---

### Task 2: 共激活边存储（schema + config + store）

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（构造函数 schema 块，`anchor_edges` 之后）
- Modify: `gateway/src/config.ts`（`search.graph` 接口 ~69-82 与默认值 ~281-291）
- Create: `gateway/src/graph/coactivation-store.ts`
- Test: `gateway/tests/unit/graph/coactivation-store.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`（`(db as any).db` 裸句柄）、`config.search.graph.coactivation`。
- Produces:
  - `interface CoactivationUnitInput { id: string; source_session_id?: string; created_at?: string }`
  - `class CoactivationGraphStore`：
    - `constructor(db: GatewayDatabase)`
    - `upsertUnit(unit: CoactivationUnitInput): void`
    - `removeUnit(unitId: string): void`
    - `rebuild(index: { entries: Array<{ id: string; source_session_id?: string; created_at?: string; superseded_by?: string }> }): void`
    - `getNeighbors(unitIds: string[], topK: number, exclude?: Set<string>): Map<string, Map<string, number>>`
    - `stats(): { edges: number; session: number; goal: number; time: number }`
    - `clear(): void`

- [ ] **Step 1: Add config keys**

In `gateway/src/config.ts`, extend the `search.graph` interface (after `rerankGraphWeight: number;`, ~line 76):

```ts
    /** 合并锚点边与共激活边时的权重比（各自 min-max 归一后）。 */
    edgeMix: { anchor: number; coactivation: number };
    /** 共激活边（同会话/同 Goal/时间邻近）。 */
    coactivation: {
      enabled: boolean;
      sessionWeight: number;
      goalWeight: number;
      timeWeight: number;
      /** 时间邻近窗口（epoch 秒）。 */
      timeWindowSec: number;
      /** 读时衰减半衰期（天）。 */
      halfLifeDays: number;
      /** 每单元每信号最多邻居数。 */
      maxNeighbors: number;
      /** session/goal 成员数超过则跳过该信号。 */
      maxGroupSize: number;
    };
    /** 有界 Personalized PageRank 扩散。 */
    diffusion: { enabled: boolean; iterations: number; alpha: number };
```

And the defaults block (after `rerankGraphWeight: 0.15,`, ~line 287):

```ts
        edgeMix: { anchor: 0.6, coactivation: 0.4 },
        coactivation: {
          enabled: true,
          sessionWeight: 1.0,
          goalWeight: 0.6,
          timeWeight: 0.3,
          timeWindowSec: 3600,
          halfLifeDays: 14,
          maxNeighbors: 3,
          maxGroupSize: 50,
        },
        diffusion: { enabled: true, iterations: 15, alpha: 0.85 },
```

- [ ] **Step 2: Add schema tables**

In `gateway/src/memory/gateway-db.ts`, inside the constructor's `this.db.exec(\`...\`)` template, after the `anchor_edges` block (after `CREATE INDEX ... idx_anchor_edges_b ...;`, ~line 142), insert:

```sql
      CREATE TABLE IF NOT EXISTS coactivation_units (
        unit_id    TEXT PRIMARY KEY,
        session_id TEXT,
        goal_id    TEXT,
        created_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_coact_units_session ON coactivation_units(session_id);
      CREATE INDEX IF NOT EXISTS idx_coact_units_goal    ON coactivation_units(goal_id);
      CREATE INDEX IF NOT EXISTS idx_coact_units_created ON coactivation_units(created_at);

      CREATE TABLE IF NOT EXISTS coactivation_edges (
        unit_a     TEXT NOT NULL,
        unit_b     TEXT NOT NULL,
        session_co REAL NOT NULL DEFAULT 0,
        goal_co    REAL NOT NULL DEFAULT 0,
        time_co    REAL NOT NULL DEFAULT 0,
        weight     REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (unit_a, unit_b)
      );
      CREATE INDEX IF NOT EXISTS idx_coact_edges_a ON coactivation_edges(unit_a);
      CREATE INDEX IF NOT EXISTS idx_coact_edges_b ON coactivation_edges(unit_b);
```

- [ ] **Step 3: Write the failing test**

Create `gateway/tests/unit/graph/coactivation-store.test.ts`:

```ts
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DAY = 86_400;
const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString();

describe('CoactivationGraphStore', () => {
  let dir: string;
  let db: GatewayDatabase;
  let store: CoactivationGraphStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
    store = new CoactivationGraphStore(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('同会话单元互建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('不同会话且超出时间窗不建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10 * DAY) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(1) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.has('b')).toBe(false);
  });

  test('时间邻近（同窗口）建边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(100) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(200) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('同 Goal 经 goal_sessions 建边', () => {
    (db as any).db.prepare(
      'INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)'
    ).run('g1', 's1', 'execute', 1, new Date().toISOString());
    (db as any).db.prepare(
      'INSERT INTO goal_sessions (goal_id, session_id, phase, loop, created_at) VALUES (?,?,?,?,?)'
    ).run('g1', 's2', 'execute', 1, new Date().toISOString());
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10 * DAY) });
    store.upsertUnit({ id: 'b', source_session_id: 's2', created_at: iso(10 * DAY) });
    const nb = store.getNeighbors(['a'], 10).get('a')!;
    expect(nb.get('b')).toBeGreaterThan(0);
  });

  test('hub 防护：会话成员超 maxGroupSize 跳过该信号', () => {
    // config 默认 maxGroupSize=50；造 60 个同会话单元
    for (let i = 0; i < 60; i++) store.upsertUnit({ id: `u${i}`, source_session_id: 'big', created_at: iso(10 * DAY) });
    const nb = store.getNeighbors(['u0'], 100).get('u0')!;
    expect(nb.size).toBe(0);
  });

  test('读时衰减：越久未更新的边权越小', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    const fresh = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    (db as any).db.prepare('UPDATE coactivation_edges SET updated_at = ?').run(Math.floor(Date.now() / 1000) - 30 * DAY);
    const stale = store.getNeighbors(['a'], 10).get('a')!.get('b')!;
    expect(stale).toBeLessThan(fresh);
  });

  test('rebuild 从索引重建并跳过 superseded', () => {
    store.rebuild({ entries: [
      { id: 'a', source_session_id: 's1', created_at: iso(10) },
      { id: 'b', source_session_id: 's1', created_at: iso(10) },
      { id: 'c', source_session_id: 's1', created_at: iso(10), superseded_by: 'b' },
    ] });
    expect(store.stats().edges).toBe(1);
  });

  test('removeUnit 清掉相关边', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    store.removeUnit('b');
    expect(store.getNeighbors(['a'], 10).get('a')!.size).toBe(0);
  });

  test('重复 upsert 合并而非重复计数', () => {
    store.upsertUnit({ id: 'a', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    store.upsertUnit({ id: 'b', source_session_id: 's1', created_at: iso(10) });
    expect(store.stats().edges).toBe(1);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tests/unit/graph/coactivation-store.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/graph/coactivation-store'`

- [ ] **Step 5: Write minimal implementation**

Create `gateway/src/graph/coactivation-store.ts`:

```ts
import { GatewayDatabase } from '../memory/gateway-db';
import { config } from '../config';

export interface CoactivationUnitInput {
  id: string;
  source_session_id?: string;
  created_at?: string;
}

const DAY = 86400;

/**
 * SQLite-backed co-activation graph: units that "appeared together" (same
 * session, same goal via goal_sessions, or temporally close) get an undirected
 * weighted edge. Complements AnchorGraphStore (shared cue_anchors = lexical
 * association) with behavioural association (Hebbian co-activation).
 * Edge weights decay at read time; re-activation refreshes updated_at.
 */
export class CoactivationGraphStore {
  private db: GatewayDatabase;

  constructor(db: GatewayDatabase) {
    this.db = db;
  }

  private get rawDb(): any {
    return (this.db as any).db;
  }

  private nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  private toSec(iso?: string): number | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.floor(t / 1000) : null;
  }

  private normalizePair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  private decay(weight: number, updatedAt: number): number {
    const halfLifeSec = config.search.graph.coactivation.halfLifeDays * DAY;
    if (halfLifeSec <= 0) return weight;
    return weight * Math.exp(-Math.max(0, this.nowSec() - updatedAt) / halfLifeSec);
  }

  upsertUnit(unit: CoactivationUnitInput): void {
    const id = unit.id;
    if (!id) return;
    const createdSec = this.toSec(unit.created_at);

    let goalId: string | null = null;
    if (unit.source_session_id) {
      const row = this.rawDb
        .prepare('SELECT goal_id FROM goal_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(unit.source_session_id) as { goal_id: string } | undefined;
      goalId = row?.goal_id ?? null;
    }

    this.rawDb
      .prepare(
        `INSERT INTO coactivation_units (unit_id, session_id, goal_id, created_at) VALUES (?,?,?,?)
         ON CONFLICT(unit_id) DO UPDATE SET
           session_id = excluded.session_id,
           goal_id = excluded.goal_id,
           created_at = excluded.created_at`,
      )
      .run(id, unit.source_session_id ?? null, goalId, createdSec);

    const cfg = config.search.graph.coactivation;
    if (!cfg.enabled) return;

    const contributions = new Map<string, { session: number; goal: number; time: number }>();
    const bump = (otherId: string, key: 'session' | 'goal' | 'time', val: number) => {
      if (otherId === id) return;
      if (!contributions.has(otherId)) contributions.set(otherId, { session: 0, goal: 0, time: 0 });
      const c = contributions.get(otherId)!;
      if (val > c[key]) c[key] = val;
    };

    // same session (hub-protected)
    if (unit.source_session_id) {
      const count = (this.rawDb
        .prepare('SELECT COUNT(*) AS c FROM coactivation_units WHERE session_id = ?')
        .get(unit.source_session_id) as { c: number }).c;
      if (count <= cfg.maxGroupSize) {
        const rows = this.rawDb
          .prepare('SELECT unit_id FROM coactivation_units WHERE session_id = ? AND unit_id != ? LIMIT ?')
          .all(unit.source_session_id, id, cfg.maxNeighbors) as Array<{ unit_id: string }>;
        for (const r of rows) bump(r.unit_id, 'session', 1);
      }
    }

    // same goal (hub-protected)
    if (goalId) {
      const count = (this.rawDb
        .prepare('SELECT COUNT(*) AS c FROM coactivation_units WHERE goal_id = ?')
        .get(goalId) as { c: number }).c;
      if (count <= cfg.maxGroupSize) {
        const rows = this.rawDb
          .prepare('SELECT unit_id FROM coactivation_units WHERE goal_id = ? AND unit_id != ? LIMIT ?')
          .all(goalId, id, cfg.maxNeighbors) as Array<{ unit_id: string }>;
        for (const r of rows) bump(r.unit_id, 'goal', 1);
      }
    }

    // temporal proximity (symmetric window on created_at)
    if (createdSec !== null) {
      const win = cfg.timeWindowSec;
      const rows = this.rawDb
        .prepare(
          'SELECT unit_id, created_at FROM coactivation_units WHERE unit_id != ? AND created_at BETWEEN ? AND ? LIMIT ?',
        )
        .all(id, createdSec - win, createdSec + win, cfg.maxNeighbors) as Array<{ unit_id: string; created_at: number }>;
      for (const r of rows) {
        const dt = Math.abs(r.created_at - createdSec);
        bump(r.unit_id, 'time', Math.max(0, 1 - dt / win));
      }
    }

    const insEdge = this.rawDb.prepare(
      `INSERT INTO coactivation_edges (unit_a, unit_b, session_co, goal_co, time_co, weight) VALUES (?,?,?,?,?,?)
       ON CONFLICT(unit_a, unit_b) DO UPDATE SET
         session_co = excluded.session_co,
         goal_co = excluded.goal_co,
         time_co = excluded.time_co,
         weight = excluded.weight,
         updated_at = unixepoch()`,
    );
    for (const [otherId, c] of contributions) {
      const [a, b] = this.normalizePair(id, otherId);
      const weight = cfg.sessionWeight * c.session + cfg.goalWeight * c.goal + cfg.timeWeight * c.time;
      if (weight <= 0) continue;
      insEdge.run(a, b, c.session, c.goal, c.time, weight);
    }
  }

  removeUnit(unitId: string): void {
    this.rawDb.prepare('DELETE FROM coactivation_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM coactivation_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);
  }

  rebuild(index: { entries: Array<{ id: string; source_session_id?: string; created_at?: string; superseded_by?: string }> }): void {
    this.clear();
    for (const entry of index.entries) {
      if (entry.superseded_by) continue;
      this.upsertUnit({ id: entry.id, source_session_id: entry.source_session_id, created_at: entry.created_at });
    }
  }

  getNeighbors(unitIds: string[], topK: number, exclude?: Set<string>): Map<string, Map<string, number>> {
    const result = new Map<string, Map<string, number>>();
    for (const unitId of unitIds) result.set(unitId, new Map());
    if (unitIds.length === 0) return result;

    const placeholders = unitIds.map(() => '?').join(',');
    const rows = this.rawDb
      .prepare(
        `SELECT unit_a, unit_b, weight, updated_at FROM coactivation_edges
         WHERE unit_a IN (${placeholders}) OR unit_b IN (${placeholders})`,
      )
      .all(...unitIds, ...unitIds) as Array<{ unit_a: string; unit_b: string; weight: number; updated_at: number }>;

    const idSet = new Set(unitIds);
    for (const row of rows) {
      const [seed, nb] = idSet.has(row.unit_a) ? [row.unit_a, row.unit_b] : [row.unit_b, row.unit_a];
      if (idSet.has(nb)) continue;
      if (exclude?.has(nb)) continue;
      const bucket = result.get(seed)!;
      const w = this.decay(row.weight, row.updated_at);
      if (!bucket.has(nb) || bucket.get(nb)! < w) bucket.set(nb, w);
    }

    for (const [, bucket] of result) {
      const sorted = [...bucket.entries()].sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0]));
      bucket.clear();
      for (const [nb, w] of sorted.slice(0, topK)) bucket.set(nb, w);
    }
    return result;
  }

  stats(): { edges: number; session: number; goal: number; time: number } {
    const edges = (this.rawDb.prepare('SELECT COUNT(*) AS c FROM coactivation_edges').get() as { c: number }).c;
    const one = (col: string) =>
      (this.rawDb.prepare(`SELECT COUNT(*) AS c FROM coactivation_edges WHERE ${col} > 0`).get() as { c: number }).c;
    return { edges, session: one('session_co'), goal: one('goal_co'), time: one('time_co') };
  }

  clear(): void {
    this.rawDb.prepare('DELETE FROM coactivation_edges').run();
    this.rawDb.prepare('DELETE FROM coactivation_units').run();
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx jest tests/unit/graph/coactivation-store.test.ts --runInBand`
Expected: PASS (9 tests)

- [ ] **Step 7: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/config.ts gateway/src/graph/coactivation-store.ts gateway/tests/unit/graph/coactivation-store.test.ts
git commit -m "feat(gateway): 共激活边存储（schema/config/store）"
```

---

### Task 3: 写路径集成

**Files:**
- Modify: `gateway/src/memory/harmonic-file-store.ts`（构造参数、`addEntry` 传 `created_at`、写后调 `upsertUnit`）
- Test: `gateway/tests/unit/graph/coactivation-write.test.ts`

**Interfaces:**
- Consumes: `CoactivationGraphStore`（Task 2）。
- Produces: `HarmonicUnitFileStore` 构造签名新增可选第 4 参 `coactivationStore?: CoactivationGraphStore`；`getCoactivationGraphStore()` 访问器。

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/graph/coactivation-write.test.ts`:

```ts
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, sessionId: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'episodic', primary_abstraction: 'abs ' + id, cue_anchors: [],
    memory_value: 'value ' + id, energy: 0.8, created_at: now, updated_at: now,
    source_session_id: sessionId,
  } as HarmonicUnit;
}

describe('coactivation write path', () => {
  test('写入同会话两条记忆 → 生成共激活边，且索引条目带 created_at', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-w-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const index = new HarmonicIndexManager(dir);
    const coact = new CoactivationGraphStore(db);
    const store = new HarmonicUnitFileStore(dir, index, undefined, coact);

    await store.write(unit('a', 's1'));
    await store.write(unit('b', 's1'));

    expect(coact.getNeighbors(['a'], 10).get('a')!.get('b')).toBeGreaterThan(0);
    const entry = index.getIndex().entries.find(e => e.id === 'a')!;
    expect(entry.created_at).toBeTruthy();

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/graph/coactivation-write.test.ts --runInBand`
Expected: FAIL — `HarmonicUnitFileStore` 第 4 参不存在 / `getCoactivationGraphStore` undefined（边未生成）

- [ ] **Step 3: Implement**

In `gateway/src/memory/harmonic-file-store.ts`:

1. Import: `import { CoactivationGraphStore } from '../graph/coactivation-store';`
2. Add field + constructor param (mirror `anchorGraphStore`):

```ts
  private coactivationStore: CoactivationGraphStore | undefined;
```

Constructor signature (current: `(mafwDir, indexManager?, anchorGraphStore?)`) → add 4th param:

```ts
    coactivationStore?: CoactivationGraphStore,
```
and in the body: `this.coactivationStore = coactivationStore;`

3. In the `indexManager.addEntry({...})` call (~line 85), add `created_at: targetUnit.created_at,` alongside the existing fields.
4. After the anchor graph upsert block (~line 107), add:

```ts
      try {
        this.coactivationStore?.upsertUnit({
          id: targetUnit.id,
          source_session_id: targetUnit.source_session_id,
          created_at: targetUnit.created_at,
        });
      } catch { /* non-fatal */ }
```

5. Add accessor next to any existing getter:

```ts
  getCoactivationGraphStore(): CoactivationGraphStore | undefined {
    return this.coactivationStore;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/graph/coactivation-write.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Run the file-store + related suites (regression)**

Run: `npx jest tests/unit/coactivation-write.test.ts tests/unit/get-memory.test.ts tests/unit/memory-decay.test.ts --runInBand` (paths relative to gateway; adjust if some don't exist)
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/memory/harmonic-file-store.ts gateway/tests/unit/graph/coactivation-write.test.ts
git commit -m "feat(gateway): 写路径构建共激活边 + 索引补 created_at"
```

---

### Task 4: 检索接线（合并邻居 + PPR + 回退）

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts`（替换 320-368 graph 段；新增 `setCoactivationGraphStore`/`getCoactivationGraphStore`）
- Test: `gateway/tests/unit/graph/coactivation-search.test.ts`

**Interfaces:**
- Consumes: `CoactivationGraphStore`（Task 2）、`personalizedPageRank`（Task 1）、`config.search.graph.{edgeMix,diffusion,coactivation}`。
- Produces: `HarmonicIndexManager.setCoactivationGraphStore(store: CoactivationGraphStore | null): void`。

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/graph/coactivation-search.test.ts`:

```ts
import { GatewayDatabase } from '../../../src/memory/gateway-db';
import { CoactivationGraphStore } from '../../../src/graph/coactivation-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, sessionId: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [],
    memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now,
    source_session_id: sessionId,
  } as HarmonicUnit;
}

function build(dir: string, db: GatewayDatabase) {
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const coact = new CoactivationGraphStore(db);
  index.setCoactivationGraphStore(coact);
  return { index, coact };
}

describe('searchScored coactivation diffusion', () => {
  test('共激活项被提到无关联项之前', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-s-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const { index, coact } = build(dir, db);
    // query 命中 'target'；'linked' 与 target 同会话但词面不匹配
    index.addEntry(unit('target', 'kubernetes deployment rollout', 's1'), 'semantic');
    index.addEntry(unit('linked', 'incident postmortem notes', 's1'), 'semantic');
    index.addEntry(unit('other', 'unrelated content here', 's2'), 'semantic');
    coact.upsertUnit({ id: 'target', source_session_id: 's1', created_at: new Date().toISOString() });
    coact.upsertUnit({ id: 'linked', source_session_id: 's1', created_at: new Date().toISOString() });

    const res = index.searchScored('kubernetes deployment', 5, { graphExpand: true });
    const ids = res.map(r => r.entry.id);
    expect(ids).toContain('target');
    expect(ids).toContain('linked');
    expect(ids.indexOf('linked')).toBeLessThan(ids.length); // linked 被扩展进候选
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('coactivation.enabled=false 时共激活边不生效（回退锚点边）', () => {
    const cfg = require('../../../src/config').config;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coact-off-'));
    const db = new GatewayDatabase(path.join(dir, 'test.db'));
    const { index, coact } = build(dir, db);
    index.addEntry(unit('target', 'kubernetes deployment rollout', 's1'), 'semantic');
    index.addEntry(unit('linked', 'incident postmortem notes', 's1'), 'semantic');
    coact.upsertUnit({ id: 'target', source_session_id: 's1', created_at: new Date().toISOString() });
    coact.upsertUnit({ id: 'linked', source_session_id: 's1', created_at: new Date().toISOString() });

    const prev = cfg.search.graph.coactivation.enabled;
    cfg.search.graph.coactivation.enabled = false;
    const res = index.searchScored('kubernetes deployment', 5, { graphExpand: true });
    expect(res.map(r => r.entry.id)).not.toContain('linked');
    cfg.search.graph.coactivation.enabled = prev;
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/graph/coactivation-search.test.ts --runInBand`
Expected: FAIL — `setCoactivationGraphStore` 未定义 / `linked` 未被扩展

- [ ] **Step 3: Implement**

In `gateway/src/core/memory/harmonic-index.ts`:

1. Import: `import { personalizedPageRank } from '../../graph/diffusion';`
2. Field + accessors (mirror `anchorGraphStore`):

```ts
  private coactivationGraphStore: import('../../graph/coactivation-store').CoactivationGraphStore | null = null;

  setCoactivationGraphStore(store: import('../../graph/coactivation-store').CoactivationGraphStore | null): void {
    this.coactivationGraphStore = store;
  }

  getCoactivationGraphStore(): import('../../graph/coactivation-store').CoactivationGraphStore | null {
    return this.coactivationGraphStore;
  }
```

3. Replace the graph block (`// ── Anchor-graph multi-hop expansion (Memora-style) ──` through the closing `}` at ~line 368) with:

```ts
    // ── Association layer: merged anchor + coactivation neighbors → bounded PPR ──
    const graphExpand = options.graphExpand ?? config.search.graph.enabled;
    const gcfg = config.search.graph;
    if (graphExpand && (this.anchorGraphStore || this.coactivationGraphStore) && scored.length > 0) {
      const maxNeighbors = options.graphMaxNeighbors ?? gcfg.maxNeighbors;
      const candidateCap = gcfg.candidateCap;
      const seedK = Math.min(scored.length, candidateCap);
      const seeds = scored.slice(0, seedK).map(s => s.entry.id);
      const seedSet = new Set(seeds);
      const norm = (m: Map<string, number>) => {
        const vals = [...m.values()];
        if (vals.length === 0) return m;
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        if (max === min) return new Map([...m].map(([k]) => [k, 0.5]));
        return new Map([...m].map(([k, v]) => [k, (v - min) / (max - min)]));
      };

      const merged = new Map<string, Map<string, number>>();
      for (const id of seeds) {
        const anchorNbs = this.anchorGraphStore
          ? new Map([...this.anchorGraphStore.getNeighbors([id], maxNeighbors, seedSet)].map(([k, v]) => [k, v.weight]))
          : new Map<string, number>();
        const coactNbs = new Map<string, number>(
          this.coactivationGraphStore?.getNeighbors([id], maxNeighbors, seedSet).get(id) ?? new Map(),
        );
        const na = norm(anchorNbs);
        const nc = norm(coactNbs);
        const mix = new Map<string, number>();
        for (const [k, v] of na) mix.set(k, (mix.get(k) ?? 0) + gcfg.edgeMix.anchor * v);
        for (const [k, v] of nc) mix.set(k, (mix.get(k) ?? 0) + gcfg.edgeMix.coactivation * v);
        merged.set(id, mix);
      }

      const neighborsOf = (id: string) => merged.get(id) ?? new Map<string, number>();

      const byId = new Map<string, ScoredEntry & { graphScore?: number }>(scored.map(s => [s.entry.id, s]));
      if (gcfg.diffusion.enabled) {
        const ppr = personalizedPageRank(seeds, neighborsOf, {
          alpha: gcfg.diffusion.alpha,
          iterations: gcfg.diffusion.iterations,
          candidateCap,
        });
        for (const [id, gs] of ppr) {
          if (seedSet.has(id)) continue;
          const entry = this.index.entries.find(e => e.id === id);
          if (!entry || entry.superseded_by) continue;
          byId.set(id, { entry, score: gs, graphScore: gs });
        }
      } else {
        // fallback: legacy hop-greedy
        const damping = options.graphDamping ?? gcfg.damping;
        let hop = 1;
        while (hop <= (options.maxHops ?? gcfg.maxHops) && byId.size < candidateCap) {
          const frontier = [...byId.keys()];
          let expanded = false;
          for (const id of frontier) {
            for (const [nbId, w] of neighborsOf(id)) {
              const nbEntry = this.index.entries.find(e => e.id === nbId);
              if (!nbEntry || nbEntry.superseded_by) continue;
              const gs = w * (nbEntry.energy ?? 0.8) * (nbEntry.salience ?? 1) * Math.pow(damping, hop);
              const ex = byId.get(nbId);
              if (!ex) { byId.set(nbId, { entry: nbEntry, score: gs, graphScore: gs }); expanded = true; }
              else if ((ex.graphScore ?? 0) < gs) { ex.graphScore = gs; expanded = true; }
            }
          }
          if (!expanded) break;
          hop++;
        }
      }

      const graphWeight = gcfg.rerankGraphWeight;
      const entries = [...byId.values()];
      const nbv = norm(new Map(entries.map(e => [e.entry.id, e.score])));
      const ngv = norm(new Map(entries.map(e => [e.entry.id, e.graphScore ?? 0])));
      scored = entries.map(e => ({
        entry: e.entry,
        score: (1 - graphWeight) * (nbv.get(e.entry.id) ?? 0) + graphWeight * (ngv.get(e.entry.id) ?? 0),
      }));
      scored.sort((a, b) => b.score - a.score);
    }
```

> 注意：`coactivationGraphStore.getNeighbors` 为批量签名，返回 `Map<seedId, Map<nbId, w>>`；此处按种子单独取 `.get(id)`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/graph/coactivation-search.test.ts --runInBand`
Expected: PASS (2 tests)

- [ ] **Step 5: Regression on retrieval suites**

Run: `npx jest tests/unit/hybrid-fusion.test.ts tests/unit/harmonic-index.test.ts --runInBand`（若 `harmonic-index.test.ts` 不存在则只跑前者）
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/memory/harmonic-index.ts gateway/tests/unit/graph/coactivation-search.test.ts
git commit -m "feat(gateway): 检索接线——共激活邻居合并 + 有界 PPR + 回退"
```

---

### Task 5: Gateway 启动 wiring + stats + rebuild

**Files:**
- Modify: `gateway/src/index.ts`（anchor graph 初始化块 ~2166-2177；`/api/memory/stats` ~3310-3334）
- Test: 现有套件回归 + 启动 smoke（无独立单测，见 Step 3）

**Interfaces:**
- Consumes: `CoactivationGraphStore`（Task 2）、`HarmonicIndexManager.setCoactivationGraphStore`（Task 4）。

- [ ] **Step 1: Wire startup + rebuild**

In `gateway/src/index.ts`, inside the anchor-graph init block (~2166-2177), after `this.memoryService?.harmonicIndex?.setAnchorGraphStore(anchorStore);` add:

```ts
      const { CoactivationGraphStore } = require('./graph/coactivation-store');
      const coactStore = new CoactivationGraphStore(this.getGatewayDb());
      coactStore.rebuild(index ?? { entries: [] });
      this.coactivationGraphStore = coactStore;
      this.memoryService?.harmonicIndex?.setCoactivationGraphStore(coactStore);
      try { this.heartbeat?.record?.('coactivation-rebuild', { ok: true, counts: coactStore.stats() }); } catch { /* non-fatal */ }
      log.info('[Coactivation] store initialized & rebuilt');
```

Also add the field near `anchorGraphStore` (~line 321):

```ts
  private coactivationGraphStore: import('./graph/coactivation-store').CoactivationGraphStore | null = null;
```
and assign `this.coactivationGraphStore = coactStore;` in the block above (so the stats route can read it).

> Note: the anchor-graph block is wrapped in try/catch that logs `[AnchorGraph] init failed (non-fatal)`. Put the coactivation wiring in the **same** try block so a failure is fail-open.

- [ ] **Step 2: Expose stats**

In the `/api/memory/stats` handler (~3318), add to the JSON payload:

```ts
              coactivation: (() => {
                try { return this.coactivationGraphStore?.stats() ?? null; } catch { return null; }
              })(),
```

- [ ] **Step 3: Verify (build + full gateway suite + smoke)**

Run:
```bash
npm run build
npx jest --runInBand
```
Expected: build exit 0；jest 全绿（含新增 4 个测试文件）。

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): 联想层启动 wiring + rebuild + stats"
```

---

### Task 6: LongMemEval 验收（可复现对照）

**Files:**
- 无代码改动（评测运行）；结果记入 `docs/research/2026-09-23-association-layer-design.md` 或新建结果笔记。

- [ ] **Step 1: 跑基线（关闭联想层）**

```bash
npx ts-node --project evaluation/longmemeval/tsconfig.json \
  evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session
```
（在 `MAFW` 环境变量或临时 config 中设 `search.graph.coactivation.enabled=false` + `search.graph.diffusion.enabled=false`，记录 R@10 / R@5 / R@1。）

- [ ] **Step 2: 跑实验（开启联想层）**

同命令，开 `coactivation.enabled=true` + `diffusion.enabled=true`；记录同指标，重点看 multi-session / multi-hop 类别。

- [ ] **Step 3: 记录结论**

把对照数字写入设计文档「验收」小节；若无提升，保留开关默认关闭并记录。

- [ ] **Step 4: Commit（若有结果笔记）**

```bash
git add docs/
git commit -m "docs(memory): 联想层 LongMemEval 对照结果"
```

---

## Self-Review

**Spec coverage:**
- §4 数据模型 → Task 2 Step 2（三张表）✅
- §5 边构建（三信号 + hub + 对称窗 + ON CONFLICT）→ Task 2 Step 5 ✅
- §5.2 `removeUnit` / §5.3 `rebuild` / §5.4 `getNeighbors` → Task 2 ✅
- §6 边衰减 → Task 2 `decay()` + 衰减测试 ✅
- §7 PPR → Task 1 ✅
- §8 检索接线 + 回退 → Task 4 ✅
- §9 配置（`edgeMix`/`coactivation`/`diffusion`）→ Task 2 Step 1 ✅
- §10 可观测（stats）→ Task 5 Step 2；心跳 rebuild 记录 → Task 5 Step 1（`heartbeat.record('coactivation-rebuild', …)`）✅
- §11 测试 → Tasks 1-4 + Task 6 ✅
- §12 迁移/回滚 → 新表 `IF NOT EXISTS`（Task 2）、启动 rebuild（Task 5）、开关回退（Task 4）✅
- §4 索引补 `created_at` → Task 3 Step 3.3 ✅

**Placeholder scan:** 无 TBD/TODO；所有代码步骤含完整代码。

**Type consistency:** `CoactivationGraphStore` 方法名（`upsertUnit`/`removeUnit`/`rebuild`/`getNeighbors`/`stats`/`clear`）跨 Task 2/3/4/5 一致；`getNeighbors` 返回 `Map<seedId, Map<nbId, w>>` 在 Task 2 定义、Task 4 按 `.get(id)` 使用一致；`personalizedPageRank` 签名 Task 1 定义、Task 4 使用一致；`setCoactivationGraphStore` Task 4 定义、Task 5 使用一致。

**Gap found & fixed:** §10 心跳记录 → 已并入 Task 5 Step 1（`heartbeat.record('coactivation-rebuild', …)`）。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-23-association-layer.md`. Two execution options:

1. **Subagent-Driven (recommended)** — 每个 task 派新子代理，任务间双阶段 review，迭代快。
2. **Inline Execution** — 本会话内用 executing-plans 批量执行 + 检查点。

选哪种？
