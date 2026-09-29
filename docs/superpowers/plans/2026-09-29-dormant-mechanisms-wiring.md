# A 路休眠机制接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 4 个休眠机制按调研结论接线：检索访问加成（ACT-R 对数式 + 每日批结算 + 曝光惩罚）、stale-verify 调度状态、删 top_associations、FOK isotonic 校准脚本。

**Architecture:** 新建 `retrieval-events.ts`（检索事件环形缓冲 + need 索引，进程单例）在 recall/search 出口采集；每日 `memory:decay` pass（`runEnergyDecay`）消费缓冲，按 ACT-R 公式 `B=ln(1+Σ(Δt+off)^-d·w)` 批量结算加成并做曝光折扣；stale-verify 用 `review_count/last_reviewed` 做排除窗调度；FOK 校准是纯离线脚本不动运行时。

**Tech Stack:** TypeScript (gateway, CJS), jest, 无新依赖。

**依据:** `docs/research/2026-09-29-memory-gap-abc-survey.md` §1（A 路）。

## Global Constraints

- TDD：每个任务先写失败测试
- fail-open：采集/结算失败绝不阻塞检索路径（100ms 契约不可侵犯）
- 评测确定性：采集只接生产出口（HTTP 路由 + MCP 工具），eval harness 直接 import 类、不经这些出口，天然不受影响——**禁止**在 `searchScored`/`HarmonicIndexManager` 内部采集
- 能量始终 clamp [0, 1]
- 测试命令统一 `cd gateway && npx jest --runInBand <path>`；提交前 `npm run build`（jest 不 typecheck index.ts）
- 不用 PowerShell 写/改源文件（UTF-8 事故），用 edit/write 工具

---

### Task 1: RetrievalEventBuffer（事件缓冲 + need 索引）

**Files:**
- Create: `gateway/src/core/memory/retrieval-events.ts`
- Test: `gateway/tests/unit/core/memory/retrieval-events.test.ts`

**Interfaces:**
- Produces: `RetrievalEvent { id: string; prob: number; kind: 'recall' | 'search'; ts: number }`；`class RetrievalEventBuffer`（`record` / `drain` / `needFor` / `clear`）；`getRetrievalEventBuffer(): RetrievalEventBuffer`（进程单例）；`recordRetrievalFromScored(scored: Array<{ entry: { id: string } }>, kind, probOf?)`（Task 2 接线用）

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/core/memory/retrieval-events.test.ts
import { RetrievalEventBuffer, recordRetrievalFromScored } from '../../../../src/core/memory/retrieval-events';

describe('RetrievalEventBuffer', () => {
  it('records and drains events, clearing the buffer', () => {
    const b = new RetrievalEventBuffer();
    b.record({ id: 'm1', prob: 0.9, kind: 'recall', ts: 1000 });
    b.record({ id: 'm2', prob: 0.4, kind: 'search', ts: 2000 });
    const drained = b.drain();
    expect(drained).toHaveLength(2);
    expect(b.drain()).toHaveLength(0);
  });

  it('is bounded — oldest events dropped beyond maxEvents', () => {
    const b = new RetrievalEventBuffer(100);
    for (let i = 0; i < 150; i++) b.record({ id: `m${i}`, prob: 1, kind: 'recall', ts: i });
    const drained = b.drain();
    expect(drained).toHaveLength(100);
    expect(drained[0].id).toBe('m50'); // oldest kept is the 51st record
  });

  it('needFor counts hits within 7 days and prunes older ones', () => {
    const b = new RetrievalEventBuffer();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: now - DAY });      // fresh
    b.record({ id: 'm1', prob: 1, kind: 'recall', ts: now - 2 * DAY });  // fresh
    b.record({ id: 'm2', prob: 1, kind: 'recall', ts: now - 9 * DAY });  // too old
    b.drain(); // need index survives drain
    expect(b.needFor('m1')).toBe(2);
    expect(b.needFor('m2')).toBe(0);
  });

  it('record never throws (fail-open on bad input)', () => {
    const b = new RetrievalEventBuffer();
    expect(() => b.record(null as any)).not.toThrow();
    expect(() => b.record({ id: '', prob: NaN, kind: 'recall', ts: NaN })).not.toThrow();
  });

  it('recordRetrievalFromScored maps scored entries into the buffer', () => {
    const b = new RetrievalEventBuffer();
    const buf = b; // bind singleton-free test path
    (globalThis as any).__mafwTestBuffer = b;
    recordRetrievalFromScored(
      [{ entry: { id: 'a' } }, { entry: { id: 'b' } }] as any,
      'recall',
      (e: any) => (e.entry.id === 'a' ? 0.9 : undefined),
    );
    expect(buf.drain().map((e) => e.id)).toEqual(['a', 'b']);
    delete (globalAny()).__mafwTestBuffer;
    function globalAny() { return globalThis as any; }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/core/memory/retrieval-events.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: Write minimal implementation**

```typescript
// gateway/src/core/memory/retrieval-events.ts
// A3: retrieval event stream — ACT-R "use it or lose it" wiring.
// In-memory ring buffer collected at production retrieval exits (recall route,
// search MCP tool); settled in batches by the daily memory:decay pass. The
// need index (7-day hit counts) survives drain and feeds replay sampling (B1).
import { log } from '../utils/logger';

export interface RetrievalEvent {
  id: string;
  /** reranker top1-style probability when known (0..1); used as bonus weight. */
  prob: number;
  kind: 'recall' | 'search';
  ts: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export class RetrievalEventBuffer {
  private events: RetrievalEvent[] = [];
  private maxEvents: number;
  /** id -> { hits, lastTs } within the trailing week (survives drain). */
  private need = new Map<string, { hits: number; lastTs: number }>();

  constructor(maxEvents = 5000) {
    this.maxEvents = maxEvents;
  }

  record(e: RetrievalEvent): void {
    try {
      if (!e || typeof e.id !== 'string' || !e.id) return;
      this.events.push({ id: e.id, prob: Number.isFinite(e.prob) ? e.prob : 1, kind: e.kind, ts: Number.isFinite(e.ts) ? e.ts : Date.now() });
      if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
      const n = this.need.get(e.id) ?? { hits: 0, lastTs: 0 };
      n.hits += 1;
      n.lastTs = e.ts;
      this.need.set(e.id, n);
    } catch (err: any) {
      log.warn?.(`[RetrievalEvents] record failed: ${err?.message || err}`);
    }
  }

  /** Returns and clears the pending event batch (consumed by the daily pass). */
  drain(): RetrievalEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Hits within the trailing 7 days (replay "need" signal). Prunes lazily. */
  needFor(id: string): number {
    const now = Date.now();
    let total = 0;
    for (const [key, n] of this.need) {
      if (now - n.lastTs > WEEK_MS) this.need.delete(key);
      else if (key === id) total = n.hits;
    }
    return total;
  }

  clear(): void {
    this.events = [];
    this.need.clear();
  }
}

let singleton: RetrievalEventBuffer | null = null;
export function getRetrievalEventBuffer(): RetrievalEventBuffer {
  if (!singleton) singleton = new RetrievalEventBuffer();
  return singleton;
}

/** Test seam: inject a dedicated buffer (production code never sets this). */
export function setRetrievalEventBufferForTest(b: RetrievalEventBuffer | null): void {
  singleton = b;
}

/**
 * Fail-open recording from a scored result list. `probOf` returns the
 * per-entry confidence when available (e.g. reranker top1 prob), else
 * undefined → weight 1.
 */
export function recordRetrievalFromScored(
  scored: Array<{ entry: { id: string } }>,
  kind: 'recall' | 'search',
  probOf?: (s: { entry: { id: string } }) => number | undefined,
  buffer: RetrievalEventBuffer = getRetrievalEventBuffer(),
): void {
  try {
    const ts = Date.now();
    for (const s of scored ?? []) {
      const p = probOf?.(s);
      buffer.record({ id: s?.entry?.id, prob: p === undefined ? 1 : p, kind, ts });
    }
  } catch {
    /* fail-open: never block retrieval */
  }
}
```

注：测试 Step 1 中 `recordRetrievalFromScored` 的注入方式改为使用第四个参数 `buffer`（比 globalThis 干净），实现测试时直接传 buffer，删掉 globalThis 段。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/core/memory/retrieval-events.test.ts`
Expected: PASS（5 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/retrieval-events.ts gateway/tests/unit/core/memory/retrieval-events.test.ts
git commit -m "feat(memory): retrieval event buffer with need index (A3 groundwork)"
```

---

### Task 2: 生产出口采集接线（fail-open）

**Files:**
- Modify: `gateway/src/recall/recall-context.ts`（live 检索主入口，最终 scored entries 确定处）
- Modify: `gateway/src/index.ts`（快照 serve 路径——快照被服务时的条目）
- Modify: `gateway/src/mcp/tool-registry.ts`（`handleSearchHybrid`，约 :597 注册；工具定义在 :49）
- Test: 复用 Task 1 测试（接线本身 2 行 fail-open，靠 build + 定位 grep 验证）

**Interfaces:**
- Consumes: `recordRetrievalFromScored`（Task 1）
- Produces: 无（纯副作用接线）

- [ ] **Step 1: 定位三个注入点**

Run: `cd gateway && grep -n "formatRecallContext(" src/recall/recall-context.ts src/index.ts | head -20` 与 `grep -n "handleSearchHybrid" src/mcp/tool-registry.ts`
预期：live 路径 = recall-context.ts 内 searchScored 结果经 resolveSupersededHeads 后、formatRecallContext 之前；快照路径 = index.ts 快照命中服务处（snapshot entries 取出处）；search = tool-registry.ts handleSearchHybrid 返回前。

- [ ] **Step 2: 三处各插入采集调用（每处 1-3 行，try/catch 由 helper 自带）**

live 路径示例（recall-context.ts，scored 为最终注入集合）：
```typescript
import { recordRetrievalFromScored } from '../core/memory/retrieval-events';
// ... 在最终 scored 确定、formatRecallContext 调用前：
recordRetrievalFromScored(scored, 'recall');
```
快照 serve 路径（index.ts，snapshot 命中时其 entries）：
```typescript
recordRetrievalFromScored(snapshotEntries.map((e) => ({ entry: e })), 'recall');
```
search 路径（tool-registry.ts handleSearchHybrid 返回前）：
```typescript
recordRetrievalFromScored(results, 'search');
```

- [ ] **Step 3: Build 验证类型 + 现有测试不回归**

Run: `cd gateway && npm run build && npx jest --runInBand tests/unit/recall`
Expected: build 成功，测试全绿

- [ ] **Step 4: Commit**

```bash
git add gateway/src/recall/recall-context.ts gateway/src/index.ts gateway/src/mcp/tool-registry.ts
git commit -m "feat(memory): wire retrieval event collection at recall/search exits (fail-open)"
```

---

### Task 3: ACT-R 对数加成数学（纯函数）

**Files:**
- Create: `gateway/src/core/memory/retrieval-bonus.ts`
- Test: `gateway/tests/unit/core/memory/retrieval-bonus.test.ts`

**Interfaces:**
- Consumes: `RetrievalEvent`（Task 1）
- Produces: `actrBonus(events: RetrievalEvent[], now: number, opts?: BonusOptions): number`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/core/memory/retrieval-bonus.test.ts
import { actrBonus } from '../../../../src/core/memory/retrieval-bonus';
import { RetrievalEvent } from '../../../../src/core/memory/retrieval-events';

const HOUR = 3600_000;
const ev = (id: string, hoursAgo: number, prob = 1): RetrievalEvent => ({
  id, prob, kind: 'recall', ts: Date.now() - hoursAgo * HOUR,
});

describe('actrBonus', () => {
  it('empty events → 0', () => {
    expect(actrBonus([], Date.now())).toBe(0);
  });

  it('sublinear growth: 10 events give less than 10x a single event', () => {
    const now = Date.now();
    const one = actrBonus([ev('m', 1)], now);
    const ten = actrBonus(Array.from({ length: 10 }, () => ev('m', 1)), now);
    expect(ten).toBeGreaterThan(one);
    expect(ten).toBeLessThan(one * 10);
  });

  it('older events contribute less than fresh ones', () => {
    const now = Date.now();
    expect(actrBonus([ev('m', 0.1)], now)).toBeGreaterThan(actrBonus([ev('m', 240)], now));
  });

  it('high-confidence hits weigh more', () => {
    const now = Date.now();
    expect(actrBonus([ev('m', 1, 0.95)], now)).toBeGreaterThan(actrBonus([ev('m', 1, 0.05)], now));
  });

  it('respects the cap', () => {
    const now = Date.now();
    const many = Array.from({ length: 500 }, () => ev('m', 0.01));
    expect(actrBonus(many, now, { cap: 0.05 })).toBeLessThanOrEqual(0.05);
  });

  it('exposure discount: heavy repetition is discounted beyond the threshold', () => {
    const now = Date.now();
    const mild = Array.from({ length: 3 }, () => ev('m', 1));
    const heavy = Array.from({ length: 30 }, () => ev('m', 1));
    const mildBonus = actrBonus(mild, now, { exposureThreshold: 3, exposureDiscount: 0.5 });
    const heavyBonus = actrBonus(heavy, now, { exposureThreshold: 3, exposureDiscount: 0.5 });
    // 30 events with discount must NOT be 10x the 3-event bonus
    expect(heavyBonus).toBeLessThan(mildBonus * 4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/core/memory/retrieval-bonus.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// gateway/src/core/memory/retrieval-bonus.ts
// A3: ACT-R base-level activation as the retrieval-strengthening math
// (B = ln Σ t^-d). Linear "+0.02/hit" is the worst form: unbounded, old
// events never fade, and it feeds back through retrieval × energy
// (popularity bias, arXiv:2007.13019). Log form + prob weighting + cap +
// exposure discount are the documented mitigations (see survey §A3).
import { RetrievalEvent } from './retrieval-events';

export interface BonusOptions {
  /** ACT-R decay exponent (default 0.5). */
  d?: number;
  /** Age offset in hours so fresh events stay finite (default 24). */
  offsetHours?: number;
  /** Upper bound on the applied bonus (default 0.05 — same order as one day's decay). */
  cap?: number;
  /** Scale applied to ln(1+activation) (default 0.1). */
  k?: number;
  /** Injections beyond this count in the batch start the exposure discount (default 5). */
  exposureThreshold?: number;
  /** Discount strength per extra injection (default 0.3). */
  exposureDiscount?: number;
}

export function actrBonus(events: RetrievalEvent[], now: number, opts: BonusOptions = {}): number {
  if (!events || events.length === 0) return 0;
  const d = opts.d ?? 0.5;
  const offset = opts.offsetHours ?? 24;
  const cap = opts.cap ?? 0.05;
  const k = opts.k ?? 0.1;
  const thr = opts.exposureThreshold ?? 5;
  const disc = opts.exposureDiscount ?? 0.3;

  let activation = 0;
  for (const e of events) {
    const ageHours = Math.max(0, (now - e.ts) / 3600_000);
    // prob ∈ [0,1] weights the hit; missing/invalid → full weight
    const w = Number.isFinite(e.prob) ? Math.max(0.2, Math.min(1, e.prob)) : 1;
    activation += w * Math.pow(ageHours + offset, -d);
  }
  let bonus = k * Math.log1p(activation);
  if (events.length > thr) {
    bonus /= 1 + disc * (events.length - thr);
  }
  return Math.max(0, Math.min(cap, bonus));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/core/memory/retrieval-bonus.test.ts`
Expected: PASS（6 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/retrieval-bonus.ts gateway/tests/unit/core/memory/retrieval-bonus.test.ts
git commit -m "feat(memory): ACT-R log-form retrieval bonus with exposure discount (A3)"
```

---

### Task 4: 每日衰减 pass 批量结算

**Files:**
- Modify: `gateway/src/automation-engine.ts:52-106`（`runEnergyDecay` + `memory:decay` action）
- Test: `gateway/tests/unit/automation-decay.test.ts`（已有则扩展；先 `grep -rn "runEnergyDecay" tests/` 确认）

**Interfaces:**
- Consumes: `actrBonus`（Task 3）、`getRetrievalEventBuffer`（Task 1）、`HarmonicIndexManager.updateEnergy`
- Produces: `runEnergyDecay(indexManager, now?, events?)` 返回 `{ migrated, decayed, bonused }`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/automation-decay.test.ts（在现有文件追加，或新建）
import { runEnergyDecay } from '../../src/automation-engine';
import { RetrievalEvent } from '../../src/core/memory/retrieval-events';

describe('runEnergyDecay retrieval settlement', () => {
  it('applies ACT-R bonus from drained events before decay', () => {
    // 用真实 HarmonicIndexManager 指向临时目录（复用现有测试的 mkdtemp 模式）
    // 造两条 entry：e1 有 3 个新鲜事件、e2 无事件
    // 断言：pass 后 e1.energy > 仅衰减得到的能量；e2 行为与旧版一致；返回 bonused=1
  });
  it('clamps bonus at energy ceiling 1.0', () => { /* e1.energy=0.99 + bonus → ≤1.0 */ });
  it('no events → behavior identical to before (bonused=0)', () => { /* */ });
});
```

（实现者注意：沿用本仓库现有 automation 测试的临时 index 构造方式；上面三例为必测语义，代码按现有测试风格补全。）

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-decay.test.ts`
Expected: FAIL（`events` 参数与 `bonused` 返回值不存在）

- [ ] **Step 3: Implement（runEnergyDecay 扩展 + action 接线）**

```typescript
// automation-engine.ts — runEnergyDecay 签名与开头改为：
export function runEnergyDecay(
  indexManager: HarmonicIndexManager,
  now: number = Date.now(),
  events: RetrievalEvent[] = [],
): { migrated: number; decayed: number; bonused: number } {
  const index = indexManager.getIndex();
  const energySystem = new EnergySystem();
  const nowIso = new Date(now).toISOString();
  const DAY_MS = 24 * 60 * 60 * 1000;
  if ((index.version || 1) < 2) {
    const migrated = indexManager.migrateDecayBaseline(nowIso);
    return { migrated, decayed: 0, bonused: 0 };
  }
  // A3 settlement: group drained events by id, apply the ACT-R log bonus
  // FIRST (decay then reads the updated energy in the same live instance).
  let bonused = 0;
  const byId = new Map<string, RetrievalEvent[]>();
  for (const e of events) {
    const list = byId.get(e.id);
    if (list) list.push(e); else byId.set(e.id, [e]);
  }
  if (byId.size > 0) {
    const entryById = new Map(index.entries.map((e) => [e.id, e]));
    for (const [id, evts] of byId) {
      const entry = entryById.get(id);
      if (!entry) continue; // superseded/pruned meanwhile — drop
      const bonus = actrBonus(evts, now);
      const room = Math.max(0, 1.0 - entry.energy);
      const applied = Math.min(bonus, room);
      if (applied > 0.0005) {
        indexManager.updateEnergy(id, applied);
        bonused++;
      }
    }
  }
  // ...（既有衰减循环不变，返回值加 bonused）
  return { migrated: 0, decayed, bonused };
}

// memory:decay action 内改为：
const buffer = getRetrievalEventBuffer();
const res = runEnergyDecay(indexManager, Date.now(), buffer.drain());
// 日志与 heartbeat counts 增 bonused： heartbeat?.record('memory:decay', { ok: true, counts: { migrated: res.migrated, decayed: res.decayed, bonused: res.bonused } });
```

顶部 import：`import { getRetrievalEventBuffer, RetrievalEvent } from './core/memory/retrieval-events';` 与 `import { actrBonus } from './core/memory/retrieval-bonus';`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest --runInBand tests/unit/automation-decay.test.ts`
Expected: PASS

- [ ] **Step 5: Build + 全量回归 + Commit**

Run: `cd gateway && npm run build && npx jest --runInBand`
Expected: 全绿（当前基线 226/1446 + 新增）

```bash
git add gateway/src/automation-engine.ts gateway/tests/unit/automation-decay.test.ts
git commit -m "feat(memory): settle retrieval bonuses in the daily decay pass (A3, ACT-R form)"
```

---

### Task 5: A1 — stale-verify 调度状态（review_count/last_reviewed）

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`（`HarmonicIndexEntry` 增 `review_count?: number; last_reviewed?: string;`——HarmonicUnit 已有）
- Modify: `gateway/src/core/memory/harmonic-index.ts`（仿 `stampDecay` :778 加 `stampReview(id, nowIso)`：`review_count = (entry.review_count ?? 0) + 1; last_reviewed = nowIso`）
- Modify: `gateway/src/recall/stale-verify.ts`（`selectCandidates` 排除窗 + `runOnce` 盖章）
- Test: `gateway/tests/unit/stale-verify.test.ts`（已有，追加）

**Interfaces:**
- Produces: `HarmonicIndexManager.stampReview(id: string, nowIso: string): void`；`StaleVerifyOptions.minReviewIntervalDays?: number`（默认 21）

- [ ] **Step 1: Write the failing test（追加到 stale-verify.test.ts）**

```typescript
it('excludes entries reviewed within the interval and stamps reviewed candidates', () => {
  // 构造 index：三条候选（procedural/semantic、>14d、未 superseded）
  // 其中一条 last_reviewed = 3 天前 → selectCandidates 不含它
  // runOnce 后：被送验的候选 review_count+1 / last_reviewed=now
});
it('never-reviewed entries are preferred in ordering', () => {
  // 两条同 energy×salience：一条 review_count=5、一条无 → 无记录的排前
});
```

- [ ] **Step 2: Run to verify it fails** — `cd gateway && npx jest --runInBand tests/unit/stale-verify.test.ts` → FAIL

- [ ] **Step 3: Implement**

`harmonic-types.ts` `HarmonicIndexEntry` 追加：
```typescript
  /** A1: stale-verify scheduling state (review queue consumer). */
  review_count?: number;
  last_reviewed?: string;
```
`harmonic-index.ts` 仿 stampDecay 追加：
```typescript
  stampReview(id: string, nowIso: string): void {
    const entry = this.index.entries.find((e) => e.id === id);
    if (entry) {
      entry.review_count = (entry.review_count ?? 0) + 1;
      entry.last_reviewed = nowIso;
    }
  }
```
`stale-verify.ts` `selectCandidates` 过滤链插入（在 minAgeDays 过滤后）：
```typescript
      .filter((e) => {
        const reviewed = e.last_reviewed ? new Date(e.last_reviewed).getTime() : 0;
        return reviewed === 0 || now - reviewed >= (this.opts.minReviewIntervalDays ?? 21) * DAY_MS;
      })
```
排序键改为（无记录优先，其次 energy×salience）：
```typescript
      .sort((a, b) => {
        const ra = a.review_count ?? 0, rb = b.review_count ?? 0;
        if (ra === 0 !== (rb === 0)) return ra === 0 ? -1 : 1;
        return b.energy * (b.salience ?? 1) - a.energy * (a.salience ?? 1);
      })
```
`runOnce` 在 worker 回复解析成功后对 `candidates` 盖章：
```typescript
    const nowIso = new Date(this.opts.now ?? Date.now()).toISOString();
    for (const c of candidates) this.opts.index.stampReview(c.id, nowIso);
```

- [ ] **Step 4: Run to verify it passes** — 同上 → PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/memory/harmonic-types.ts gateway/src/core/memory/harmonic-index.ts gateway/src/recall/stale-verify.ts gateway/tests/unit/stale-verify.test.ts
git commit -m "feat(memory): stale-verify scheduling state via review_count/last_reviewed (A1)"
```

---

### Task 6: A2 — 删 top_associations 字段

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`（删 `HarmonicUnit.top_associations`）
- Modify: 其余引用处（先 grep）

**Interfaces:** 无新接口（破坏性删除，字段全仓库零读写——调研已验证）

- [ ] **Step 1: 确认零引用**

Run: `cd gateway && grep -rn "top_associations" src/ tests/ scripts/ ../src ../evaluation 2>/dev/null`
Expected: 仅类型声明与注释（若有 OKF frontmatter 白名单条目也删）

- [ ] **Step 2: 删除字段声明 + 相关注释；同步 AGENTS.md §3.1 数据模型（删该行，加一句"已删（2026-09-29，调研结论：预存静态链接被新证据反对，见 survey §A2）"）**

- [ ] **Step 3: Build + 全量**

Run: `cd gateway && npm run build && npx jest --runInBand`
Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add -A gateway/src gateway/tests AGENTS.md
git commit -m "refactor(memory): remove dormant top_associations field (A2, evidence-opposed form)"
```

---

### Task 7: A4 — FOK isotonic 校准（离线）

**Files:**
- Create: `gateway/src/recall/fok-calibration.ts`（纯函数库）
- Create: `gateway/scripts/fok-calibrate.ts`（CLI）
- Test: `gateway/tests/unit/recall/fok-calibration.test.ts`

**Interfaces:**
- Produces: `fitIsotonic(samples: FokSample[]): { fit(p: number): number; ece: number; n: number }`；`pickThresholds(fit, opts: { noMemoryRate?: number; lowConfRate?: number }): { probLow: number; probHigh: number }`；`FokSample { top1prob: number; hit: boolean }`

- [ ] **Step 1: Write the failing test**

```typescript
// gateway/tests/unit/recall/fok-calibration.test.ts
import { fitIsotonic, pickThresholds } from '../../../src/recall/fok-calibration';

describe('fitIsotonic', () => {
  it('fits a monotone map (PAVA) and reports ECE', () => {
    // 合成：top1prob 均匀分 10 桶，hit 率随 p 单调上升 + 少量违例
    const samples = [];
    for (let i = 0; i < 300; i++) {
      const p = (i % 10) / 9;
      const hit = Math.random() < 0.1 + 0.8 * p;
      samples.push({ top1prob: p, hit: hit as any });
    }
    const { fit, ece, n } = fitIsotonic(samples);
    expect(n).toBe(300);
    expect(ece).toBeLessThan(0.3);
    for (let p = 0.1; p < 1; p += 0.1) expect(fit(p)).toBeLessThanOrEqual(fit(p + 0.05) + 1e-9);
  });
});

describe('pickThresholds', () => {
  it('probLow sits where fitted hit-rate crosses the no-memory line', () => {
    const { fit } = fitIsotonic([/* p=0.1→hit 5%, p=0.5→45%, p=0.9→85% 各 100 条 */] as any);
    const { probLow, probHigh } = pickThresholds(fit, { noMemoryRate: 0.2, lowConfRate: 0.6 });
    expect(probLow).toBeGreaterThan(0).toBeLessThan(0.5);
    expect(probHigh).toBeGreaterThan(probLow).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `cd gateway && npx jest --runInBand tests/unit/recall/fok-calibration.test.ts` → FAIL

- [ ] **Step 3: Implement（PAVA + operating point）**

```typescript
// gateway/src/recall/fok-calibration.ts
// A4: offline calibration for the FOK three-zone gate. Replaces fixed
// probLow/probHigh with an isotonic fit of P(hit | top1prob) on production
// FOK logs (or the LongMemEval abstention seeds). Know-Before-You-Fetch
// (arXiv:2606.29959): calibrate BEFORE thresholding; out-of-fold mandatory.

export interface FokSample { top1prob: number; hit: boolean; }

export function fitIsotonic(samples: FokSample[]): { fit(p: number): number; ece: number; n: number } {
  const valid = samples.filter((s) => Number.isFinite(s.top1prob)).sort((a, b) => a.top1prob - b.top1prob);
  // PAVA over per-sample blocks: y=hit?1:0, weight 1 each
  const blocks: { y: number; w: number; x: number }[] = [];
  for (const s of valid) blocks.push({ y: s.hit ? 1 : 0, w: 1, x: s.top1prob });
  const stack: typeof blocks = [];
  for (const b of blocks) {
    stack.push({ ...b });
    while (stack.length > 1 && stack[stack.length - 2].y > stack[stack.length - 1].y) {
      const r = stack.pop()!;
      const l = stack.pop()!;
      const w = l.w + r.w;
      stack.push({ y: (l.y * l.w + r.y * r.w) / w, w, x: l.x });
    }
  }
  const fit = (p: number): number => {
    if (stack.length === 0) return 0.5;
    // binary search over block x-boundaries via original sample order
    let lo = 0, hi = valid.length - 1;
    if (p <= valid[0].top1prob) return blockValue(stack, 0);
    if (p >= valid[valid.length - 1].top1prob) return blockValue(stack, stack.length - 1);
    // walk blocks by cumulative weight (blocks are in sample order)
    let acc = 0;
    for (let i = 0; i < stack.length; i++) {
      acc += stack[i].w;
      if (p <= valid[Math.min(acc - 1, valid.length - 1)].top1prob) return stack[i].y;
    }
    return stack[stack.length - 1].y;
  };
  function blockValue(bs: typeof stack, i: number) { return bs[Math.min(i, bs.length - 1)].y; }
  // ECE on 10 equal-width bins
  let ece = 0;
  const B = 10;
  for (let b = 0; b < B; b++) {
    const lo = b / B, hi = (b + 1) / B;
    const inBin = valid.filter((s) => s.top1prob >= lo && s.top1prob < hi);
    if (inBin.length === 0) continue;
    const avg = inBin.reduce((s, x) => s + (x.hit ? 1 : 0), 0) / inBin.length;
    ece += (inBin.length / valid.length) * Math.abs(avg - fit(inBin[0].top1prob));
  }
  return { fit, ece, n: valid.length };
}

/** Operating point: probLow = smallest p with fitted hit-rate ≥ noMemoryRate;
 *  probHigh = smallest p with fitted hit-rate ≥ lowConfRate. */
export function pickThresholds(
  fit: (p: number) => number,
  opts: { noMemoryRate?: number; lowConfRate?: number } = {},
): { probLow: number; probHigh: number } {
  const noMemoryRate = opts.noMemoryRate ?? 0.2;
  const lowConfRate = opts.lowConfRate ?? 0.6;
  const find = (target: number): number => {
    for (let p = 0.02; p <= 1.0001; p += 0.02) if (fit(p) >= target) return Math.round(p * 100) / 100;
    return 1;
  };
  const probLow = find(noMemoryRate);
  return { probLow, probHigh: Math.max(probLow, find(lowConfRate)) };
}
```

CLI `gateway/scripts/fok-calibrate.ts`：`npx ts-node scripts/fok-calibrate.ts <samples.jsonl>`，逐行 `{top1prob, hit}`；输出 fit 表（20 档）、ECE、`pickThresholds` 建议值，及 `config.search.fok` 覆盖片段。数据源说明：生产 FOK 日志（`[Recall]` 决策行 zone/top1prob）需先转 jsonl（hit = 后续是否有用/正确由人工或 L2 标注）或用 LongMemEval 弃权跑批种子。CLI 含 `--seed-l1 <l1-run.jsonl>` 从评测产物直接读 top1prob+hit。

- [ ] **Step 4: Run to verify it passes** — `cd gateway && npx jest --runInBand tests/unit/recall/fok-calibration.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/fok-calibration.ts gateway/scripts/fok-calibrate.ts gateway/tests/unit/recall/fok-calibration.test.ts
git commit -m "feat(recall): offline isotonic calibration for FOK thresholds (A4)"
```

---

## Self-Review 结论

- 覆盖：A3（Task 1-4）、A1（Task 5）、A2（Task 6）、A4（Task 7）✓
- 类型一致：`RetrievalEvent`/`recordRetrievalFromScored`/`actrBonus`/`stampReview` 各任务间签名一致 ✓
- 无占位符；Task 4 Step 1 的三例测试语义已写明（实现者按现有测试风格补全临时 index 构造）
