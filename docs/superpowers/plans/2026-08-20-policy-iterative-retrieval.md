# Policy 迭代检索（mafw_search_hybrid 多轮扩展）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `mafw_search_hybrid` 改造成主 agent 驱动的多轮迭代检索：首轮返回 state，agent 携带 state 继续扩展（锚点图邻居 + 已见去重），直到足够或轮次上限。

**Architecture:** 工具 handler 内实现 state 编解码（base64url(JSON)：seen+frontier+round）；首轮走现有 `memory.search` 原样，迭代轮合并 frontier 邻居与 bm25 新命中（融合排序）；`HarmonicIndexManager` 加 `getAnchorGraphStore()` getter 供 handler 访问；`config.search.maxExpandRounds` 控制轮次；工具描述引导 agent 迭代。

**Tech Stack:** Node http（MCP handler）、better-sqlite3（锚点图）、config.ts、现有 HarmonicIndexManager/AnchorGraphStore。

## Global Constraints

- 首轮（无 state）调用 `memory.search(query, topK*2, {retriever})` **原样透传**——行为与现状完全一致（含 searchScored 的图扩展+融合）
- state 格式：`{ seen: string[], frontier: string[], round: number }`，base64url(JSON)；解码失败 → 按首轮处理
- 轮次语义：`maxExpandRounds=2` = 首轮 + 最多 2 次迭代扩展（共 3 次调用）；state.round=2 时返回 `canExpand:false`
- frontier 条目评分：graph-only（`weight × energy × salience`），与 bm25Hits 统一 min-max 归一化后按 `bm25×0.85 + graph×0.15` 融合
- `memoryType` 后置过滤对首轮与迭代轮结果**同样适用**
- 无锚点图（getAnchorGraphStore 返回 null）→ `canExpand:false`，行为等价现有单次搜索
- superseded 条目：frontier 命中过滤；已见条目 seen 去重
- `tool-registry.ts` inputSchema 加 `state` 字段（字符串，可选）；现有 `policy: "guided"|"oneshot"` 字段保留不动
- 测试框架 jest（`npm run test:unit`）

---

### Task 1: 网关 — HarmonicIndexManager 加 getAnchorGraphStore getter + config.maxExpandRounds

**Files:**
- Modify: `gateway/src/core/memory/harmonic-index.ts`（getter）
- Modify: `gateway/src/config.ts`（search.maxExpandRounds）
- Test: `tests/unit/harmonic-index.test.ts`（getter 测试）

**Interfaces:**
- Consumes: 现有 `setAnchorGraphStore`（已存在）
- Produces: `getAnchorGraphStore(): import('../../graph/anchor-graph-store').AnchorGraphStore | null`；`config.search.maxExpandRounds: number`（默认 2）

- [ ] **Step 1: 写失败测试**

在 `tests/unit/harmonic-index.test.ts` 末尾追加：

```typescript
  it('getAnchorGraphStore returns null by default and the injected store after set', () => {
    expect(manager.getAnchorGraphStore()).toBeNull();
    const fake = {} as any;
    manager.setAnchorGraphStore(fake);
    expect(manager.getAnchorGraphStore()).toBe(fake);
  });
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/harmonic-index.test.ts --no-coverage`
Expected: FAIL（`getAnchorGraphStore` 不存在）

- [ ] **Step 3: harmonic-index.ts 加 getter**

在 `setAnchorGraphStore` 方法后加：

```typescript
  getAnchorGraphStore(): import('../../graph/anchor-graph-store').AnchorGraphStore | null {
    return this.anchorGraphStore;
  }
```

- [ ] **Step 4: config.ts 加 maxExpandRounds**

`gateway/src/config.ts` 的 `search` 接口段（graph 字段后）加：

```typescript
    /** Agent-driven iterative expansion rounds for mafw_search_hybrid (0 = first round only). */
    maxExpandRounds: number;
```

DEFAULTS 的 search.graph 后加：

```typescript
      maxExpandRounds: 2,
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npx jest tests/unit/harmonic-index.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add gateway/src/core/memory/harmonic-index.ts gateway/src/config.ts tests/unit/harmonic-index.test.ts
git commit -m "feat(memory): expose getAnchorGraphStore getter + config.search.maxExpandRounds"
```

---

### Task 2: 网关 — search-hybrid.ts 迭代检索 + state 编解码

**Files:**
- Modify: `gateway/src/mcp/handlers/search-hybrid.ts`（核心改造）
- Test: `tests/unit/gateway/search-hybrid-policy.test.ts`（新）

**Interfaces:**
- Consumes: `memory.search`（现有）、`getAnchorGraphStore()`（Task 1）、`config.search.maxExpandRounds`、`AnchorGraphStore.getNeighbors(ids, topK, exclude?)`
- Produces: handler 输出 JSON 含 `results/canExpand/state/round/count/hint`；state 编解码函数 `encodeState/decodeState`（模块内导出供测试）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/unit/gateway/search-hybrid-policy.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { AnchorGraphStore } from '../../../gateway/src/graph/anchor-graph-store';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { handleSearchHybrid, encodeState, decodeState } from '../../../gateway/src/mcp/handlers/search-hybrid';

let dir: string;
let db: GatewayDatabase;
let graph: AnchorGraphStore;
let store: HarmonicUnitFileStore;

const T = '2025-01-01T00:00:00.000Z';

function unit(id: string, primary: string, anchors: string[]): any {
  return {
    id, type: 'semantic', primary_abstraction: primary, cue_anchors: anchors,
    memory_value: 'v', energy: 0.8, created_at: T, updated_at: T,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shp-'));
  const memoryDir = path.join(dir, 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  db = new GatewayDatabase(path.join(dir, 'gw.db'));
  graph = new AnchorGraphStore(db);
  store = new HarmonicUnitFileStore(dir, undefined, graph);
  store.indexManager_().setAnchorGraphStore(graph);   // 关键：图必须 attach 到 index manager
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function services() {
  return { memory: store.indexManager_(), mafwDir: dir } as any;
}

// A-B-C 三单元链：query 只强命中 A；B 与 A 共享锚点 orion-plan；
// C 与 B 共享 prototype（与 query 无词重叠）→ 首轮结果 A(+B 经 searchScored 1-hop 图扩展)，frontier={C}
async function seedChain() {
  await store.write(unit('a', 'Dave agreed the Orion schedule', ['orion-plan', 'dave']));
  await store.write(unit('b', 'Prototype shipped early April', ['orion-plan', 'prototype']));
  await store.write(unit('c', 'Risks reviewed for slip', ['prototype', 'risk-review']));
}

test('encodeState/decodeState round-trips', () => {
  const s = { seen: ['a'], frontier: [{ id: 'c', weight: 2 }], round: 1 };
  expect(decodeState(encodeState(s))).toEqual(s);
});

test('decodeState returns null on corrupt input', () => {
  expect(decodeState('not-json')).toBeNull();
  expect(decodeState('')).toBeNull();
  expect(decodeState(null)).toBeNull();
});

test('first round returns results + canExpand + state', async () => {
  await seedChain();
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule' }, services())).content[0].text);
  expect(res.results.length).toBeGreaterThan(0);
  expect(res.canExpand).toBe(true);       // frontier = {c}
  expect(res.state).toBeTruthy();
  expect(res.round).toBe(0);
  expect(res.count).toBe(res.results.length);
  expect(typeof res.hint).toBe('string');
});

test('iteration round returns increment (no seen) and advances state', async () => {
  await seedChain();
  const first = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule' }, services())).content[0].text);
  const firstIds = new Set(first.results.map((r: any) => r.id));
  const iter = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: first.state }, services())).content[0].text);
  expect(iter.round).toBe(1);
  expect(iter.results.length).toBeGreaterThan(0);
  for (const r of iter.results) expect(firstIds.has(r.id)).toBe(false);   // 增量：不含已见
  expect(iter.results.map((r: any) => r.id)).toContain('c');              // 链尾经 frontier 进入
});

test('round cap: state.round=2 returns canExpand=false without iterating', async () => {
  const s = encodeState({ seen: ['a'], frontier: [{ id: 'c', weight: 2 }], round: 2 });
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: s }, services())).content[0].text);
  expect(res.canExpand).toBe(false);
  expect(res.round).toBe(2);              // clamp：不递增到 3
  expect(res.results.length).toBe(0);     // 轮次已满：不消费 frontier，query 命中已 seen → 无增量
});

test('no shared anchors -> canExpand=false', async () => {
  await store.write(unit('x', 'Unrelated cooking recipe', ['cooking']));
  const res = JSON.parse((await handleSearchHybrid({ query: 'cooking recipe' }, services())).content[0].text);
  expect(res.canExpand).toBe(false);
  expect(res.state).toBeNull();
});

test('bad state falls back to first-round behavior', async () => {
  await seedChain();
  const res = JSON.parse((await handleSearchHybrid({ query: 'Dave agreed Orion schedule', state: 'garbage' }, services())).content[0].text);
  expect(res.round).toBe(0);
  expect(res.results.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx jest tests/unit/gateway/search-hybrid-policy.test.ts --no-coverage`
Expected: FAIL（encodeState/decodeState 不存在、handler 无 state 逻辑）

- [ ] **Step 3: 实现 search-hybrid.ts 改造**

`gateway/src/mcp/handlers/search-hybrid.ts` 完整重写：

```typescript
import { config } from "../../config";
import { ToolHandler } from "../../types";
import { HarmonicUnitFileStore } from "../../memory/harmonic-file-store";

interface FrontierItem { id: string; weight: number; }
interface IterState { seen: string[]; frontier: FrontierItem[]; round: number; }

export function encodeState(s: IterState): string {
  return Buffer.from(JSON.stringify(s), 'utf8').toString('base64url');
}

export function decodeState(raw: string | undefined | null): IterState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (!Array.isArray(s?.seen) || !Array.isArray(s?.frontier) || typeof s?.round !== 'number') return null;
    return {
      seen: s.seen.filter((x: unknown) => typeof x === 'string'),
      frontier: s.frontier
        .filter((x: any) => typeof x?.id === 'string')
        .map((x: any) => ({ id: x.id, weight: Number(x.weight) || 1 })),
      round: s.round,
    };
  } catch {
    return null;
  }
}

// 兼容生产（MemoryService.harmonicIndex.*）与测试（裸 HarmonicIndexManager）两种访问路径
function getGraphStore(memory: any) {
  return memory?.harmonicIndex?.getAnchorGraphStore?.() ?? memory?.getAnchorGraphStore?.() ?? null;
}

function getIndexEntries(memory: any) {
  return memory?.harmonicIndex?.getIndex?.()?.entries ?? memory?.getIndex?.()?.entries ?? [];
}

export const handleSearchHybrid: ToolHandler = async (args, { memory, mafwDir }) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || config.search.defaultTopK;
    const retriever = (args.retriever as 'token' | 'bm25' | undefined) || config.search.defaultRetriever;
    const maxRounds = config.search.maxExpandRounds;
    const graphStore = getGraphStore(memory);
    const prev = decodeState(args.state as string | undefined);

    let scored: Array<{ entry: any; score: number; graphScore: number }>;
    let seen: string[];
    let frontier: FrontierItem[];
    let round: number;

    if (!prev) {
      // ── 首轮：现有行为原样（searchScored 已含图扩展+融合）+ 计算 frontier ──
      scored = memory.search(query, topK * 2, { retriever }).map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));
      seen = scored.map(s => s.entry.id);
      frontier = computeFrontier(graphStore, scored.map(s => s.entry.id), new Set(seen));
      round = 0;
    } else if (prev.round >= maxRounds) {
      // ── 轮次已满：不扩展、不消费 frontier，仅返回 bm25 新命中增量 ──
      const seenSet = new Set(prev.seen);
      scored = memory.search(query, topK * 2, { retriever })
        .filter((e: any) => !seenSet.has(e.id))
        .map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));
      seen = prev.seen;
      frontier = prev.frontier;
      round = prev.round;
    } else {
      // ── 迭代轮：frontier 条目(graph-only 评分) + bm25 新命中，统一归一化融合 ──
      round = prev.round + 1;
      const seenSet = new Set(prev.seen);
      const entries = getIndexEntries(memory);
      const frontierHits: Array<{ entry: any; score: number; graphScore: number }> = [];
      for (const f of prev.frontier) {
        if (seenSet.has(f.id)) continue;
        const entry = entries.find((e: any) => e.id === f.id);
        if (!entry || entry.superseded_by) continue;
        frontierHits.push({ entry, score: 0, graphScore: f.weight * (entry.energy ?? 0.8) * (entry.salience ?? 1) });
      }
      const freshHits = memory.search(query, topK * 2, { retriever })
        .filter((e: any) => !seenSet.has(e.id))
        .map((e: any) => ({ entry: e, score: 1, graphScore: 0 }));

      const union = mergeById(frontierHits, freshHits);
      const norm = (vals: number[]) => {
        if (vals.length === 0) return [];
        const min = Math.min(...vals), max = Math.max(...vals);
        if (max === min) return vals.map(() => 0.5);
        return vals.map(v => (v - min) / (max - min));
      };
      const nb = norm(union.map(u => u.score));
      const ng = norm(union.map(u => u.graphScore));
      const gw = config.search.graph.rerankGraphWeight;
      scored = union.map((u, i) => ({ ...u, score: (1 - gw) * nb[i] + gw * ng[i] }))
        .sort((a, b) => b.score - a.score);

      seen = [...prev.seen];
      for (const s of scored) if (!seen.includes(s.entry.id)) seen.push(s.entry.id);
      // 新 frontier = 本次新结果邻居 + 剩余旧 frontier（未消费项，去重）
      const consumed = new Set(scored.map(s => s.entry.id));
      const remaining = prev.frontier.filter(f => !consumed.has(f.id) && !seen.includes(f.id));
      frontier = [...computeFrontier(graphStore, scored.map(s => s.entry.id), new Set(seen)), ...remaining];
    }

    // memoryType 后置过滤（首轮与迭代轮一致）
    const results = scored.filter((r: any) => !args.memoryType || r.entry.type === args.memoryType)
      .slice(0, topK)
      .map(r => r.entry);

    const canExpand = frontier.length > 0 && round < maxRounds;

    // Enrich with full memory_value from OKF store.
    const store = new HarmonicUnitFileStore(mafwDir || config.resolvePath());
    const enriched: any[] = [];
    for (const r of results) {
      let unit = null;
      try {
        unit = await store.read(r.id);
      } catch { /* keep entry-only */ }
      enriched.push({ ...r, memory_value: unit?.memory_value || (r as any).memory_value || '' });
    }

    const state = canExpand || round > 0 ? encodeState({ seen, frontier, round }) : null;
    const hint = canExpand
      ? '如需更多相关记忆，携带 state 再次调用本工具继续扩展检索。'
      : frontier.length === 0
        ? '已无更多可扩展的相关记忆。'
        : '已达最大扩展轮数。';

    return { content: [{ type: "text", text: JSON.stringify({ results: enriched, canExpand, state, round, count: enriched.length, hint }) }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
};

function computeFrontier(graphStore: any, ids: string[], exclude: Set<string>): FrontierItem[] {
  if (!graphStore || ids.length === 0) return [];
  const result: FrontierItem[] = [];
  for (const id of ids) {
    const neighbors = graphStore.getNeighbors([id], 3, exclude);
    for (const [nbId, info] of neighbors) {
      if (!result.some(f => f.id === nbId)) result.push({ id: nbId, weight: info.weight });
    }
    if (result.length >= 30) break;
  }
  return result;
}

function mergeById(
  a: Array<{ entry: any; score: number; graphScore: number }>,
  b: Array<{ entry: any; score: number; graphScore: number }>,
): Array<{ entry: any; score: number; graphScore: number }> {
  const byId = new Map<string, { entry: any; score: number; graphScore: number }>();
  for (const item of [...a, ...b]) {
    const existing = byId.get(item.entry.id);
    if (!existing) byId.set(item.entry.id, item);
    else {
      existing.score = Math.max(existing.score, item.score);
      existing.graphScore = Math.max(existing.graphScore, item.graphScore);
    }
  }
  return [...byId.values()];
}
```

注意（实现要点）：
- 生产路径 `memory` 是 `MemoryService`（`harmonicIndex` 字段）；测试路径传裸 `HarmonicIndexManager` —— `getGraphStore`/`getIndexEntries` 双路径兼容
- 迭代轮**不**对 frontier 再调 `getNeighbors(prev.frontier)`（那会越过 frontier 跳一级）；frontier 条目本身作为候选结果，其邻居留给下一轮 newFrontier
- `state.round >= maxRounds` 时 clamp：round 不递增、canExpand=false、不消费 frontier
- 首轮 `memory.search(...)` 原样透传（行为不变）——`scored` 的 score/graphScore 为占位值，仅迭代轮参与融合

- [ ] **Step 4: 运行测试确认通过**

Run: `npx jest tests/unit/gateway/search-hybrid-policy.test.ts --no-coverage`
Expected: PASS（7 个测试）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/mcp/handlers/search-hybrid.ts tests/unit/gateway/search-hybrid-policy.test.ts
git commit -m "feat(memory): iterative multi-round search in mafw_search_hybrid (state round-trip)"
```

---

### Task 3: 网关 — tool-registry inputSchema + 工具描述强化 + add-memory 图接线

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts`（inputSchema 加 state + 描述强化）
- Modify: `gateway/src/mcp/handlers/add-memory.ts`（传 anchorGraphStore）
- Test: 无新测试（schema 变更 + 接线；回归跑现有）

**Interfaces:**
- Consumes: Task 1-2
- Produces: 工具描述引导 agent 迭代；add-memory 写路径进图

- [ ] **Step 1: tool-registry.ts 更新**

`gateway/src/mcp/tool-registry.ts` 的 `mafw_search_hybrid` 注册条目改为：

```typescript
  {
    name: "mafw_search_hybrid",
    description: "Search memory units using BM25 (×energy) with optional iterative expansion. If results are insufficient and canExpand=true, call again with the returned state to expand via shared cue anchors. Stop when memories suffice; max 2 expansion rounds (3 calls total).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query text" },
        topK: { type: "number", description: "Maximum results", default: 20 },
        memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional filter" },
        policy: { type: "string", enum: ["guided", "oneshot"], default: "guided", description: "Retrieval strategy (reserved)" },
        retriever: { type: "string", enum: ["token", "bm25"], default: "token", description: "Retrieval scoring engine" },
        state: { type: "string", description: "Iteration state from a previous call; pass to continue expanding" },
      },
      required: ["query"],
    },
  },
```

- [ ] **Step 2: add-memory.ts 传 anchorGraphStore**

`gateway/src/mcp/handlers/add-memory.ts` 的 `new HarmonicUnitFileStore(...)` 调用（约 49-50 行）改为传图。该 handler 签名是 `(args, { memory, mafwDir })`，sharedIndex 从 `memory.harmonicIndex` 取（与 search-hybrid 一致的双路径）：

```typescript
    const sharedGraph = (memory as any)?.harmonicIndex?.getAnchorGraphStore?.()
      ?? (memory as any)?.getAnchorGraphStore?.() ?? undefined;
    const store = new HarmonicUnitFileStore(resolvedDir, sharedIndex, sharedGraph);
```

（`sharedIndex` 沿用 add-memory.ts 现有取法；若其现有代码未解构 `memory`，保持其原有访问方式，仅新增 `sharedGraph` 一行。）

- [ ] **Step 3: typecheck + 回归**

Run: `npx tsc --project gateway/tsconfig.json --noEmit`
Expected: 无错误

Run: `npx jest tests/unit/gateway/search-hybrid-policy.test.ts tests/unit/harmonic-index.test.ts --no-coverage`
Expected: PASS（新增 7 + 既有 harmonic-index 全过）

注意：`tests/unit/gateway/mcp-endpoints.test.ts` 只测 MafwScheduler 且依赖预构建 `gateway/dist`，不覆盖 MCP 工具 handler——不做回归目标。

- [ ] **Step 4: 提交**

```bash
git add gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/add-memory.ts
git commit -m "feat(memory): schema state field + agent iteration guidance + add-memory graph wiring"
```

---

### Task 4: 验证与部署

**Files:**
- 无源码改动（验证任务）

**Interfaces:**
- Consumes: Task 1-3 全部

- [ ] **Step 1: 全量单元测试**

Run: `npx jest tests/unit/gateway/search-hybrid-policy.test.ts tests/unit/gateway/anchor-graph-store.test.ts tests/unit/memory-quality.test.ts tests/unit/harmonic-index.test.ts --no-coverage`
Expected: 全部 PASS

- [ ] **Step 2: LongMemEval L1 门禁（无 state 单次调用不变）**

Run: `npx ts-node --project evaluation/longmemeval/tsconfig.json evaluation/longmemeval/src/l1-retrieval.ts --sample 8 --granularity session --retriever bm25`
Expected: R10=0.949 / R1=0.586（隔离无图，与基线一致——确认首轮行为未变）

- [ ] **Step 3: 构建 + 全局包同步**

Run: `cd gateway && npm run build` → `Copy-Item gateway/dist/* "C:\home\ubuntu\.npm-global\node_modules\opencode-plugin-mafw\gateway\dist\" -Recurse -Force`

- [ ] **Step 4: 手动验证（真实 gateway）**

重启 gateway（前台启动，参考既有流程）后，在桌面/agent 里调用 `mafw_search_hybrid`：
1. 首轮返回 `{ results, canExpand, state, round: 0, count, hint }`
2. 带 `state` 再次调用 → `round: 1`，返回增量（不含首轮已见）
3. 多调一次 → `round: 2` 后 `canExpand: false`
4. 无 state 单次调用 → 输出与旧版一致（仅多 canExpand/state/round/hint 字段）

- [ ] **Step 5: 提交（如有文档改动）**

```bash
git add docs/superpowers/specs/2026-08-20-policy-iterative-retrieval.md
git commit -m "docs: policy iterative retrieval - verification complete"
```

---

## Self-Review

**Spec 覆盖检查：**
- §3.1 工具接口（输入 state / 输出 results/canExpand/state/round/count/hint）→ Task 2
- §3.2 state 编码（seen+frontier+round base64url）→ Task 2（encodeState/decodeState）
- §3.3 执行逻辑（首轮原样/迭代融合/轮次语义）→ Task 2
- §3.4 工具描述强化 → Task 3
- §4 config.maxExpandRounds → Task 1
- §4a AnchorGraphStore 接入（getter 方案 A）+ add-memory 接线 → Task 1 + Task 3
- §5 错误处理（坏 state 回退、无图退化、去重、上限）→ Task 2 测试覆盖
- §6 验证（单测 6 项 + 集成 + L1 门禁）→ Task 2 测试 + Task 4

**类型一致性：**
- `encodeState(s: IterState): string` / `decodeState(raw): IterState | null`，`IterState = { seen: string[], frontier: {id, weight}[], round: number }` — Task 2 定义与测试一致
- `getAnchorGraphStore(): AnchorGraphStore | null` — Task 1 定义；Task 2/3 经 `getGraphStore()` 双路径访问（`memory.harmonicIndex.*` 或裸 `memory.*`）
- `config.search.maxExpandRounds: number`（默认 2）— Task 1 定义、Task 2 使用
- handler 输出 `results/canExpand/state/round/count/hint` — Task 2 实现与测试一致
- `store.indexManager_(): HarmonicIndexManager`（harmonic-file-store.ts:130）— Task 2 测试 beforeEach 使用；`setAnchorGraphStore` 必须显式调用（构造 store 传图只喂写路径，不 attach 到 index manager）

**评审修正记录（子代理计划审查）**：
1. 访问路径：生产 `memory` 是 `MemoryService`（`harmonicIndex` 字段），测试传裸 `HarmonicIndexManager`（无 `harmonicIndex`）→ `getGraphStore`/`getIndexEntries` 双路径兼容
2. beforeEach 需 `store.indexManager_().setAnchorGraphStore(graph)`（否则 `getAnchorGraphStore()` 返回 null → canExpand 恒 false）
3. 测试数据：2 单元不足以演示迭代（defaultTopK=20 + searchScored 自带 1-hop 扩展首轮全带回）→ 3 单元链 A-B-C，query 只强命中 A，C 与 query 无词重叠
4. 轮次语义：`state.round >= maxRounds` → clamp（round 不递增、canExpand=false、不消费 frontier），测试断言 round=2 一致
5. 迭代语义对齐 spec：frontier 条目**本身**是候选结果（graph-only 评分），不对 frontier 再 `getNeighbors` 跳一级；`state.frontier` 携带 `{id, weight}`；newFrontier = 新结果邻居 + 未消费旧 frontier
6. Task 3 回归目标排除 mcp-endpoints.test.ts（不覆盖 MCP 工具 handler）
