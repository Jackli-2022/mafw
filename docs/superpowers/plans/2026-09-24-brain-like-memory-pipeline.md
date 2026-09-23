# 脑式记忆管线重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把记忆写入路径从「append」改为脑式「写时路由 + 回放整合」，治 21.5% 近似重复，并补齐回放/分离/再巩固机制。

**Architecture:** 五个独立切片（S1 写时路由 → S4 模式分离 → S3 编码门控 → S2 回放采样 → S5 再巩固），均复用现有 `EmbeddingRuntime`（向量）+ `ConsolidationService`（LLM 判官）+ `HarmonicUnitFileStore`（写入），通过 deps 注入保持纯函数可测。

**Tech Stack:** TypeScript (gateway, CJS build via tsc), Jest (`npx jest --runInBand`), better-sqlite3 (gateway.db), ONNX/llamacpp embeddings。

## Global Constraints

- 所有新模块必须 deps 注入、纯逻辑可测；LLM/嵌入不可用时 **fail-open**（回退 create，绝不阻塞或丢写）。
- 不改 OKF 存储格式；不改 `HarmonicUnit` 既有字段语义（只新增可选字段）。
- 不改 100ms 边界 recall 契约（`/api/recall/context`）。
- 测试文件放 `gateway/tests/unit/`（或子目录），命名 `*.test.ts`；命令 `npx jest --runInBand`（在 `gateway/` 目录）。
- 每个 task 独立 commit；commit message 用 `feat(gateway): ...` / `fix(gateway): ...`。
- 新增配置项一律带默认值，缺省行为等价现状（回滚安全）。
- 部署链（S1 之后）：根 `npm run build` → `npx jest` → 根 `npm pack` → `npm install -g <tgz>` → `mafw restart`。

---

## File Structure

**新增**
- `gateway/src/memory/route-write.ts` — 三态路由决策 + 应用（S1）
- `gateway/src/memory/schema-clusters.ts` — 嵌入聚类 + 簇代表（S2）
- `gateway/src/recall/replay-sampling.ts` — 回放优先级纯函数（S2）
- `gateway/src/recall/obs-salience.ts` — 观测显著度纯函数（S3）
- `gateway/src/recall/reconsolidation.ts` — 再巩固队列 + 预测误差门（S5）

**修改**
- `gateway/src/memory/consolidation-service.ts` — 判官三值（S4）+ 复用 route-write
- `gateway/src/mcp/handlers/add-memory.ts` — 写前路由（S1）
- `gateway/src/index.ts` — HTTP add 路由 + wiring + stats（S1/S3/S5）
- `gateway/src/recall/reflection.ts` — 写前路由（S1）
- `gateway/src/recall/turn-pipeline.ts` — 采样 + 交错 + 再巩固消费（S2/S5）
- `gateway/src/memory/gateway-db.ts` — obs.salience 列 + reconsolidation_queue 表（S3/S5）
- `gateway/src/core/memory/harmonic-types.ts` — `distinct_from` 字段（S4）
- `gateway/src/config.ts` — dupCosine / 簇 / τ / 权重（S1-S3）

---

## Phase S1：写时路由（Write-Time Routing）

> 覆盖 spec `2026-09-24-write-time-routing-design.md`。产出：写入前判定 skip/create/update，近似重复整合、精确重复不落盘。

### Task S1.1: 三态路由纯函数

**Files:**
- Create: `gateway/src/memory/route-write.ts`
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Consumes: `MemoryVectorStore`（`upsert/get/searchByCosine/remove`）、`EmbeddingProvider`（`embed(texts,kind)`）、`EmbeddingIndexer.documentText(unit)`
- Produces:
  ```ts
  type RoutingOutcome =
    | { action: 'skip'; targetId: string }
    | { action: 'create' }
    | { action: 'update'; targetId: string };
  interface RouteWriteDeps {
    vectors: MemoryVectorStore;
    provider: EmbeddingProvider;
    judge: (unit: HarmonicUnit, candidateIds: string[]) => Promise<{ action: 'create' | 'update'; targetId?: string } | null>;
    candidateCosine?: number; // θ_cand, default 0.8
    dupCosine?: number;       // θ_dup, default 0.95
    maxCandidates?: number;   // default 3
  }
  async function decideRouting(unit: HarmonicUnit, deps: RouteWriteDeps): Promise<RoutingOutcome>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { decideRouting } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-route-')); }
function u(id: string): HarmonicUnit {
  return { id, type: 'semantic', primary_abstraction: id, cue_anchors: [], memory_value: id,
    energy: 0.8, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as HarmonicUnit;
}
const provider: EmbeddingProvider = { name: 'stub', dims: 2, embed: async (t) => t.map(() => [1, 0]) };

test('no candidates → create (no judge call)', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('x', [0, 1]);
  let judged = 0;
  const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged++; return null; } });
  expect(out.action).toBe('create');
  expect(judged).toBe(0);
});

test('cos >= dupCosine → skip with targetId (no judge call)', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('dup', [1, 0]);
  let judged = 0;
  const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged++; return null; } });
  expect(out).toEqual({ action: 'skip', targetId: 'dup' });
  expect(judged).toBe(0);
});

test('candidate band → judge update', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.99, 0.14]); // cos ~0.99? -> use 0.9 band
  const out = await decideRouting(u('n1'), {
    vectors: v, provider,
    judge: async (_unit, ids) => ({ action: 'update', targetId: ids[0] }),
  });
  expect(out.action).toBe('update');
  expect((out as any).targetId).toBe('old');
});

test('judge returns create → create', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.9, 0.44]);
  const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => ({ action: 'create' }) });
  expect(out.action).toBe('create');
});

test('judge throws / returns null → fail-open create', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.9, 0.44]);
  const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { throw new Error('x'); } });
  expect(out.action).toBe('create');
});

test('judge target outside candidates → fail-open create', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.9, 0.44]);
  const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => ({ action: 'update', targetId: 'evil' }) });
  expect(out.action).toBe('create');
});

test('superseded candidates are excluded', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [1, 0]);
  const deps = { vectors: v, provider, judge: async () => null,
    isSuperseded: (id: string) => id === 'old' } as any;
  const out = await decideRouting(u('n1'), deps);
  expect(out.action).toBe('create');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/memory/route-write'`

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/memory/route-write.ts
import { HarmonicUnit } from '../core/memory/harmonic-types';
import { MemoryVectorStore, EmbeddingIndexer } from './vector-store';
import { EmbeddingProvider } from './embedding-provider';

export type RoutingOutcome =
  | { action: 'skip'; targetId: string }
  | { action: 'create' }
  | { action: 'update'; targetId: string };

export interface RouteWriteDeps {
  vectors: MemoryVectorStore;
  provider: EmbeddingProvider;
  judge: (unit: HarmonicUnit, candidateIds: string[]) => Promise<{ action: 'create' | 'update'; targetId?: string } | null>;
  candidateCosine?: number;
  dupCosine?: number;
  maxCandidates?: number;
  /** Optional: exclude revoked entries from candidates. */
  isSuperseded?: (id: string) => boolean;
}

export async function decideRouting(unit: HarmonicUnit, deps: RouteWriteDeps): Promise<RoutingOutcome> {
  const thetaCand = deps.candidateCosine ?? 0.8;
  const thetaDup = deps.dupCosine ?? 0.95;
  const maxCand = deps.maxCandidates ?? 3;

  let vector = deps.vectors.get(unit.id);
  if (!vector) {
    try {
      const text = EmbeddingIndexer.documentText(unit);
      if (!text) return { action: 'create' };
      const [vec] = await deps.provider.embed([text], 'document');
      if (!vec) return { action: 'create' };
      deps.vectors.upsert(unit.id, vec);
      vector = vec;
    } catch {
      return { action: 'create' }; // fail-open
    }
  }

  const hits = deps.vectors.searchByCosine(vector, maxCand + 1)
    .filter(h => h.id !== unit.id && !deps.isSuperseded?.(h.id) && h.cosine >= thetaCand);
  if (hits.length === 0) return { action: 'create' };

  const top = hits[0];
  if (top.cosine >= thetaDup) return { action: 'skip', targetId: top.id };

  const candidateIds = hits.slice(0, maxCand).map(h => h.id);
  let verdict: { action: 'create' | 'update'; targetId?: string } | null = null;
  try {
    verdict = await deps.judge(unit, candidateIds);
  } catch {
    return { action: 'create' }; // fail-open
  }
  if (!verdict || verdict.action === 'create') return { action: 'create' };
  if (verdict.targetId && candidateIds.includes(verdict.targetId)) {
    return { action: 'update', targetId: verdict.targetId };
  }
  return { action: 'create' }; // invalid target → fail-open
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/tests/unit/memory/route-write.test.ts
git commit -m "feat(gateway): 三态路由决策纯函数（skip/create/update）"
```

---

### Task S1.2: 路由应用（skip/create/update → 落盘）

**Files:**
- Modify: `gateway/src/memory/route-write.ts`
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Consumes: `decideRouting`（S1.1）
- Produces:
  ```ts
  interface RouteStore {
    read(id: string): Promise<HarmonicUnit | null>;
    write(unit: HarmonicUnit, tier?: string, opts?: { skipMerge?: boolean }): Promise<string>;
    markSuperseded(id: string, byId: string): boolean | void | Promise<void>;
  }
  async function routeAndWrite(unit: HarmonicUnit, store: RouteStore, deps: RouteWriteDeps):
    Promise<{ action: 'skip' | 'create' | 'update'; id: string; targetId?: string }>
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { routeAndWrite } from '../../../src/memory/route-write';

function memStore(units: HarmonicUnit[]) {
  const byId = new Map(units.map(x => [x.id, x]));
  const writes: HarmonicUnit[] = [];
  const superseded: Array<{ id: string; byId: string }> = [];
  return { byId, writes, superseded,
    async read(id: string) { return byId.get(id) ?? null; },
    async write(x: HarmonicUnit) { byId.set(x.id, x); writes.push(x); return 'f.md'; },
    async markSuperseded(id: string, by: string) { superseded.push({ id, byId: by }); } };
}

test('create → writes unit, returns own id', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  const s = memStore([]);
  const out = await routeAndWrite(u('n1'), s as any, { vectors: v, provider, judge: async () => null });
  expect(out).toEqual({ action: 'create', id: 'n1' });
  expect(s.writes.map(w => w.id)).toEqual(['n1']);
});

test('skip → no write, returns existing id', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('dup', [1, 0]);
  const s = memStore([u('dup')]);
  const out = await routeAndWrite(u('n1'), s as any, { vectors: v, provider, judge: async () => null });
  expect(out).toEqual({ action: 'skip', id: 'dup', targetId: 'dup' });
  expect(s.writes).toHaveLength(0);
});

test('update → merges into newer, supersedes target', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.9, 0.44]);
  const s = memStore([u('old')]);
  const out = await routeAndWrite(u('n1'), s as any, {
    vectors: v, provider, judge: async (_x, ids) => ({ action: 'update', targetId: ids[0] }),
  });
  expect(out).toEqual({ action: 'update', id: 'n1', targetId: 'old' });
  expect(s.writes.map(w => w.id)).toEqual(['n1']);
  expect(s.superseded).toEqual([{ id: 'old', byId: 'n1' }]);
  expect(s.writes[0].merged_from).toContain('old');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand -t "routeAndWrite"`
Expected: FAIL — `routeAndWrite is not a function`

- [ ] **Step 3: Write minimal implementation**（append to `route-write.ts`）

```ts
export interface RouteStore {
  read(id: string): Promise<HarmonicUnit | null>;
  write(unit: HarmonicUnit, tier?: string, opts?: { skipMerge?: boolean }): Promise<string>;
  markSuperseded(id: string, byId: string): boolean | void | Promise<void>;
}

export async function routeAndWrite(
  unit: HarmonicUnit, store: RouteStore, deps: RouteWriteDeps,
): Promise<{ action: 'skip' | 'create' | 'update'; id: string; targetId?: string }> {
  const decision = await decideRouting(unit, deps);
  if (decision.action === 'skip') return { action: 'skip', id: decision.targetId, targetId: decision.targetId };
  if (decision.action === 'create') {
    await store.write(unit);
    return { action: 'create', id: unit.id };
  }
  // update: merge new content over the existing target, supersede the target
  const target = await store.read(decision.targetId);
  if (!target) {
    await store.write(unit);
    return { action: 'create', id: unit.id };
  }
  const merged: HarmonicUnit = {
    ...unit,
    memory_value: `${unit.memory_value}\n---\n[Updated ${new Date().toISOString()}] ${target.memory_value}`,
    cue_anchors: dedupeCap([...(unit.cue_anchors || []), ...(target.cue_anchors || [])], 8),
    merged_from: [...(unit.merged_from || []), target.id],
    energy: Math.min(1, (unit.energy ?? 0.8) + 0.15),
    updated_at: new Date().toISOString(),
  };
  await store.write(merged, undefined, { skipMerge: true });
  await store.markSuperseded(target.id, merged.id);
  deps.vectors.remove(target.id);
  deps.vectors.flush();
  return { action: 'update', id: merged.id, targetId: target.id };
}

function dedupeCap(items: string[], cap: number): string[] {
  const out: string[] = [];
  for (const it of items) { if (it && !out.includes(it)) out.push(it); if (out.length >= cap) break; }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand`
Expected: PASS (10 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/tests/unit/memory/route-write.test.ts
git commit -m "feat(gateway): routeAndWrite 应用层（skip/create/update 落盘）"
```

---

### Task S1.3: 路由 deps 单例 + config

**Files:**
- Modify: `gateway/src/memory/route-write.ts`（新增单例）
- Modify: `gateway/src/config.ts`（`memory.embedding.dupCosine`）
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Produces: `setRouteWriteDeps(deps: RouteWriteDeps | null)`, `getRouteWriteDeps(): RouteWriteDeps | null`

- [ ] **Step 1: Write the failing test**

```ts
import { setRouteWriteDeps, getRouteWriteDeps } from '../../../src/memory/route-write';

test('route deps singleton set/get', () => {
  setRouteWriteDeps({ vectors: null as any, provider: null as any, judge: async () => null });
  expect(getRouteWriteDeps()).not.toBeNull();
  setRouteWriteDeps(null);
  expect(getRouteWriteDeps()).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand -t "singleton"`
Expected: FAIL — `setRouteWriteDeps is not a function`

- [ ] **Step 3: Write minimal implementation**（append to `route-write.ts`）

```ts
let routeDeps: RouteWriteDeps | null = null;
export function setRouteWriteDeps(deps: RouteWriteDeps | null): void { routeDeps = deps; }
export function getRouteWriteDeps(): RouteWriteDeps | null { return routeDeps; }
```

在 `config.ts` 的 `memory.embedding` 接口与默认值加：
```ts
// interface:
dupCosine: number;
// defaults:
dupCosine: 0.95,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/route-write.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/src/config.ts gateway/tests/unit/memory/route-write.test.ts
git commit -m "feat(gateway): 路由 deps 单例 + dupCosine 配置"
```

---

### Task S1.4: add-memory / HTTP add 接线

**Files:**
- Modify: `gateway/src/mcp/handlers/add-memory.ts:98`
- Modify: `gateway/src/index.ts`（HTTP `/api/memory/add` 写路径 + wiring）
- Test: `gateway/tests/unit/memory/add-memory-routing.test.ts`

**Interfaces:**
- Consumes: `getRouteWriteDeps`, `routeAndWrite`
- Produces: `mafw_add_memory` 返回体新增 `deduped?: boolean` / `updated?: string`

- [ ] **Step 1: Write the failing test**

```ts
// 直接测 handler，注入内存 store + stub deps（用 jest.mock 替换 dynamic import 的 store）
import { handleAddMemory } from '../../../src/mcp/handlers/add-memory';
import { setRouteWriteDeps } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';

test('duplicate write is deduped (not persisted twice)', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('existing', [1, 0]);
  setRouteWriteDeps({ vectors: v, provider: { name: 's', dims: 2, embed: async t => t.map(() => [1, 0]) },
    judge: async () => null });
  const res: any = await handleAddMemory(
    { content: 'same content', memoryType: 'semantic', cueAnchors: [], primaryAbstraction: 'same', importance: 5 },
    { mafwDir: tmp() } as any,
  );
  const body = JSON.parse(res.content[0].text);
  expect(body.success).toBe(true);
  expect(body.deduped).toBe(true);
  setRouteWriteDeps(null);
});
```

> 注：handler 内部 `new HarmonicUnitFileStore` 用真实 fs（tmp 隔离）。测试断言返回体 `deduped`。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/add-memory-routing.test.ts --runInBand`
Expected: FAIL — 返回体无 `deduped`

- [ ] **Step 3: Write minimal implementation**

`add-memory.ts`：在 `await store.write(unit as any);` 前插入路由（替换该行）：
```ts
import { getRouteWriteDeps, routeAndWrite } from '../../memory/route-write';
// ...
const routeDeps = getRouteWriteDeps();
if (routeDeps) {
  const routed = await routeAndWrite(unit as any, store as any, routeDeps);
  return { content: [{ type: "text", text: JSON.stringify({
    success: true,
    id: routed.id,
    tier: 'memories',
    deduped: routed.action === 'skip' ? true : undefined,
    updated: routed.action === 'update' ? routed.targetId : undefined,
    superseded: supersededIds.length > 0 ? supersededIds : undefined,
  }) }] };
}
await store.write(unit as any);
```
（无 routeDeps → 保持现状，回滚安全。）

`index.ts`：在 `initEmbeddingServices` 成功后构建并 `setRouteWriteDeps({...})`（vectors/provider 来自 `getEmbeddingRuntime()`；judge 用 completion 通道或直连 HTTP，复用 `ConsolidationService` 的 judge 逻辑——抽 `makeConsolidationJudge(...)` 到 `consolidation-service.ts` 供两处共用）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/add-memory-routing.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/add-memory.ts gateway/src/index.ts gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/add-memory-routing.test.ts
git commit -m "feat(gateway): mafw_add_memory 写前路由（dedup/update）"
```

---

### Task S1.5: reflection 接线

**Files:**
- Modify: `gateway/src/recall/reflection.ts:300`
- Test: `gateway/tests/unit/reflection-routing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { ReflectionPipeline } from '../../src/recall/reflection';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { ReflectCursor } from '../../src/recall/reflect-cursor';
import { setRouteWriteDeps } from '../../src/memory/route-write';
import { MemoryVectorStore } from '../../src/memory/vector-store';

test('reflection dedups an insight duplicating an existing semantic memory', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-refl-route-'));
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  index.addEntry({ id: 'exist', type: 'semantic', primary_abstraction: 'deploy region',
    cue_anchors: ['deploy'], tier: 'semantic', energy: 0.8, created_at: now } as any, 'semantic');
  index.addEntry({ id: 'ep1', type: 'episodic', primary_abstraction: 'we deployed',
    cue_anchors: [], tier: 'episodic', energy: 0.8, source_session_id: 's1', created_at: now } as any, 'episodic');

  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  v.upsert('exist', [1, 0]);
  setRouteWriteDeps({ vectors: v, provider: { name: 's', dims: 2, embed: async t => t.map(() => [1, 0]) },
    judge: async () => null });

  const worker = { prompt: async () =>
    JSON.stringify({ insights: [{ category: 'insight', content: 'deploy region', cue_anchors: ['deploy'] }] }) };
  const cursor = new ReflectCursor(/* 见 src/recall/reflect-cursor.ts 构造签名 */ undefined as any);
  const pipe = new ReflectionPipeline({ index, baseDir: dir, workerFor: () => worker as any, cursor });

  const before = index.getIndex().entries.length;
  await pipe.runSession('s1');
  expect(index.getIndex().entries.length).toBe(before); // deduped → no new entry
  setRouteWriteDeps(null);
});
```

> 若 `ReflectCursor` 构造需要 gateway.db，用其现有单测里的内存桩（参考 `gateway/tests/unit/` 下 reflect-cursor 相关测试）。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/reflection-routing.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`reflection.ts` 的 `reflectSession` 写循环（`await this.store.write(unit);`）改为：
```ts
const routeDeps = getRouteWriteDeps();
if (routeDeps) {
  const routed = await routeAndWrite(unit, this.store as any, routeDeps);
  if (routed.action === 'skip') result.deduped++;
  else result.distilled++;
} else {
  await this.store.write(unit);
  result.distilled++;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/reflection-routing.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/reflection.ts gateway/tests/unit/reflection-routing.test.ts
git commit -m "feat(gateway): reflection 写前路由"
```

---

### Task S1.6: 修复 under-firing（共享索引 + stats 持久化）

**Files:**
- Modify: `gateway/src/index.ts:1211-1228`（共享 store + stats）
- Modify: `gateway/src/memory/consolidation-service.ts`（stats 落 kv）
- Test: `gateway/tests/unit/consolidation-stats-persist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ConsolidationService 构造接受可选 persist 回调；每次 stats 变化调用之
test('stats persist callback fires on judge', async () => {
  const seen: any[] = [];
  const svc = new ConsolidationService({ /* stub store/vectors/provider/llm */,
    onStats: (s) => seen.push(s) } as any);
  await svc.consolidate(/* ...候选命中... */);
  expect(seen.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/consolidation-stats-persist.test.ts --runInBand`
Expected: FAIL — `onStats` 未定义

- [ ] **Step 3: Write minimal implementation**

- `consolidation-service.ts`：`ConsolidationDeps` 加 `onStats?: (s: {judged,updates,creates,skipped}) => void`；`consolidate()` 每次终态调用之。新增 `skipped` 计数（skip 分支）。
- `index.ts`：`onStats: (s) => db.kvSet('consolidation-stats', JSON.stringify(s))`（或复用 heartbeat counts）；启动时读回初值。把 `store: new HarmonicUnitFileStore(mafwDir)` 改为**共享** `this.memoryService` 的 store/index（消除索引分叉）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/consolidation-stats-persist.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts gateway/src/memory/consolidation-service.ts gateway/tests/unit/consolidation-stats-persist.test.ts
git commit -m "fix(gateway): consolidation 共享索引 + stats 持久化 + skipped 计数"
```

---

## Phase S4：模式分离 guard

> 覆盖 spec `2026-09-24-pattern-separation-design.md`。产出：判官三值 + `separate` 分支（不合并、注入区分信号）。

### Task S4.1: 判官三值

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`（`JudgeVerdict` + `JUDGE_SYSTEM` + `parseJudgeVerdict`）
- Modify: `gateway/src/memory/route-write.ts`（`judge` 返回类型加 `separate`）
- Test: `gateway/tests/unit/memory/judge-verdict.test.ts`

**Interfaces:**
- Produces: `JudgeVerdict = {action:'update';target_id?} | {action:'create'} | {action:'separate';target_id?;distinction?}`

- [ ] **Step 1: Write the failing test**

```ts
// parseJudgeVerdict 导出，测三值解析 + 未知回退 create + 缺 target 处理
test('parses separate verdict', () => {
  expect(parseJudgeVerdict('{"action":"separate","target_id":"x","distinction":"region"}'))
    .toEqual({ action: 'separate', target_id: 'x', distinction: 'region' });
});
test('unknown action → create', () => {
  expect(parseJudgeVerdict('{"action":"weird"}')).toEqual({ action: 'create' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/judge-verdict.test.ts --runInBand`
Expected: FAIL — `parseJudgeVerdict` 未导出 / 不识别 separate

- [ ] **Step 3: Write minimal implementation**

- 导出 `parseJudgeVerdict`；接受 `separate`；未知 action → `create`。
- `JUDGE_SYSTEM` 增判据：`separate`（主体不同但高度相似，需保留两条并区分）+ 返回 `distinction` 关键词。
- `route-write.ts` 的 `judge` 返回类型扩为 `{ action:'create'|'update'|'separate'; targetId?; distinction? } | null`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/judge-verdict.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/consolidation-service.ts gateway/src/memory/route-write.ts gateway/tests/unit/memory/judge-verdict.test.ts
git commit -m "feat(gateway): 判官三值（update/create/separate）"
```

---

### Task S4.2: separate 分支落盘

**Files:**
- Modify: `gateway/src/memory/route-write.ts`（`RoutingOutcome` 加 `separate`；`routeAndWrite` 处理）
- Modify: `gateway/src/core/memory/harmonic-types.ts`（`distinct_from?: string[]`）
- Test: `gateway/tests/unit/memory/separation.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('separate → writes new unit with distinction anchors + distinct_from', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('east', [0.9, 0.44]);
  const s = memStore([u('east')]);
  const out = await routeAndWrite(
    { ...u('west'), cue_anchors: ['deploy'] } as any, s as any,
    { vectors: v, provider, judge: async () => ({ action: 'separate', targetId: 'east', distinction: 'eu-west-1' }) },
  );
  expect(out.action).toBe('separate');
  const written = s.writes[0];
  expect(written.cue_anchors).toContain('eu-west-1');
  expect((written as any).distinct_from).toContain('east');
  expect(s.superseded).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/separation.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`route-write.ts`：
```ts
// 1) RoutingOutcome 联合加: | { action: 'separate'; targetId: string; distinction?: string }
// 2) routeAndWrite 的返回类型联合同步扩为 'skip' | 'create' | 'update' | 'separate'
// 3) decideRouting: verdict.action === 'separate' → { action:'separate', targetId, distinction }
//    （targetId 合法校验同 update：必须 ∈ candidateIds，否则回退 create）
if (decision.action === 'separate') {
  const unit2 = { ...unit,
    cue_anchors: dedupeCap([...(unit.cue_anchors||[]), ...(decision.distinction ? [decision.distinction] : [])], 8),
    distinct_from: [...((unit as any).distinct_from||[]), decision.targetId] };
  await store.write(unit2 as any);
  return { action: 'separate', id: unit.id, targetId: decision.targetId };
}
```
`harmonic-types.ts`：`HarmonicUnit` 加 `distinct_from?: string[]`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/separation.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/src/core/memory/harmonic-types.ts gateway/tests/unit/memory/separation.test.ts
git commit -m "feat(gateway): 模式分离分支（distinction 锚点 + distinct_from）"
```

---

## Phase S3：编码门控（obs 显著度打标）

> 覆盖 spec `2026-09-24-encoding-gating-design.md`。产出：capture 时算显著度存库（不丢数据）。

### Task S3.1: obsSalience 纯函数

**Files:**
- Create: `gateway/src/recall/obs-salience.ts`
- Test: `gateway/tests/unit/obs-salience.test.ts`

**Interfaces:**
- Produces: `obsSalience(s: { text: string; novelty?: number; repetition?: number; reward?: number }): { score: number }`

- [ ] **Step 1: Write the failing test**

```ts
import { obsSalience } from '../../src/recall/obs-salience';
test('high novelty + emotion → high score', () => {
  expect(obsSalience({ text: '重大错误！崩溃了', novelty: 1 }).score).toBeGreaterThan(0.7);
});
test('repetition lowers score', () => {
  const a = obsSalience({ text: '普通日志', novelty: 0.2 }).score;
  const b = obsSalience({ text: '普通日志', novelty: 0.2, repetition: 3 }).score;
  expect(b).toBeLessThan(a);
});
test('missing signals → neutral', () => {
  expect(obsSalience({ text: 'x' }).score).toBeCloseTo(0.5, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/obs-salience.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/recall/obs-salience.ts
import { calculateSalience } from '../core/memory/salience-perceptor';
export interface ObsSalienceSignals { text: string; novelty?: number; repetition?: number; reward?: number; }
export function obsSalience(s: ObsSalienceSignals): { score: number } {
  const emotional = (calculateSalience(s.text) - 1.0) / 0.5; // 0.5/1.0/1.5 → -1/0/1
  const novelty = s.novelty ?? 0.5;
  const reward = s.reward ?? 0;
  const rep = Math.min(1, (s.repetition ?? 0) / 3);
  const raw = 0.5 * novelty + 0.3 * emotional + 0.2 * reward - 0.4 * rep + 0.5;
  return { score: Math.max(0, Math.min(1, raw)) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/obs-salience.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/obs-salience.ts gateway/tests/unit/obs-salience.test.ts
git commit -m "feat(gateway): 观测显著度纯函数（标量集成）"
```

---

### Task S3.2: capture 写库 + 迁移

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（`t1_observations` 加 `salience REAL` + 幂等迁移）
- Modify: capture 路由（写入 `salience`）
- Test: `gateway/tests/unit/gateway-db-salience.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
test('obs salience column exists and persists', () => {
  const db = new GatewayDatabase(':memory:');
  db.captureObservation({ session_id: 's', turn_id: 't', source: 'user_input', content: 'hi', salience: 0.9 } as any);
  const rows: any[] = db.readTurn('s', 't');
  expect(rows[0].salience).toBeCloseTo(0.9, 2);
});
test('migration idempotent; legacy rows read as null', () => { /* 建旧表 → migrate → 查询不报错 */ });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway-db-salience.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`gateway-db.ts`：`ALTER TABLE t1_observations ADD COLUMN salience REAL`（`try/catch` 幂等）；capture 写入时带上 `salience`（由调用方算好传入）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway-db-salience.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-salience.test.ts
git commit -m "feat(gateway): t1_observations.salience 列 + 幂等迁移"
```

---

## Phase S2：回放采样 + 簇级交错

> 覆盖 spec `2026-09-24-replay-sampling-design.md`。产出：优先采样 + schema 簇交错注入。

### Task S2.1: 回放优先级纯函数

**Files:**
- Create: `gateway/src/recall/replay-sampling.ts`
- Test: `gateway/tests/unit/replay-sampling.test.ts`

**Interfaces:**
- Produces: `replayPriority(p: { salience: number; novelty: number; ageHours: number; tauHours?: number }): number`、`sampleByPriority<T>(items: T[], score: (x:T)=>number, budget: number, len: (x:T)=>number): T[]`

- [ ] **Step 1: Write the failing test**

```ts
import { replayPriority, sampleByPriority } from '../../src/recall/replay-sampling';
test('priority increases with salience/novelty, decays with age', () => {
  expect(replayPriority({ salience: 1, novelty: 1, ageHours: 0 }))
    .toBeGreaterThan(replayPriority({ salience: 0.2, novelty: 0.2, ageHours: 0 }));
  expect(replayPriority({ salience: 1, novelty: 1, ageHours: 0 }))
    .toBeGreaterThan(replayPriority({ salience: 1, novelty: 1, ageHours: 72 }));
});
test('budget-respecting selection prefers higher priority', () => {
  const items = [{ id: 'a', s: 1, len: 5 }, { id: 'b', s: 0.1, len: 5 }, { id: 'c', s: 0.9, len: 5 }];
  const out = sampleByPriority(items, x => x.s, 10, x => x.len);
  expect(out.map(x => x.id)).toEqual(['a', 'c']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/replay-sampling.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/recall/replay-sampling.ts
export function replayPriority(p: { salience: number; novelty: number; ageHours: number; tauHours?: number }): number {
  const tau = p.tauHours ?? 24;
  return p.salience * (1 + p.novelty) * Math.exp(-Math.max(0, p.ageHours) / tau);
}
export function sampleByPriority<T>(items: T[], score: (x: T) => number, budget: number, len: (x: T) => number): T[] {
  const sorted = [...items].sort((a, b) => score(b) - score(a));
  const out: T[] = []; let used = 0;
  for (const it of sorted) { const l = len(it); if (used + l > budget) continue; out.push(it); used += l; }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/replay-sampling.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/replay-sampling.ts gateway/tests/unit/replay-sampling.test.ts
git commit -m "feat(gateway): 回放优先级采样纯函数"
```

---

### Task S2.2: schema 簇

**Files:**
- Create: `gateway/src/memory/schema-clusters.ts`
- Test: `gateway/tests/unit/memory/schema-clusters.test.ts`

**Interfaces:**
- Produces: `assignCluster(id, vector, clusters, theta): {clusterId; isNew}`、`topClusters(queryVec, clusters, n, vectors): Cluster[]`、`type Cluster = { id: string; centroid: number[]; members: string[]; representative?: string }`

- [ ] **Step 1: Write the failing test**

```ts
test('assigns to nearest cluster above theta, else new', () => {
  const c = [{ id: 'c1', centroid: [1, 0], members: ['a'] }];
  expect(assignCluster('b', [0.99, 0.1], c, 0.85).clusterId).toBe('c1');
  expect(assignCluster('c', [0, 1], c, 0.85).isNew).toBe(true);
});
test('topClusters ranks by cosine', () => {
  const c = [{ id: 'c1', centroid: [1, 0], members: [] }, { id: 'c2', centroid: [0, 1], members: [] }];
  expect(topClusters([1, 0.1], c, 1).map(x => x.id)).toEqual(['c1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/schema-clusters.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

实现 `assignCluster`（余弦最近且 ≥ theta）、`topClusters`（按余弦排序取 n）、质心更新（移动平均）。纯函数，无 IO。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/memory/schema-clusters.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/schema-clusters.ts gateway/tests/unit/memory/schema-clusters.test.ts
git commit -m "feat(gateway): 嵌入 schema 簇（归属/代表/相关簇）"
```

---

### Task S2.3: turn_pipeline 接线（采样 + 交错）

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（transcript 采样 + schema 块交错 + 指令）
- Modify: `gateway/src/config.ts`（τ / 簇阈值 / topN）
- Test: `gateway/tests/unit/turn-pipeline-replay.test.ts`（扩展现有）

- [ ] **Step 1: Write the failing test**

```ts
import { replayPriority, sampleByPriority } from '../../src/recall/replay-sampling';

test('turn sampling prefers high-salience recent turns under budget', () => {
  const turns = [
    { id: 'a', salience: 1.0, novelty: 1.0, ageHours: 0, len: 10 },
    { id: 'b', salience: 0.1, novelty: 0.1, ageHours: 40, len: 10 },
    { id: 'c', salience: 0.9, novelty: 0.8, ageHours: 1, len: 10 },
  ];
  const picked = sampleByPriority(turns, t => replayPriority(t), 20, t => t.len);
  expect(picked.map(t => t.id)).toEqual(['a', 'c']); // b 低优先级被挤出
});

test('schema block is rendered for a related cluster', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-schema-'));
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  index.addEntry({ id: 'rep', type: 'semantic', primary_abstraction: 'deploy pipeline',
    cue_anchors: ['deploy'], tier: 'semantic', energy: 0.9, salience: 1.5, created_at: now } as any, 'semantic');
  let captured = '';
  const worker = { prompt: async (p: string) => { captured = p; return '[NOOP: test]'; } };
  const t1db = {
    listTurns: () => [{ session_id: 's1', turn_id: 't1', complete: true, updated_at: Date.now() }],
    readTurn: () => [{ source: 'user_input', content: 'deployed to prod', salience: 0.9 }],
    logNoop: () => {}, archiveTurn: () => {},
  } as any;
  const clusters = [{ id: 'c1', centroid: [1, 0], members: ['rep'], representative: 'rep' }];
  const pipe = new TurnPipeline({ t1db, index, workerFor: () => worker as any, staleMs: 1e9,
    schemaClusters: () => clusters, clusterVector: () => [1, 0] } as any);
  await pipe.runSession('s1');
  expect(captured).toContain('[schema:');
  expect(captured).toMatch(/整合|integrate/i);
});
```

> 实现时给 `TurnPipelineOptions` 增 `schemaClusters?: () => Cluster[]` 与 `clusterVector?: (t: T1Observation[]) => number[]`（缺省时回退现状，不渲染 schema 块）。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`turn-pipeline.ts`：`runSession` 中把 `observationsToTranscript(observations.slice(...))` 改为按 `replayPriority` 采样回合后再拼；新增 `schemaBlock`（用 `schema-clusters` 取相关簇代表）与 transcript **交错**拼接；`TOOL_EXTRACTION_SYSTEM` 增"优先整合进匹配 schema 簇（UPDATE 代表），无匹配才新建"。deps 缺簇/嵌入 → 回退现状。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/turn-pipeline-replay.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/turn-pipeline.ts gateway/src/config.ts gateway/tests/unit/turn-pipeline-replay.test.ts
git commit -m "feat(gateway): turn_pipeline 回放采样 + schema 交错"
```

---

## Phase S5：再巩固

> 覆盖 spec `2026-09-24-reconsolidation-design.md`。产出：访问加成接线 + 资格队列 + 预测误差门。

### Task S5.1: 访问加成接线

**Files:**
- Create: `gateway/src/recall/access-bonus.ts`
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts`（命中 → `applyAccessBonus`）
- Test: `gateway/tests/unit/recall/access-bonus.test.ts`

- [ ] **Step 1: Write the failing test**

**Interfaces:**
- Produces: `applyAccessBonus(ids: string[], index: { updateEnergy(id: string, delta: number): void }, delta?: number): void`

```ts
import { applyAccessBonus } from '../../src/recall/access-bonus';

test('applies +0.02 to each hit id', () => {
  const calls: Array<[string, number]> = [];
  applyAccessBonus(['a', 'b'], { updateEnergy: (id, d) => calls.push([id, d]) });
  expect(calls).toEqual([['a', 0.02], ['b', 0.02]]);
});

test('no hits → no calls', () => {
  const calls: any[] = [];
  applyAccessBonus([], { updateEnergy: (...a) => calls.push(a) });
  expect(calls).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/recall/access-bonus.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
// gateway/src/recall/access-bonus.ts
export function applyAccessBonus(
  ids: string[],
  index: { updateEnergy(id: string, delta: number): void },
  delta: number = 0.02,
): void {
  for (const id of ids) {
    try { index.updateEnergy(id, delta); } catch { /* fail-open */ }
  }
}
```
`search-hybrid.ts`：拿到 `scored` 后 `applyAccessBonus(scored.map(s => s.entry.id), indexManager)`。**仅显式检索路径**（`/api/recall/context` 边界 recall 不调）。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/recall/access-bonus.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/search-hybrid.ts gateway/tests/unit/recall/access-bonus.test.ts
git commit -m "feat(gateway): 检索访问加成接线（+0.02）"
```

---

### Task S5.2: 再巩固队列 + 预测误差门

**Files:**
- Create: `gateway/src/recall/reconsolidation.ts`
- Modify: `gateway/src/memory/gateway-db.ts`（`reconsolidation_queue` 表）
- Modify: `gateway/src/mcp/handlers/record-feedback.ts`（标记资格）
- Modify: `gateway/src/recall/turn-pipeline.ts`（消费队列）
- Test: `gateway/tests/unit/recall/reconsolidation-queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ReconsolidationQueue {
    mark(id: string, reason: string, ttlMs?: number): void;
    isEligible(id: string, now?: number): boolean;
    listEligible(now?: number): string[];
    consume(id: string): void;
  }
  class InMemoryReconsolidationQueue implements ReconsolidationQueue {}
  function shouldReconsolidate(
    verdict: { action: 'create' | 'update' | 'separate'; targetId?: string } | null,
    targetId: string,
  ): boolean;
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { InMemoryReconsolidationQueue, shouldReconsolidate } from '../../../src/recall/reconsolidation';

test('mark eligible then expire after TTL', () => {
  const q = new InMemoryReconsolidationQueue();
  q.mark('a', 'feedback', 1000);
  expect(q.isEligible('a', 500)).toBe(true);
  expect(q.isEligible('a', 1500)).toBe(false);
});

test('consume removes eligibility', () => {
  const q = new InMemoryReconsolidationQueue();
  q.mark('a', 'feedback', 1000);
  q.consume('a');
  expect(q.isEligible('a', 0)).toBe(false);
});

test('prediction-error gate: only an update verdict targeting this id', () => {
  expect(shouldReconsolidate({ action: 'update', targetId: 'a' }, 'a')).toBe(true);
  expect(shouldReconsolidate({ action: 'create' }, 'a')).toBe(false);
  expect(shouldReconsolidate({ action: 'separate', targetId: 'a' }, 'a')).toBe(false);
  expect(shouldReconsolidate(null, 'a')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/recall/reconsolidation-queue.test.ts --runInBand`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

- `gateway-db.ts`：建表 `reconsolidation_queue(id TEXT PRIMARY KEY, marked_at INTEGER, expires_at INTEGER, reason TEXT)` + CRUD。
- `reconsolidation.ts`：`markEligible(id, reason, ttlMs)`、`listEligible(now)`、`consume(id)`；预测误差门 `shouldReconsolidate(old, newInfo, judgeVerdict): boolean`（仅判官判 update 且属该 target）。
- `record-feedback.ts`：thumbs_up → `markEligible(targetId, 'feedback')`。
- `turn-pipeline.ts`：巩固后对 eligible 且本轮矛盾者走 UPDATE（复用 S1 的 `routeAndWrite` update 分支）。
- `index.ts`：stats 增 `reconsolidation: { eligible, reconsolidated }`。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/recall/reconsolidation-queue.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/reconsolidation.ts gateway/src/memory/gateway-db.ts gateway/src/mcp/handlers/record-feedback.ts gateway/src/recall/turn-pipeline.ts gateway/src/index.ts gateway/tests/unit/recall/reconsolidation-queue.test.ts
git commit -m "feat(gateway): 再巩固队列 + 预测误差门"
```

---

## 收尾：全量验证 + 部署

- [ ] **Step 1: 全量测试**

Run: `cd gateway; npx jest --runInBand`
Expected: 全绿（196+ suites，新增 ~30 tests）

- [ ] **Step 2: 构建 + 部署**

```bash
npm run build                 # 根目录
npm pack                      # 根目录（必须在根！）
mafw stop
npm install -g jack200714-mafw-<version>.tgz
mafw daemon
# 验证
curl http://127.0.0.1:3000/health
curl http://127.0.0.1:3000/api/memory/stats   # 看 consolidation.updateRatio / skipped
```

- [ ] **Step 3: 观测碎片化下降**

对同一批重复写入，`updateRatio ∈ [0.16,0.22]`、`skipped > 0`；重跑 near-dup 扫描确认新增重复下降。
