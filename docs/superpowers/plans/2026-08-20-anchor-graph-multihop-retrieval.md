# 锚点图多跳检索（Anchor-Graph Multi-Hop Retrieval）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在谐波记忆检索链上实现 Memora 式锚点图多跳扩展：bm25 初筛命中后通过共享 cue_anchors 的 SQLite 持久化图拉取邻居，图得分与 bm25 融合，提升 multi-session/multi-hop 召回。

**Architecture:** 新模块 `AnchorGraphStore`（SQLite 两表 `anchor_units`/`anchor_edges`，写路径增量 + 启动 rebuild）；`HarmonicIndexManager.searchScored` 内建图扩展（bm25 初筛 → 图邻居并入，graphScore=边权重×energy×salience×damping^hop → 加权融合 → 可选 reranker）；config `search.graph` 段控制，LongMemEval L1 门禁验证。

**Tech Stack:** better-sqlite3（复用 GatewayDatabase 连接）、IDFStats、现有 HeuristicReranker（可选）、LongMemEval L1 基准。

## Global Constraints

- 表结构见 spec §3（`anchor_units`/`anchor_edges`，边规范化 `unit_a<unit_b`）
- 权重语义：`weight = Σ(共享锚点的 IDF)`，`IDFStats.isNoisy` 过滤 hub 锚点（threshold=0.5 默认、AnchorGraph hubThreshold=20）
- 检索默认：`graphExpand=true`、`maxHops=1`、`maxNeighbors=3`、`damping=0.6`、`candidateCap=50`、融合权重 `graph=0.15`（bm25 0.85）
- 隔离环境（LongMemEval tmp store、单测）无 anchorGraphStore → 图扩展自动跳过，行为与现状完全一致
- 生产 config 默认 `reranker:'off'`、`recallK:50`、`cutoffRatio:0`——图扩展融合**内建在 searchScored**（不依赖 reranker）；config.search.reranker 开启时才接 reranker
- superseded 条目：图扩展排除（不建边、检索跳过）
- 写失败/图查询失败 → try/catch 降级，绝不抛回检索/写路径
- 测试框架 jest（`npm run test:unit`）；LongMemEval：`npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25`

---

### Task 1: 网关 — AnchorGraphStore（表结构 + 图操作）

**Files:**
- Create: `gateway/src/graph/anchor-graph-store.ts`
- Modify: `gateway/src/memory/gateway-db.ts`（建两表 DDL）
- Test: `tests/unit/gateway/anchor-graph-store.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`（gateway-db.ts）、`HarmonicIndex`（entries）
- Produces: `class AnchorGraphStore { constructor(db: GatewayDatabase, idf?: IDFStats) }`、`upsertUnit(unitId: string, anchors: string[]): void`、`removeUnit(unitId: string): void`、`getNeighbors(unitIds: string[], topK: number, exclude?: Set<string>): Map<string, { weight: number; sharedAnchors: number }>`、`rebuild(index: { entries: Array<{ id: string; cue_anchors?: string[]; superseded_by?: string }> }): void`、`getSharedAnchors(a: string, b: string): number`、`clear(): void`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/gateway/anchor-graph-store.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { AnchorGraphStore } from '../../../gateway/src/graph/anchor-graph-store';

let dir: string;
let db: GatewayDatabase;
let store: AnchorGraphStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-test-'));
  db = new GatewayDatabase(path.join(dir, 'gateway.db'));
  store = new AnchorGraphStore(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('upsertUnit creates anchor→unit rows and edges between shared-anchor units', () => {
  store.upsertUnit('mem_a', ['project-orion', 'deadline']);
  store.upsertUnit('mem_b', ['project-orion', 'dave']);
  store.upsertUnit('mem_c', ['unrelated', 'topic']);

  const nb = store.getNeighbors(['mem_a'], 5);
  expect(nb.has('mem_b')).toBe(true);
  expect(nb.has('mem_c')).toBe(false);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
});

test('upsertUnit replaces old anchors (idempotent rewrite)', () => {
  store.upsertUnit('mem_a', ['x', 'y']);
  store.upsertUnit('mem_b', ['x']);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
  // 重写 mem_a 去掉 x
  store.upsertUnit('mem_a', ['y', 'z']);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(0);
});

test('removeUnit clears all edges and anchor rows', () => {
  store.upsertUnit('mem_a', ['x']);
  store.upsertUnit('mem_b', ['x']);
  store.removeUnit('mem_a');
  const nb = store.getNeighbors(['mem_b'], 5);
  expect(nb.has('mem_a')).toBe(false);
});

test('getNeighbors respects topK and orders by weight desc', () => {
  // mem_a 与 mem_b 共享 2 锚点，与 mem_c 共享 1 锚点 → b 权重更高
  store.upsertUnit('mem_a', ['x', 'y', 'z']);
  store.upsertUnit('mem_b', ['x', 'y']);
  store.upsertUnit('mem_c', ['x']);
  const nb = store.getNeighbors(['mem_a'], 1);
  expect([...nb.keys()]).toEqual(['mem_b']);
});

test('rebuild is idempotent and skips superseded entries', () => {
  const index = {
    entries: [
      { id: 'mem_a', cue_anchors: ['x'], superseded_by: undefined },
      { id: 'mem_b', cue_anchors: ['x'], superseded_by: undefined },
      { id: 'mem_old', cue_anchors: ['x'], superseded_by: 'mem_b' },
    ],
  };
  store.rebuild(index as any);
  const nb = store.getNeighbors(['mem_a'], 5);
  expect(nb.has('mem_b')).toBe(true);
  expect(nb.has('mem_old')).toBe(false);

  // 幂等
  store.rebuild(index as any);
  expect(store.getSharedAnchors('mem_a', 'mem_b')).toBe(1);
});

test('getNeighbors excludes passed unit ids', () => {
  store.upsertUnit('mem_a', ['x']);
  store.upsertUnit('mem_b', ['x']);
  const nb = store.getNeighbors(['mem_a'], 5, new Set(['mem_b']));
  expect(nb.has('mem_b')).toBe(false);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx jest tests/unit/gateway/anchor-graph-store.test.ts --no-coverage`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 建表 DDL（gateway-db.ts）**

在 `gateway/src/memory/gateway-db.ts` 的 `this.db.exec(...)` 块末尾追加：

```typescript
      CREATE TABLE IF NOT EXISTS anchor_units (
        anchor TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        weight REAL DEFAULT 1,
        created_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (anchor, unit_id)
      );
      CREATE INDEX IF NOT EXISTS idx_anchor_units_anchor ON anchor_units(anchor);
      CREATE INDEX IF NOT EXISTS idx_anchor_units_unit ON anchor_units(unit_id);

      CREATE TABLE IF NOT EXISTS anchor_edges (
        unit_a TEXT NOT NULL,
        unit_b TEXT NOT NULL,
        shared_anchors INTEGER NOT NULL,
        weight REAL NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (unit_a, unit_b)
      );
      CREATE INDEX IF NOT EXISTS idx_anchor_edges_a ON anchor_edges(unit_a);
      CREATE INDEX IF NOT EXISTS idx_anchor_edges_b ON anchor_edges(unit_b);
```

- [ ] **Step 4: 实现 AnchorGraphStore**

`gateway/src/graph/anchor-graph-store.ts`:

```typescript
import { GatewayDatabase } from '../memory/gateway-db';
import { IDFStats } from '../retrieval/idf-stats';

export interface AnchorNeighbor {
  weight: number;
  sharedAnchors: number;
}

/**
 * SQLite-backed anchor graph for multi-hop retrieval. Maps cue_anchors →
 * units (anchor_units) and derives unit↔unit edges from shared anchors
 * (anchor_edges). Edge weight = sum of shared anchors' IDF (noisy/hub anchors
 * filtered by IDFStats). Kept in sync by the harmonic file-store write path.
 */
export class AnchorGraphStore {
  private db: GatewayDatabase;
  private idf: IDFStats;

  constructor(db: GatewayDatabase, idf?: IDFStats) {
    this.db = db;
    this.idf = idf ?? new IDFStats();
  }

  private get rawDb(): any {
    return (this.db as any).db;
  }

  private normalizePair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
  }

  upsertUnit(unitId: string, anchors: string[]): void {
    if (!unitId || !Array.isArray(anchors)) return;
    const unique = [...new Set(anchors.filter(a => typeof a === 'string' && a.length > 0))];
    // 删除旧锚点行与旧边（全量重算该单元）
    this.rawDb.prepare('DELETE FROM anchor_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM anchor_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);

    if (unique.length === 0) return;

    // 1. 插入锚点行
    const insAnchor = this.rawDb.prepare('INSERT OR IGNORE INTO anchor_units (anchor, unit_id) VALUES (?, ?)');
    for (const anchor of unique) insAnchor.run(anchor, unitId);

    // 2. 对每个锚点，找共享单元并建边
    const candidates = new Map<string, Set<string>>(); // unitId -> anchors
    const sel = this.rawDb.prepare('SELECT unit_id FROM anchor_units WHERE anchor = ?');
    for (const anchor of unique) {
      if (this.idf.isNoisy(anchor)) continue;
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
      const weight = [...sharedAnchors].reduce((sum, anchor) => sum + this.idf.idf(anchor), 0);
      insEdge.run(a, b, sharedAnchors.size, weight);
    }
  }

  removeUnit(unitId: string): void {
    this.rawDb.prepare('DELETE FROM anchor_units WHERE unit_id = ?').run(unitId);
    this.rawDb.prepare('DELETE FROM anchor_edges WHERE unit_a = ? OR unit_b = ?').run(unitId, unitId);
  }

  getNeighbors(
    unitIds: string[],
    topK: number,
    exclude?: Set<string>,
  ): Map<string, AnchorNeighbor> {
    if (unitIds.length === 0) return new Map();
    const placeholders = unitIds.map(() => '?').join(',');
    const rows = this.rawDb
      .prepare(
        `SELECT unit_a, unit_b, shared_anchors, weight FROM anchor_edges
         WHERE unit_a IN (${placeholders}) OR unit_b IN (${placeholders})
         ORDER BY weight DESC`,
      )
      .all(...unitIds, ...unitIds) as Array<{ unit_a: string; unit_b: string; shared_anchors: number; weight: number }>;

    const result = new Map<string, AnchorNeighbor>();
    for (const row of rows) {
      const nb = row.unit_a === unitIds.find(id => id === row.unit_a) ? row.unit_b : row.unit_a;
      if (unitIds.includes(nb)) continue; // 命中-命中边跳过（非邻居）
      if (exclude?.has(nb)) continue;
      if (result.has(nb)) continue;
      result.set(nb, { weight: row.weight, sharedAnchors: row.shared_anchors });
      if (result.size >= topK) break;
    }
    return result;
  }

  getSharedAnchors(a: string, b: string): number {
    const [x, y] = this.normalizePair(a, b);
    const row = this.rawDb.prepare('SELECT shared_anchors FROM anchor_edges WHERE unit_a = ? AND unit_b = ?').get(x, y) as
      | { shared_anchors: number }
      | undefined;
    return row?.shared_anchors ?? 0;
  }

  rebuild(index: { entries: Array<{ id: string; cue_anchors?: string[]; superseded_by?: string }> }): void {
    this.clear();
    for (const entry of index.entries) {
      if (entry.superseded_by) continue;
      this.upsertUnit(entry.id, entry.cue_anchors ?? []);
    }
  }

  clear(): void {
    this.rawDb.prepare('DELETE FROM anchor_edges').run();
    this.rawDb.prepare('DELETE FROM anchor_units').run();
  }
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest tests/unit/gateway/anchor-graph-store.test.ts --no-coverage`
Expected: PASS（6 个测试）

- [ ] **Step 6: 提交**

```bash
git add gateway/src/graph/anchor-graph-store.ts gateway/src/memory/gateway-db.ts tests/unit/gateway/anchor-graph-store.test.ts
git commit -m "feat(memory): AnchorGraphStore with SQLite anchor_units/anchor_edges tables"
```

---

### Task 2: 网关 — 写路径增量接线 + 启动重建

**Files:**
- Modify: `gateway/src/memory/harmonic-file-store.ts`（写路径 upsertUnit/removeUnit）
- Modify: `gateway/src/index.ts`（initServices 装配 AnchorGraphStore + rebuild）
- Test: `tests/unit/memory-quality.test.ts`（扩展：写记忆后图有边）

**Interfaces:**
- Consumes: `AnchorGraphStore`（Task 1）
- Produces: `HarmonicUnitFileStore` 构造可选 `anchorGraphStore?: AnchorGraphStore`；`write/markSuperseded/delete` 内同步图更新；gateway `initServices` 创建 `AnchorGraphStore` + `rebuild`（try/catch 降级）

- [ ] **Step 1: 写失败测试（扩展 memory-quality.test.ts）**

在 `tests/unit/memory-quality.test.ts` 末尾追加：

```typescript
describe('anchor graph write-path integration', () => {
  it('write() upserts anchor edges for the new unit', async () => {
    const store = new HarmonicUnitFileStore(tmpDir);
    const u1 = { id: 'mem_g1', type: 'semantic', primary_abstraction: 'Project Orion timeline agreed by Dave', cue_anchors: ['project-orion', 'dave'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any;
    await store.write(u1);
    const u2 = { id: 'mem_g2', type: 'semantic', primary_abstraction: 'Dave works on prototype', cue_anchors: ['project-orion', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any;
    await store.write(u2);
    // 通过检索验证：query 只匹配 u1，但图扩展应把 u2（共享 project-orion）带入候选
    const results = store.indexManager_().search('Project Orion timeline agreed by Dave', 5, { retriever: 'bm25', graphExpand: true });
    expect(results.map(r => r.id)).toContain('mem_g2');
  });

  it('markSuperseded removes old unit from the graph', async () => {
    const store = new HarmonicUnitFileStore(tmpDir);
    const u1 = { id: 'mem_s1', type: 'semantic', primary_abstraction: 'JWT auth config', cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.7, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any;
    await store.write(u1);
    const u2 = { id: 'mem_s2', type: 'semantic', primary_abstraction: 'JWT auth config updated', cue_anchors: ['jwt'], memory_value: 'v2', energy: 0.8, created_at: '2025-02-01T00:00:00.000Z', updated_at: '2025-02-01T00:00:00.000Z' } as any;
    await store.write(u2); // 触发合并 → mem_s1 superseded + 移图
    const results = store.indexManager_().search('JWT auth', 5, { retriever: 'bm25' });
    expect(results.some(r => r.id === 'mem_s1')).toBe(false); // superseded 已被图排除且 bm25 惩罚
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/memory-quality.test.ts --no-coverage`
Expected: FAIL（`graphExpand` 未知、图未接线）

- [ ] **Step 3: harmonic-file-store 接线**

`gateway/src/memory/harmonic-file-store.ts`：

构造加可选参数：

```typescript
  constructor(
    private baseDir: string,
    indexManager?: HarmonicIndexManager,
    private anchorGraphStore?: AnchorGraphStore,
  ) {
```

write 方法内（`this.indexManager.addEntry(...)` 之后、linkRegex 之前）加：

```typescript
      try {
        this.anchorGraphStore?.upsertUnit(targetUnit.id, targetUnit.cue_anchors ?? []);
      } catch (err: any) {
        // 图更新失败不影响记忆写入（降级）
      }
```

markSuperseded 方法内（标记成功后）加：

```typescript
    try { this.anchorGraphStore?.removeUnit(id); } catch { /* non-fatal */ }
```

deleteSync / delete 方法内（移除成功后）加：

```typescript
    try { this.anchorGraphStore?.removeUnit(id); } catch { /* non-fatal */ }
```

- [ ] **Step 4: index.ts 装配 + 启动重建**

`gateway/src/index.ts` 的 initServices（trajectory 初始化附近）加：

```typescript
    // Anchor graph for multi-hop retrieval (SQLite-backed, write-path synced).
    try {
      const { AnchorGraphStore } = require('./graph/anchor-graph-store');
      const anchorStore = new AnchorGraphStore(this.getGatewayDb());
      anchorStore.rebuild(this.memoryService?.harmonicIndex.getIndex() ?? { entries: [] });
      this.anchorGraphStore = anchorStore;
      log.info('[AnchorGraph] store initialized & rebuilt');
    } catch (err: any) {
      log.warn(`[AnchorGraph] init failed (non-fatal): ${err.message}`);
    }
```

类字段（trajectoryStore 附近）加：

```typescript
  private anchorGraphStore: import('./graph/anchor-graph-store').AnchorGraphStore | null = null;
```

装配到 HarmonicIndexManager（index.ts 中创建 harmonicIndex 处或 getGatewayDb 之后；注意 MemoryService 构造在 initServices 内，需在其后注入）：

```typescript
    if (this.anchorGraphStore) {
      this.memoryService!.harmonicIndex.setAnchorGraphStore(this.anchorGraphStore);
    }
```

- [ ] **Step 5: HarmonicIndexManager 加注入点（Task 3 的接口预留）**

`gateway/src/core/memory/harmonic-index.ts` 加：

```typescript
import type { AnchorGraphStore } from '../../graph/anchor-graph-store';

  private anchorGraphStore: AnchorGraphStore | null = null;

  setAnchorGraphStore(store: AnchorGraphStore | null): void {
    this.anchorGraphStore = store;
  }
```

- [ ] **Step 6: 跑测试**

Run: `npx jest tests/unit/memory-quality.test.ts tests/unit/gateway/anchor-graph-store.test.ts --no-coverage`
Expected: PASS（新增 2 个集成测试）

注意：测试里 `HarmonicUnitFileStore(tmpDir)` 没传 anchorGraphStore → 集成测试的"图扩展带出 mem_g2"会失败！需要让 store 构造时**自建**（若有 db 则用，否则跳过）。调整：HarmonicUnitFileStore 构造时若未传 anchorGraphStore 且无 db，测试里手动建。改为在测试里显式装配：

```typescript
// 测试辅助：带图装配的 store
function makeStoreWithGraph(baseDir: string): { store: HarmonicUnitFileStore; graph: AnchorGraphStore } {
  const db = new GatewayDatabase(path.join(baseDir, 'gateway.db'));
  const graph = new AnchorGraphStore(db);
  const store = new HarmonicUnitFileStore(baseDir, undefined, graph);
  return { store, graph };
}
```

用 `makeStoreWithGraph(tmpDir)` 替换上述测试里的 `new HarmonicUnitFileStore(tmpDir)`。

- [ ] **Step 7: 提交**

```bash
git add gateway/src/memory/harmonic-file-store.ts gateway/src/index.ts gateway/src/core/memory/harmonic-index.ts tests/unit/memory-quality.test.ts
git commit -m "feat(memory): wire AnchorGraphStore into write path + startup rebuild"
```

---

### Task 3: 网关 — searchScored 图扩展 + 融合

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts`（searchScored 扩展 + SearchOptions）
- Modify: `gateway/src/config.ts`（search.graph 配置段）
- Test: `tests/unit/memory-quality.test.ts`（图扩展检索、阻尼、关闭开关）

**Interfaces:**
- Consumes: `AnchorGraphStore.getNeighbors`（Task 1）、`config.search.graph`（本 Task 定义）
- Produces: `SearchOptions` 扩展 `{ graphExpand?: boolean; maxHops?: number; graphMaxNeighbors?: number; graphDamping?: number }`；`searchScored` 内图扩展融合；`HeuristicReranker` 支持 graph 信号（可选，reranker 开启时）

- [ ] **Step 1: 写失败测试（memory-quality.test.ts 扩展）**

```typescript
describe('graph multi-hop retrieval', () => {
  function makeGraphStore() {
    const db = new GatewayDatabase(path.join(tmpDir, 'gw-graph.db'));
    const graph = new AnchorGraphStore(db);
    return { db, graph };
  }

  it('expands neighbors into results with damping', async () => {
    const { db, graph } = makeGraphStore();
    const store = new HarmonicUnitFileStore(tmpDir, undefined, graph);
    await store.write({ id: 'mh_a', type: 'semantic', primary_abstraction: 'Project Orion timeline agreed by Dave and Sarah', cue_anchors: ['project-orion', 'dave'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    await store.write({ id: 'mh_b', type: 'semantic', primary_abstraction: 'Prototype pushed to April 1', cue_anchors: ['project-orion', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any);
    await store.write({ id: 'mh_c', type: 'semantic', primary_abstraction: 'Unrelated recipe for pasta', cue_anchors: ['cooking'], memory_value: 'v3', energy: 0.8, created_at: '2025-01-03T00:00:00.000Z', updated_at: '2025-01-03T00:00:00.000Z' } as any);

    const results = store.indexManager_().search('Project Orion timeline', 5, { retriever: 'bm25', graphExpand: true });
    const ids = results.map(r => r.id);
    expect(ids[0]).toBe('mh_a');          // 直接命中第一
    expect(ids).toContain('mh_b');        // 图邻居进入
    expect(ids).not.toContain('mh_c');    // 无关不进
  });

  it('graphExpand=false returns baseline behavior (no expansion)', async () => {
    const { db, graph } = makeGraphStore();
    const store = new HarmonicUnitFileStore(tmpDir, undefined, graph);
    await store.write({ id: 'mh2_a', type: 'semantic', primary_abstraction: 'Project Orion timeline agreed by Dave', cue_anchors: ['project-orion', 'dave'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    await store.write({ id: 'mh2_b', type: 'semantic', primary_abstraction: 'Prototype pushed to April 1', cue_anchors: ['project-orion', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any);

    const withGraph = store.indexManager_().search('Project Orion timeline', 5, { retriever: 'bm25', graphExpand: true });
    const withoutGraph = store.indexManager_().search('Project Orion timeline', 5, { retriever: 'bm25', graphExpand: false });
    expect(withGraph.map(r => r.id)).toContain('mh2_b');
    expect(withoutGraph.map(r => r.id)).not.toContain('mh2_b'); // bm25 不直接命中 b
  });

  it('works without graph store (isolated env behaves as before)', () => {
    const store = new HarmonicUnitFileStore(tmpDir);
    store.write({ id: 'iso1', type: 'semantic', primary_abstraction: 'some unique memory about zzz', cue_anchors: [], memory_value: 'v', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    const results = store.indexManager_().search('some unique memory about zzz', 5, { retriever: 'bm25', graphExpand: true });
    expect(results.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/memory-quality.test.ts --no-coverage`
Expected: FAIL（graphExpand 未实现）

- [ ] **Step 3: config 加 search.graph**

`gateway/src/config.ts` 的 `search` 段加：

```typescript
    /** Anchor-graph multi-hop expansion (Memora-style). */
    graph: {
      enabled: boolean;
      maxHops: number;
      maxNeighbors: number;
      damping: number;
      candidateCap: number;
      rerankGraphWeight: number;
    };
```

默认值（DEFAULTS 段 search 内加）：

```typescript
      graph: {
        enabled: true,
        maxHops: 1,
        maxNeighbors: 3,
        damping: 0.6,
        candidateCap: 50,
        rerankGraphWeight: 0.15,
      },
```

- [ ] **Step 4: 实现 searchScored 图扩展**

`gateway/src/core/memory/harmonic-index.ts`：

SearchOptions 扩展：

```typescript
export interface SearchOptions {
  retriever?: 'token' | 'bm25';
  /** Drop results below topScore × cutoffRatio after retrieval (0 = disabled). */
  cutoffRatio?: number;
  /** Anchor-graph multi-hop expansion (default true when a graph store is attached). */
  graphExpand?: boolean;
  maxHops?: number;
  graphMaxNeighbors?: number;
  graphDamping?: number;
}
```

searchScored 重写（核心逻辑）：

```typescript
  searchScored(query: string, topK: number = 20, options: SearchOptions = {}): ScoredEntry[] {
    const retriever = options.retriever ?? 'bm25';
    const recallK = config.search.recallK || 50;
    let scored: ScoredEntry[];
    if (retriever === 'bm25') {
      scored = this.bm25SearchScored(query, recallK);
    } else {
      scored = this.tokenSearchScored(query, recallK);
    }

    // ── Anchor-graph multi-hop expansion (Memora-style) ──
    const graphExpand = options.graphExpand ?? config.search.graph.enabled;
    if (graphExpand && this.anchorGraphStore && scored.length > 0) {
      const maxHops = options.maxHops ?? config.search.graph.maxHops;
      const damping = options.graphDamping ?? config.search.graph.damping;
      const maxNeighbors = options.graphMaxNeighbors ?? config.search.graph.maxNeighbors;
      const candidateCap = config.search.graph.candidateCap;
      const byId = new Map(scored.map(s => [s.entry.id, s]));
      let hop = 1;
      while (hop <= maxHops && byId.size < candidateCap) {
        const frontier = [...byId.keys()];
        const exclude = new Set(byId.keys());
        let expanded = false;
        for (const id of frontier) {
          const neighbors = this.anchorGraphStore.getNeighbors([id], maxNeighbors, exclude);
          for (const [nbId, info] of neighbors) {
            const nbEntry = this.index.entries.find(e => e.id === nbId);
            if (!nbEntry || nbEntry.superseded_by) continue;
            const graphScore = info.weight * (nbEntry.energy ?? 0.8) * (nbEntry.salience ?? 1) * Math.pow(damping, hop);
            const existing = byId.get(nbId);
            if (!existing) {
              byId.set(nbId, { entry: nbEntry, score: graphScore, graphScore });
              expanded = true;
            } else if ((existing as any).graphScore === undefined || (existing as any).graphScore < graphScore) {
              (existing as any).graphScore = graphScore;
              expanded = true;
            }
          }
        }
        if (!expanded) break;
        hop++;
      }
      // 融合：bm25 分归一化 + graph 分归一化加权
      const graphWeight = config.search.graph.rerankGraphWeight;
      const entries = [...byId.values()];
      const bm25Scores = entries.map(e => e.score);
      const graphScores = entries.map(e => (e as any).graphScore ?? 0);
      const norm = (vals: number[]) => {
        const min = Math.min(...vals), max = Math.max(...vals);
        if (max === min) return vals.map(() => 0.5);
        return vals.map(v => (v - min) / (max - min));
      };
      const nb = norm(bm25Scores), ng = norm(graphScores);
      scored = entries.map((e, i) => ({
        entry: e.entry,
        score: (1 - graphWeight) * nb[i] + graphWeight * ng[i],
      }));
      scored.sort((a, b) => b.score - a.score);
    }

    // 可选 reranker（config.search.reranker 开启时）
    if (config.search.reranker !== 'off' && scored.length > 0) {
      const reranker = this.getReranker();
      if (reranker) {
        // 同步封装：reranker 是 async，这里 fire-and-forget 不适用 —— 用同步 heuristic 路径
        // （cross-encoder 异步，此处仅 heuristic 内联；异步走调用方）
      }
    }

    const cutoffRatio = options.cutoffRatio ?? 0;
    if (cutoffRatio > 0 && scored.length > 0) {
      const threshold = scored[0].score * cutoffRatio;
      scored = scored.filter(s => s.score >= threshold);
    }

    scored = scored.slice(0, topK);

    this.hookManager?.execute('memory.recall', {
      query,
      resultIds: scored.map(r => r.entry.id),
      source: retriever === 'bm25' ? 'HarmonicIndexManager.bm25Search' : 'HarmonicIndexManager.search'
    });

    return scored;
  }
```

注意：`config` 需 import（harmonic-index.ts 当前未 import config）——加 `import { config } from '../../config';`。

reranker 接线：为保持简单，本次仅实现 heuristic reranker 内联（若 config.search.reranker==='heuristic'），cross-encoder 留给调用方（LongMemEval 已支持）。在融合后加：

```typescript
    // 可选 heuristic reranker（config.search.reranker === 'heuristic'）
    if (config.search.reranker === 'heuristic' && scored.length > 0) {
      const { HeuristicReranker } = require('./reranker');
      const reranker = new HeuristicReranker({
        weights: config.search.rerankWeights,
        cutoffRatio: config.search.cutoffRatio,
      });
      const reranked = reranker.rerank(query, scored, topK);
      // heuristic reranker 返回 { entry, score }，score 为 fusedScore
      scored = reranked;
      if (config.search.cutoffRatio > 0 && reranked.length > 0) {
        const threshold = reranked[0].score * config.search.cutoffRatio;
        scored = reranked.filter(s => s.score >= threshold);
      }
      scored = scored.slice(0, topK);
    }
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest tests/unit/memory-quality.test.ts tests/unit/gateway/anchor-graph-store.test.ts tests/unit/harmonic-index.test.ts --no-coverage`
Expected: PASS（新增 3 个图检索测试 + 现有全过）

注意：`scored.sort` 前需保证 `score` 是融合值——原 bm25 的 `score` 保留，融合后替换。测试断言 `ids[0] === 'mh_a'`（直接命中）需确认融合后仍第一——若 graph 分把 mh_b 抬到第一则改断言（以实际行为为准，但"直接命中优先"是预期）。

- [ ] **Step 6: 提交**

```bash
git add gateway/src/core/memory/harmonic-index.ts gateway/src/config.ts tests/unit/memory-quality.test.ts
git commit -m "feat(memory): multi-hop anchor-graph expansion in searchScored with bm25 fusion"
```

---

### Task 4: LongMemEval L1 门禁验证 + 回退

**Files:**
- 无源码改动（验证任务）

**Interfaces:**
- Consumes: Task 1-3 全部

- [ ] **Step 1: 重建 gateway 并跑基线（若无缓存）**

Run: `npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25`
Expected: overall R10=0.949 / R1=0.586（与历史一致；若隔离 store 无图 → 应与基线完全相同，验证"无图行为不变"）

- [ ] **Step 2: 验证生产装配后的图扩展不影响隔离基准**

隔离 LongMemEval 用 `new HarmonicUnitFileStore(tmpDir)`（无 anchorGraphStore）→ `searchScored` 的 `this.anchorGraphStore` 为 null → 图扩展跳过 → 结果应与 Step 1 完全一致（R10=0.949）。

- [ ] **Step 3: 手动验证生产图扩展（真实记忆库）**

Run: 用 node 脚本对真实 `~/.mafw` 索引做一次带图检索，对比 `graphExpand:true/false`：

```bash
node -e "
const { HarmonicIndexManager } = require('./gateway/dist/core/memory/harmonic-index');
const os = require('os'), path = require('path');
const manager = new HarmonicIndexManager(path.join(os.homedir(), '.mafw'));
// 无图 store（生产装配在 gateway 进程内）；此处验证隔离行为
const r1 = manager.search('Project Orion timeline', 5, { retriever: 'bm25', graphExpand: true });
console.log('graphExpand=true:', r1.map(e => e.id));
const r2 = manager.search('Project Orion timeline', 5, { retriever: 'bm25', graphExpand: false });
console.log('graphExpand=false:', r2.map(e => e.id));
"
```

- [ ] **Step 4: 门禁判定**

- 若隔离基准 R10 ≥ 0.949：通过（图扩展不破坏检索）
- 若 < 0.949：检查是否图扩展意外介入（`this.anchorGraphStore` 非 null）→ 确认隔离 store 无图注入
- 生产真实记忆库图扩展收益：对比 r1/r2 是否 r1 多出相关记忆（如 multi-session 相关条目）

- [ ] **Step 5: 提交（如无代码改动则仅记录）**

```bash
git add docs/superpowers/specs/2026-08-20-anchor-graph-multihop-retrieval.md
git commit -m "docs: anchor-graph multi-hop retrieval L1 gate verification"
```

---

## Self-Review

**Spec 覆盖检查：**
- §3 数据模型（两表）→ Task 1
- §4 写路径增量 + 启动重建 → Task 2
- §5 检索链图扩展 + reranker 融合 → Task 3
- §6 配置 search.graph → Task 3
- §7 验证门禁（L1 R10≥0.949）+ 单测 + 回退 → Task 4 + 各 Task 测试
- §8 里程碑 → 任务顺序即里程碑

**类型一致性：**
- `AnchorGraphStore` 方法签名：`upsertUnit/removeUnit/getNeighbors/rebuild/clear/getSharedAnchors` — Task 1/2/3 一致
- `SearchOptions`：`graphExpand/maxHops/graphMaxNeighbors/graphDamping` — Task 3 定义与使用一致
- `config.search.graph`：`enabled/maxHops/maxNeighbors/damping/candidateCap/rerankGraphWeight` — Task 3 一致
- `HarmonicIndexManager.setAnchorGraphStore(store | null)` — Task 2 定义、Task 3 使用
- `getNeighbors(unitIds, topK, exclude?)` 返回 `Map<string, {weight, sharedAnchors}>` — 一致

**已知注意点（实现时留意，不阻塞）：**
- Task 2 集成测试需显式装配 graph（`makeStoreWithGraph` helper），否则隔离 store 无图导致测试失败——Step 6 已注明
- Task 3 融合后 `scored[0]` 是否仍是直接命中取决于 graph 权重——若测试断言失败，以"直接命中优先"为准微调融合权重或断言
- `harmonic-index.ts` 需 import `config`（当前未 import）
- reranker 仅 heuristic 内联；cross-encoder 仍由 LongMemEval 显式调用（保持基准可比）
