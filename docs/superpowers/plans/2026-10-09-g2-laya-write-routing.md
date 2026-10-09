# G2 写相路由（laya 冗余门）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 route-write 中间带插入 laya 冗余门——高置信冗余 → 沉底（energy 0.05 + `redundant:<id>` 锚）+ 覆盖条目 actrBonus 强化，跳过 LLM judge；默认 observe-only（tauRedundantHigh=1.0）。

**Architecture:** `LayaConflictClient.askPair` 一次 `/v1/predict` 双问题（conflict+redundant）→ `decideRouting` 中间带新 `redundant` 出口 → `routeAndWrite` 沉底+强化 → `consolidateInner` 守卫防二次处理 → `laya-calibrate.proposeTauRedundantHigh` 校准 → config/index 接线。

**Tech Stack:** TypeScript / jest / 既有 laya sidecar 契约（`/v1/predict` 多 questions）。

**Spec:** `docs/superpowers/specs/2026-10-09-laya-write-routing-design.md`（v2，route-write 挂法）

## Global Constraints

- TDD：每个任务先写失败测试再实现
- 全部 fail-open：laya null / onRoute 抛错 / readUnit 失败 → 落回现有 judge 路径
- 默认 `tauRedundantHigh: 1.0`（observe-only，零行为变化）
- 测试 import 路径 `../../../src/...`；中文内容只经 write/edit 工具
- 改 `gateway/src/index.ts` 后必须 root `npm run build` 验证（jest 不 typecheck index.ts）
- 全量门禁：`cd gateway && npx jest --runInBand`（基线 1826）
- commit 到 main

---

### Task 1: laya-client `askPair` 双问题

**Files:**
- Modify: `gateway/src/memory/laya-client.ts`
- Test: `gateway/tests/unit/memory/laya-client.test.ts`

**Interfaces:**
- Produces: `REDUNDANT_QUESTION`（const）；`LayaConflictClient.askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null>`。`askConflict` 签名不变（consolidation-service.ts:305 在用）。

- [ ] **Step 1: 写失败测试**（追加到 laya-client.test.ts）

```typescript
import { LayaConflictClient, CONFLICT_QUESTION, REDUNDANT_QUESTION } from '../../../src/memory/laya-client';

describe('askPair', () => {
  const deps = (fetchFn: any) => ({ url: 'http://127.0.0.1:13129', timeoutMs: 50, fetchFn });

  it('sends both questions in one call and returns both scores', async () => {
    let captured: any;
    const fetchFn = (async (_url: string, init: any) => {
      captured = JSON.parse(init.body);
      return new Response(JSON.stringify({ answers: { conflict: { noul: 0.2 }, redundant: { noul: 0.93 } } }), { status: 200 });
    }) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('已知', '新信息');
    expect(captured.questions.conflict).toEqual(CONFLICT_QUESTION);
    expect(captured.questions.redundant).toEqual(REDUNDANT_QUESTION);
    expect(r).toEqual({ pConflict: 0.2, pRedundant: 0.93 });
  });

  it('missing redundant field → pRedundant null, overall non-null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ answers: { conflict: { noul: 0.4 } } }), { status: 200 })) as any;
    const r = await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b');
    expect(r).toEqual({ pConflict: 0.4, pRedundant: null });
  });

  it('total failure → null', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ error: 'x' }), { status: 500 })) as any;
    expect(await new LayaConflictClient(deps(fetchFn)).askPair('a', 'b')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/laya-client.test.ts`
Expected: FAIL（REDUNDANT_QUESTION / askPair 不存在）

- [ ] **Step 3: 实现**（laya-client.ts）

在 `CONFLICT_QUESTION` 后加：

```typescript
/** G2 write-routing redundancy question — separate contract from CONFLICT_QUESTION,
 *  calibrated independently (observe-first, tauRedundantHigh default 1.0). */
export const REDUNDANT_QUESTION = {
  type: 'noul',
  instructions: '新信息(new)是否已被已有记忆(known)覆盖？覆盖=known已包含new的实质内容，new不带来新事实',
  labels: { false: '未覆盖', true: '已覆盖' },
} as const;
```

类中加方法（复用同一熔断器状态）：

```typescript
  async askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null> {
    if (Date.now() < this.breakerOpenUntil) return null;
    try {
      const resp = await Promise.race([
        this.fetchFn(`${this.url}/v1/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: { known, new: newInfo },
            questions: { conflict: CONFLICT_QUESTION, redundant: REDUNDANT_QUESTION },
          }),
        }),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error('laya timeout')), this.timeoutMs);
          timer.unref?.();
        }),
      ]) as Response;
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const pc = data?.answers?.conflict?.noul;
      const pr = data?.answers?.redundant?.noul;
      const pConflict = typeof pc === 'number' && Number.isFinite(pc) ? pc : null;
      const pRedundant = typeof pr === 'number' && Number.isFinite(pr) ? pr : null;
      if (pConflict === null && pRedundant === null) return null;
      this.consecutiveFails = 0;
      return { pConflict, pRedundant };
    } catch (err: any) {
      this.consecutiveFails++;
      if (this.consecutiveFails >= 3) {
        this.breakerOpenUntil = Date.now() + this.breakerCooldownMs;
        this.consecutiveFails = 0;
        log.warn(`[Laya] circuit breaker open for ${this.breakerCooldownMs / 1000}s (${err?.message || err})`);
      }
      return null;
    }
  }
```

注意：`consecutiveFails` / `breakerOpenUntil` 现为 private——同类内新方法直接可用，无需改可见性。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd gateway; npx jest tests/unit/memory/laya-client.test.ts`
Expected: PASS（9 个）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/laya-client.ts gateway/tests/unit/memory/laya-client.test.ts
git commit -m "feat: laya askPair dual-question (conflict+redundant) client"
```

---

### Task 2: route-write 冗余门（decideRouting）

**Files:**
- Modify: `gateway/src/memory/route-write.ts`
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `askPair`
- Produces:
  - `RoutingOutcome` 增 `{ action: 'redundant'; targetId: string; pRedundant: number }`
  - `RouteAuditRecord`（interface，导出）
  - `RouteWriteDeps` 增 `laya?` / `readUnit?` / `onRoute?`
  - 内部 helper `emitRoute(deps, unit, hits, verdict, decidedBy, redundantScores?)`（非导出）

- [ ] **Step 1: 写失败测试**（追加到 route-write.test.ts 的 `describe('decideRouting')`）

```typescript
describe('laya redundant gate', () => {
  const bandVec: [number, number] = [0.9, 0.44]; // cos ≈ 0.898 → 中间带
  const layaDeps = (pRedundant: number | null, judged: { n: number }) => ({
    laya: {
      client: { askPair: async () => (pRedundant === null ? null : { pConflict: 0.1, pRedundant }) },
      tauRedundantHigh: 0.9,
    },
    readUnit: async () => ({ memory_value: '已知内容' }),
    judge: async () => { judged.n++; return { action: 'create' as const }; },
  });

  test('pRedundant >= tau → redundant outcome, judge NOT called', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const judged = { n: 0 };
    const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.95, judged) });
    expect(out).toEqual({ action: 'redundant', targetId: 'old', pRedundant: 0.95 });
    expect(judged.n).toBe(0);
  });

  test('pRedundant < tau → judge called as before', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const judged = { n: 0 };
    const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.5, judged) });
    expect(out.action).toBe('create');
    expect(judged.n).toBe(1);
  });

  test('askPair null → fail-open to judge', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const judged = { n: 0 };
    const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(null, judged) });
    expect(out.action).toBe('create');
    expect(judged.n).toBe(1);
  });

  test('no laya dep → behavior byte-identical to before', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const judged = { n: 0 };
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged.n++; return { action: 'create' as const }; } });
    expect(out.action).toBe('create');
    expect(judged.n).toBe(1);
  });

  test('onRoute receives audit row with redundantScores', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const rows: any[] = [];
    const judged = { n: 0 };
    await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.95, judged), onRoute: (r) => rows.push(r) });
    expect(rows).toHaveLength(1);
    expect(rows[0].decidedBy).toBe('laya-redundant');
    expect(rows[0].verdict).toBe('redundant');
    expect(rows[0].redundantScores).toEqual([{ id: 'old', p: 0.95 }]);
    expect(rows[0].candidates[0].id).toBe('old');
  });

  test('onRoute throwing does not break routing (fail-open)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', bandVec);
    const judged = { n: 0 };
    const out = await decideRouting(u('n1'), {
      vectors: v, provider, ...layaDeps(0.95, judged),
      onRoute: () => { throw new Error('audit down'); },
    });
    expect(out.action).toBe('redundant');
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts`
Expected: FAIL（'redundant' 不是已知 outcome）

- [ ] **Step 3: 实现**（route-write.ts）

顶部 import 区加（文件头注释不动）：

```typescript
import { getRetrievalEventBuffer } from '../core/memory/retrieval-events';
```

`RoutingOutcome` 加一个成员：

```typescript
export type RoutingOutcome =
  | { action: 'skip'; targetId: string }
  | { action: 'create' }
  | { action: 'update'; targetId: string }
  | { action: 'separate'; targetId: string; distinction?: string }
  | { action: 'redundant'; targetId: string; pRedundant: number };
```

`RouteWriteDeps` 加三个字段（`RouteAuditRecord` 一并导出）：

```typescript
export interface RouteAuditRecord {
  newId: string;
  newAbstraction: string;
  candidates: Array<{ id: string; cosine: number }>;
  redundantScores?: Array<{ id: string; p: number }>;
  verdict: 'create' | 'update' | 'separate' | 'skip' | 'redundant';
  decidedBy: 'fast-path' | 'dup' | 'laya-redundant' | 'llm-route';
  ts: number;
}

// 在 RouteWriteDeps 内：
  /** G2 laya redundancy gate for the candidate band (tauRedundantHigh 1.0 = observe-only). */
  laya?: {
    client: { askPair(known: string, newInfo: string): Promise<{ pConflict: number | null; pRedundant: number | null } | null> };
    tauRedundantHigh: number;
    maxTextChars?: number;
  };
  /** Read a candidate's full text (laya needs memory_value; readEntry has only the abstraction). */
  readUnit?: (id: string) => Promise<{ memory_value?: string } | null>;
  /** Audit sink for calibration data — one row per contested write. Fail-open. */
  onRoute?: (record: RouteAuditRecord) => void;
```

`decideRouting` 中 dup 检查之后、judge 之前插入冗余门；helper 放文件底部：

```typescript
function emitRoute(
  deps: RouteWriteDeps,
  unit: HarmonicUnit,
  hits: Array<{ id: string; cosine: number }>,
  verdict: RouteAuditRecord['verdict'],
  decidedBy: RouteAuditRecord['decidedBy'],
  redundantScores?: Array<{ id: string; p: number }>,
): void {
  try {
    deps.onRoute?.({
      newId: unit.id,
      newAbstraction: unit.primary_abstraction,
      candidates: hits.map((h) => ({ id: h.id, cosine: +h.cosine.toFixed(4) })),
      redundantScores,
      verdict,
      decidedBy,
      ts: Date.now(),
    });
  } catch { /* fail-open */ }
}
```

decideRouting 插入段（位于 `const candidateIds = ...` 之前；dup 分支的 skip return 处也补一行 `emitRoute(deps, unit, hits, 'skip', 'dup')`）：

```typescript
  // G2 laya redundancy gate (write-phase routing): high-confidence "already
  // covered" → redundant outcome, skipping the LLM judge. Observe-only while
  // tauRedundantHigh = 1.0 (scores still flow to the audit for calibration).
  let redundantScores: Array<{ id: string; p: number }> | undefined;
  if (deps.laya && deps.readUnit) {
    const laya = deps.laya;
    const cap = laya.maxTextChars ?? 800;
    const trunc = (s: string) => String(s ?? '').slice(0, cap);
    const scores: Array<{ id: string; p: number }> = [];
    let bestR: { id: string; p: number } | null = null;
    for (const h of hits.slice(0, maxCand)) {
      let targetText: string | undefined;
      try { targetText = (await deps.readUnit(h.id))?.memory_value; } catch { continue; }
      if (!targetText) continue;
      const r = await laya.client.askPair(trunc(targetText), trunc(unit.memory_value));
      if (r?.pRedundant == null) continue;
      scores.push({ id: h.id, p: r.pRedundant });
      if (!bestR || r.pRedundant > bestR.p) bestR = { id: h.id, p: r.pRedundant };
    }
    if (scores.length > 0) redundantScores = scores;
    if (bestR && bestR.p >= laya.tauRedundantHigh) {
      emitRoute(deps, unit, hits, 'redundant', 'laya-redundant', redundantScores);
      return { action: 'redundant', targetId: bestR.id, pRedundant: bestR.p };
    }
  }
```

judge 路径的既有 return 处补审计（`verdict` 有效时 decidedBy 'llm-route'，verdict 为 update/separate/create 原样记入；fail-open create 处记 `'llm-route'` + verdict 'create'）。无候选的早退（`hits.length === 0`）**不**记审计（控制文件体积）。

- [ ] **Step 4: 跑测试确认绿**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts`
Expected: PASS（既有 13 + 新 6）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/tests/unit/memory/route-write.test.ts
git commit -m "feat: laya redundant gate in write-phase routing (decideRouting)"
```

---

### Task 3: routeAndWrite 沉底 + 强化 + 统计

**Files:**
- Modify: `gateway/src/memory/route-write.ts`
- Test: `gateway/tests/unit/memory/route-write.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `{ action: 'redundant'; targetId; pRedundant }`
- Produces: `getRouteStats()` 返回类型增 `redundant: number`

- [ ] **Step 1: 写失败测试**（追加到 `describe('routeAndWrite')`）

```typescript
import { setRetrievalEventBufferForTest, RetrievalEventBuffer } from '../../../src/core/memory/retrieval-events';

  test('redundant → sunk write (energy 0.05 + redundant anchor) + reinforcement event', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.44]);
    const s = memStore([u('old')]);
    const buf = new RetrievalEventBuffer();
    setRetrievalEventBufferForTest(buf);
    try {
      const out = await routeAndWrite(u('n1'), s as any, {
        vectors: v,
        provider,
        laya: { client: { askPair: async () => ({ pConflict: 0.1, pRedundant: 0.97 }) }, tauRedundantHigh: 0.9 },
        readUnit: async () => ({ memory_value: '已知内容' }),
        judge: async () => { throw new Error('judge must not be called'); },
      });
      expect(out).toEqual({ action: 'redundant', id: 'n1', targetId: 'old' });
      expect(s.writes).toHaveLength(1);
      expect(s.writes[0].energy).toBe(0.05);
      expect(s.writes[0].cue_anchors).toContain('redundant:old');
      const drained = buf.drain();
      expect(drained).toHaveLength(1);
      expect(drained[0].id).toBe('old');
      expect(drained[0].prob).toBe(0.97);
    } finally {
      setRetrievalEventBufferForTest(null);
    }
  });

  test('getRouteStats includes redundant counter', async () => {
    const stats = getRouteStats();
    expect(typeof stats.redundant).toBe('number');
  });
```

（`getRouteStats` 加入既有 import 行。）

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts -t redundant`
Expected: FAIL

- [ ] **Step 3: 实现**（route-write.ts）

`routeStats` 加 redundant：

```typescript
const routeStats = { create: 0, skip: 0, update: 0, separate: 0, redundant: 0 };

export function getRouteStats(): { create: number; skip: number; update: number; separate: number; redundant: number } {
  return { ...routeStats };
}
```

`routeAndWrite` 在 skip 分支后加 redundant 分支：

```typescript
  if (decision.action === 'redundant') {
    // Sink, not drop: energy 0.05 + provenance anchor keeps the entry
    // BM25-recoverable (misjudgment reversible) while decay pushes it below
    // retrieval visibility within days. The covering entry gets a synthetic
    // ACT-R exposure — repetition strengthens the existing trace (Hebbian),
    // settled by the daily decay pass via actrBonus.
    const sunk: HarmonicUnit = {
      ...unit,
      energy: 0.05,
      cue_anchors: dedupeCap([...(unit.cue_anchors || []), `redundant:${decision.targetId}`], 8),
      updated_at: new Date().toISOString(),
    };
    await store.write(sunk, undefined, { skipMerge: true });
    try {
      getRetrievalEventBuffer().record({ id: decision.targetId, prob: decision.pRedundant, kind: 'recall', ts: Date.now() });
    } catch { /* fail-open */ }
    routeStats.redundant++;
    return { action: 'redundant', id: sunk.id, targetId: decision.targetId };
  }
```

返回类型改为 `Promise<{ action: 'skip' | 'create' | 'update' | 'separate' | 'redundant'; id: string; targetId?: string }>`。

- [ ] **Step 4: 跑测试确认绿 + 全量回归**

Run: `cd gateway; npx jest tests/unit/memory/route-write.test.ts`
Expected: PASS；再 `npx jest --runInBand` 全量绿（基线 1826+ 本批新增）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/route-write.ts gateway/tests/unit/memory/route-write.test.ts
git commit -m "feat: redundant sink + Hebbian reinforcement in routeAndWrite"
```

---

### Task 4: consolidation 防二次处理守卫

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`
- Test: `gateway/tests/unit/memory/consolidation-cascade.test.ts`（若无合适位置则 consolidation-service.test.ts，按既有风格）

- [ ] **Step 1: 写失败测试**

```typescript
  it('skips units carrying a redundant: anchor (sunk by write-phase routing)', async () => {
    const svc = new ConsolidationService(makeDeps());
    const unit = makeUnit({ cue_anchors: ['x', 'redundant:mem_covering'] });
    const out = await svc.consolidate(unit as any);
    expect(out).toEqual({ action: 'skip', reason: 'redundant-sink' });
  });
```

（`makeDeps`/`makeUnit` 参照该测试文件既有 helper 名；若不存在则用最小 stub：store.read→null、vectors/provider 不会被触达因为守卫在最前。）

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/consolidation-cascade.test.ts`
Expected: FAIL（outcome 不是 redundant-sink）

- [ ] **Step 3: 实现**（consolidation-service.ts，`consolidateInner` 的 `no-unit` 检查之后）

```typescript
    // G2: units sunk by write-phase routing (redundant:<id> anchor) must not be
    // re-consolidated — the routing decision already disposed of them.
    if (unit.cue_anchors?.some((a) => typeof a === 'string' && a.startsWith('redundant:'))) {
      return { action: 'skip', reason: 'redundant-sink' };
    }
```

- [ ] **Step 4: 跑测试确认绿**

Run: `cd gateway; npx jest tests/unit/memory/consolidation`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/consolidation-cascade.test.ts
git commit -m "feat: consolidation skips redundant-sunk units"
```

---

### Task 5: 校准器 `proposeTauRedundantHigh` + 脚本双提议

**Files:**
- Modify: `gateway/src/memory/laya-calibrate.ts`
- Modify: `gateway/scripts/calibrate-laya.ts`
- Test: `gateway/tests/unit/memory/laya-calibrate.test.ts`

**Interfaces:**
- Consumes: `RouteAuditRecord` 形状（`redundantScores`，task 2）
- Produces: `proposeTauRedundantHigh(records): { proposal: { tauRedundantHigh, maxUpdateP, above, scoredPairs, updatePairs } | null; reason?: string }`

- [ ] **Step 1: 写失败测试**（追加到 laya-calibrate.test.ts）

```typescript
import { proposeTauRedundantHigh } from '../../../src/memory/laya-calibrate';

describe('proposeTauRedundantHigh', () => {
  const rec = (p: number | null, verdict: string) => ({
    redundantScores: p === null ? undefined : [{ id: 'c', p }],
    verdict,
    ts: 1,
  });

  it('returns null when fewer than 50 scored records', () => {
    const records = Array.from({ length: 49 }, () => rec(0.5, 'create'));
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('returns null when fewer than 5 update-verdict records', () => {
    const records = [...Array.from({ length: 50 }, () => rec(0.5, 'create')), ...Array.from({ length: 4 }, () => rec(0.2, 'update'))];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('returns null when update band reaches 0.99 (no safe line)', () => {
    const records = [...Array.from({ length: 50 }, () => rec(0.6, 'create')), ...Array.from({ length: 5 }, () => rec(0.99, 'update'))];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('proposes T = maxUpdate + 0.01 when separable with >= 3 non-update above', () => {
    const records = [
      ...Array.from({ length: 45 }, () => rec(0.3, 'create')),
      ...Array.from({ length: 5 }, () => rec(0.6, 'update')),
      ...Array.from({ length: 5 }, () => rec(0.95, 'create')),
    ];
    const r = proposeTauRedundantHigh(records);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.tauRedundantHigh).toBeCloseTo(0.61, 5);
    expect(r.proposal!.above).toBe(5);
  });

  it('returns null when fewer than 3 non-update records above T', () => {
    const records = [
      ...Array.from({ length: 50 }, () => rec(0.5, 'create')),
      ...Array.from({ length: 5 }, () => rec(0.6, 'update')),
      rec(0.95, 'create'),
    ];
    expect(proposeTauRedundantHigh(records).proposal).toBeNull();
  });

  it('legacy records without redundantScores are skipped, not crashing', () => {
    const records = Array.from({ length: 60 }, () => ({ verdict: 'create', ts: 1 }));
    expect(() => proposeTauRedundantHigh(records as any)).not.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认红**

Run: `cd gateway; npx jest tests/unit/memory/laya-calibrate.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**（laya-calibrate.ts 追加）

```typescript
export interface RoutePairRecord {
  redundantScores?: Array<{ id: string; p: number }>;
  verdict: string;
  decidedBy?: string;
  ts: number;
}

function maxRedundant(r: RoutePairRecord): number | null {
  if (!r.redundantScores || r.redundantScores.length === 0) return null;
  return Math.max(...r.redundantScores.map((s) => s.p));
}

/** Propose tauRedundantHigh from the real distribution. Conservative direction:
 *  above the threshold NO update-verdict record may sit (a covered entry cannot
 *  be one that needed updating). 0.99 ceiling mirrors tauHigh's blindness band. */
export function proposeTauRedundantHigh(
  records: RoutePairRecord[],
): {
  proposal: { tauRedundantHigh: number; maxUpdateP: number; above: number; scoredPairs: number; updatePairs: number } | null;
  reason?: string;
} {
  const scored = records
    .map((r) => ({ p: maxRedundant(r), verdict: r.verdict }))
    .filter((x): x is { p: number; verdict: string } => x.p !== null);
  if (scored.length < MIN_SCORED) {
    return { proposal: null, reason: `need >= ${MIN_SCORED} redundant-scored records, have ${scored.length}` };
  }
  const updates = scored.filter((x) => x.verdict === 'update').map((x) => x.p);
  if (updates.length < MIN_UPDATES) {
    return { proposal: null, reason: `need >= ${MIN_UPDATES} update-verdict records, have ${updates.length}` };
  }
  const maxUpdateP = Math.max(...updates);
  const t = Math.min(1, maxUpdateP + 0.01);
  if (t >= 0.99) {
    return { proposal: null, reason: `update band reaches ${maxUpdateP} — no safe line below 0.99` };
  }
  const above = scored.filter((x) => x.p >= t && x.verdict !== 'update').length;
  if (above < 3) {
    return { proposal: null, reason: `only ${above} non-update record(s) above ${t} — opening the gate is pointless` };
  }
  return { proposal: { tauRedundantHigh: t, maxUpdateP, above, scoredPairs: scored.length, updatePairs: updates.length } };
}
```

脚本（calibrate-laya.ts）输出扩展：

```typescript
import { bucketDistribution, proposeTauLow, proposeTauRedundantHigh, LayaPairRecord } from '../src/memory/laya-calibrate';
// ...末行改为：
console.log(JSON.stringify({
  file,
  conflict: { ...bucketDistribution(records), ...proposeTauLow(records) },
  redundant: proposeTauRedundantHigh(records as any),
}, null, 2));
```

- [ ] **Step 4: 跑测试确认绿**

Run: `cd gateway; npx jest tests/unit/memory/laya-calibrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/laya-calibrate.ts gateway/scripts/calibrate-laya.ts gateway/tests/unit/memory/laya-calibrate.test.ts
git commit -m "feat: tauRedundantHigh calibration proposer"
```

---

### Task 6: config + index.ts 接线

**Files:**
- Modify: `gateway/src/config.ts`（~221 laya schema + ~512 默认）
- Modify: `gateway/src/index.ts`（~2660 setRouteWriteDeps 区块）

- [ ] **Step 1: config.ts**

laya schema 加字段（tauLow 注释后）：

```typescript
        /** Write-phase redundancy gate: pRedundant >= tauRedundantHigh → sink
         *  the write without the LLM judge. 1.0 = observe-only (default; open
         *  only after proposeTauRedundantHigh + user approval). */
        tauRedundantHigh?: number;
```

`laya: { enabled: true, url: ..., tauHigh: 0.99, device: 'cpu' }` 默认行加 `tauRedundantHigh: 1.0`。

- [ ] **Step 2: index.ts 接线**（setRouteWriteDeps 调用内加三个键）

```typescript
        laya: layaDeps
          ? { client: layaDeps.client as any, tauRedundantHigh: layaCfg.tauRedundantHigh ?? 1.0 }
          : undefined,
        readUnit: async (id) => judgeStore.read(id),
        onRoute: (record) => {
          try {
            const logsDir = path.join(mafwDir, 'logs');
            fs.mkdirSync(logsDir, { recursive: true });
            fs.appendFileSync(path.join(logsDir, 'consolidation-pairs.jsonl'), JSON.stringify(record) + '\n', 'utf-8');
          } catch { /* fail-open */ }
        },
```

注意 `layaDeps` / `layaCfg` 在该作用域的可见性——layaDeps 定义于 ~1385（initEmbeddingServices 内？），若不可见则把 laya client 单例上提或在 setRouteWriteDeps 处重建 `new LayaConflictClient({ url: layaCfg.url })`（client 无状态，重建零成本）。实现时按实际作用域选其一，测试不覆盖此接线。

- [ ] **Step 3: 验证**

Run: `npm run build`（root）→ exit 0；`cd gateway; npx jest --runInBand` → 全绿

- [ ] **Step 4: Commit**

```bash
git add gateway/src/config.ts gateway/src/index.ts
git commit -m "feat: wire laya redundant gate into write-phase routing"
```

---

### Task 7: 文档收尾

**Files:**
- Modify: `AGENTS.md`（§5.23 加 G2 条目）
- Modify: `docs/research/2026-10-08-brain-like-roadmap.md`（§5 加 G2 行）

- [ ] **Step 1: AGENTS.md §5.23 追加一条**

```markdown
- **G2 写相路由冗余门（2026-10-09）**：route-write 中间带插 laya redundant 问题（`askPair` 双问题同调用）——pRedundant≥tauRedundantHigh → 沉底（energy 0.05 + `redundant:<id>` 锚，可 BM25 捞回）+ 覆盖条目 actrBonus 强化（重复=Hebbian 加强旧痕迹），跳过 LLM judge；consolidation 对 `redundant:` 锚条目 skip（`redundant-sink`）。observe-first：tauRedundantHigh 默认 1.0，校准 `proposeTauRedundantHigh`（保守方向：阈值以上不许有 update verdict）+ 用户批准开闸。spec `docs/superpowers/specs/2026-10-09-laya-write-routing-design.md`。
```

- [ ] **Step 2: roadmap §5 表格加行**

```markdown
| — | ✅ **G2 写相路由（laya 冗余门）** | 已交付（2026-10-09：route-write 冗余门 + 沉底/强化 + observe-first） |
```

- [ ] **Step 3: Commit + 最终门禁**

```bash
git add AGENTS.md docs/research/2026-10-08-brain-like-roadmap.md
git commit -m "docs: G2 laya redundant gate landed"
cd gateway; npx jest --runInBand   # 全绿
```

---

## Self-Review 记录

- Spec §2-§7 全部有对应 task：§3.1→T1，§3.2→T2/T3，§3.3→T4，§3.4→T2（审计在 decideRouting 内），§3.5→T5，§3.6→T6，§7 验收→T6/T7
- 类型一致性：`askPair` 返回 `{pConflict, pRedundant}`（T1 定义，T2 消费）；`redundant` outcome 带 `pRedundant`（T2 产生，T3 消费）；`RouteAuditRecord.redundantScores`（T2 产生，T5 消费）
- 无占位符；T6 的 layaDeps 作用域注意事项已写明两种合法解
