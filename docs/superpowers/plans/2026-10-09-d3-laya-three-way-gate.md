# D3：laya 三值分流器（写入路径 surprise 门控 v1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 consolidation 写路径的 laya 级联从"单侧高置信采纳"升级为**三值分流**：p≥τ_high→UPDATE（现有）、全部候选 p≤τ_low→直接 CREATE（新增，跳过 LLM 判官）、中间带→不知道→转 LLM（现状）。用本地 33ms 判断替代可确定部分的 LLM 调用。

**Architecture:** 改 `ConsolidationService.layaCascade` 消费侧一处（`consolidateInner`），加 `tauLow` 配置 + 统计计数 + 审计 `decidedBy:'laya-low'`；配套纯函数校准分析器读 `consolidation-pairs.jsonl` 提议阈值。CREATE 是判官不可达时的既有 fail-open 行为，本改造只是把"确定无冲突"的部分提前短路，风险面最小。

**Tech Stack:** TypeScript（gateway）、jest、better-sqlite3（不涉及）、laya sidecar（已有）。

## Global Constraints

- **τ_high 保持 0.99 不动**——separate 类失明带（0.899–0.926 假阳性）未解决前永不自动 UPDATE。
- **τ_low 默认 0（=关闭）**——本计划交付后线上行为零变化；开闸需 pairs≥50 的真实分布分析 + 用户显式批准。
- **laya 永不作唯一采纳门**：中间带永远转 LLM；laya client 返回 null（sidecar 挂）= 无分数，照常升级。
- TDD：每个 Task 先写失败测试再实现。
- 测试 import 路径： `tests/unit/memory/` 下用 `../../../src/...`。
- **jest 不 typecheck `gateway/src/index.ts`**——T2 改完必须跑 root `npm run build`。
- commit 用 repo 根相对路径 `git add`。
- 设计依据记忆：`mem_1791526546074_oosl9o`（三值输出约束）、`mem_1790690654778_woaa83`（separate 失明）、`mem_1790690662266_wpynr8`（observe 模式先例）。

---

### Task 1: 三值分流逻辑（consolidation-service）

**Files:**
- Modify: `gateway/src/memory/consolidation-service.ts`（`laya` deps 类型、`JudgedPair.decidedBy`、`consolidateInner` 分流、stats）
- Test: `gateway/tests/unit/memory/consolidation-cascade.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: 现有 `layaCascade()` 返回 `{ scores, adoptedTargetId? }`；`emitPair(unit, candidates, verdict, decidedBy, layaScores?)`。
- Produces: `laya` deps 新增 `tauLow?: number`；stats 新增 `layaCreated`；`JudgedPair.decidedBy` 扩为 `'laya' | 'llm' | 'laya-low'`。Task 2 的 index.ts 接线依赖 `tauLow` 字段名。

- [ ] **Step 1: 写失败测试**（追加到 consolidation-cascade.test.ts 末尾）

```typescript
describe('laya three-way gate (tauLow)', () => {
  it('CREATEs directly when ALL candidate scores <= tauLow (no LLM call)', async () => {
    const h = makeHarness({ p: 0.05, llmVerdict: '{"action":"update","targetId":"old-1"}' });
    // 需要 makeHarness 支持 tauLow —— 本任务同步扩展 harness：
    // laya deps 加 tauLow: opts.tauLow
    (h as any); // placeholder removed by harness extension below
  });
});
```

实际追加的完整代码（含 harness 扩展——把 `makeHarness` 的 opts 加 `tauLow?: number`，laya deps 加 `tauLow: opts.tauLow`）：

```typescript
describe('laya three-way gate (tauLow)', () => {
  it('CREATEs directly when ALL candidate scores <= tauLow (no LLM call)', async () => {
    const h = makeHarness({ p: 0.05, tauLow: 0.1, llmVerdict: '{"action":"update","targetId":"old-1"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('laya-low');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.05 }]);
    const s = h.svc.getStats() as any;
    expect(s.layaCreated).toBe(1);
    expect(s.creates).toBe(1);
    expect(s.judged).toBe(0); // LLM 从未被调用——即使它想说 update
  });

  it('tauLow = 0 (default) keeps legacy escalation', async () => {
    const h = makeHarness({ p: 0.05, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.svc.getStats().judged).toBe(1);
  });

  it('middle band (tauLow < p < tauHigh) still escalates to LLM', async () => {
    const h = makeHarness({ p: 0.5, tauLow: 0.1, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
  });

  it('client null (sidecar down) never auto-CREATEs', async () => {
    const h = makeHarness({ p: null, tauLow: 0.1, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
  });

  it('tauHigh still wins over tauLow when both would match', async () => {
    const h = makeHarness({ p: 0.95, tauHigh: 0.85, tauLow: 0.99, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update'); // 高带优先
    expect(h.pairs[0].decidedBy).toBe('laya');
  });
});
```

harness 扩展（修改文件顶部 makeHarness）：

```typescript
function makeHarness(opts: {
  p?: number | null;
  tauHigh?: number;
  tauLow?: number;               // 新增
  llmVerdict?: string;
}) {
  // ...不变...
    laya: opts.p !== undefined ? {
      client: { askConflict: async () => (opts.p ?? null) as any },
      tauHigh: opts.tauHigh ?? 0.85,
      tauLow: opts.tauLow,       // 新增
    } : undefined,
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/memory/consolidation-cascade.test.ts 2>&1 | Select-Object -Last 10`
Expected: FAIL（`tauLow` 不存在于类型 / decidedBy 无 'laya-low' / layaCreated undefined）

- [ ] **Step 3: 实现**

`gateway/src/memory/consolidation-service.ts` 三处：

① `JudgedPair.decidedBy` 扩展（~line 91）：

```typescript
  decidedBy?: 'laya' | 'llm' | 'laya-low';
```

② `laya` deps 类型加 tauLow + 更新注释（~line 62-70）：

```typescript
  /** Laya conflict cascade (three-way): p >= tauHigh → adopt UPDATE without
   *  LLM; ALL candidate scores <= tauLow → CREATE without LLM (CREATE is the
   *  judge's fail-open outcome anyway, so this only short-circuits certain
   *  no-conflict cases); middle band → LLM judge unchanged. tauLow 0 = off.
   *  tauHigh stays 0.99 in production (separate-class blindness band). */
  laya?: {
    client: { askConflict(known: string, newInfo: string): Promise<number | null> };
    tauHigh: number;
    tauLow?: number;
    maxTextChars?: number;
  };
```

③ `consolidateInner` 分流（在 laya 级联块内、`layaEscalated++` 之前插入低带短路；~line 223-230 区域）：

```typescript
    let layaScores: Array<{ id: string; p: number }> | undefined;
    if (this.laya) {
      const r = await this.layaCascade(unit, liveCandidates);
      layaScores = r.scores.length > 0 ? r.scores : undefined;
      if (r.adoptedTargetId) {
        this.stats.layaAdopted++;
        this.stats.updates++;
        this.emitPair(unit, liveCandidates, 'update', 'laya', layaScores);
        const merged = await this.mergeIntoNewer(unit, r.adoptedTargetId);
        return { action: 'update', targetId: r.adoptedTargetId, mergedId: merged.id };
      }
      // Three-way gate: laya confident "no conflict" with EVERY live candidate
      // → CREATE directly. Only when scores exist (client null = no opinion).
      const tauLow = this.laya.tauLow ?? 0;
      if (tauLow > 0 && r.scores.length > 0 && r.scores.every((s) => s.p <= tauLow)) {
        this.stats.layaCreated++;
        this.stats.creates++;
        this.emitPair(unit, liveCandidates, 'create', 'laya-low', layaScores);
        return { action: 'create' };
      }
      this.stats.layaEscalated++;
    }
```

④ stats 初始化加字段（~line 124）：

```typescript
  private stats = { judged: 0, updates: 0, creates: 0, skipped: 0, layaAdopted: 0, layaEscalated: 0, layaCreated: 0 };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/memory/consolidation-cascade.test.ts 2>&1 | Select-Object -Last 5`
Expected: PASS（含既有 5 例回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/consolidation-service.ts gateway/tests/unit/memory/consolidation-cascade.test.ts
git commit -m "feat: laya three-way gate — tauLow short-circuits no-conflict to CREATE"
```

---

### Task 2: 配置与接线（config + index.ts）

**Files:**
- Modify: `gateway/src/config.ts`（`memory.embedding.laya` 加 `tauLow?: number`）
- Modify: `gateway/src/index.ts`（layaDeps 构造处传 tauLow + 日志）

**Interfaces:**
- Consumes: Task 1 的 `laya.tauLow` 字段。
- Produces: 配置键 `memory.embedding.laya.tauLow`（默认 0）。

- [ ] **Step 1: 改 config.ts 类型注释**（`memory.embedding.laya` 块，tauHigh 注释下方）

```typescript
      laya?: {
        enabled?: boolean;
        url?: string;
        tauHigh?: number;
        /** Three-way gate low threshold: ALL candidate scores <= tauLow →
         *  CREATE without the LLM judge. 0 = off (default; open only after
         *  pairs>=50 calibration + user approval). */
        tauLow?: number;
        device?: string;
      };
```

（若现有块无 `device` 字段以实际为准——只加 `tauLow` 字段与注释，不动其他行。）

- [ ] **Step 2: 改 index.ts layaDeps**（`tauHigh: layaCfg.tauHigh ?? 0.99` 行处）

```typescript
          layaDeps = {
            client: new LayaConflictClient({ url: layaCfg.url }),
            tauHigh: layaCfg.tauHigh ?? 0.99, // 0.99 = adoption gated off until calibrated from real pairs
            tauLow: layaCfg.tauLow ?? 0,      // 0 = three-way gate off until calibrated
          };
          log.info(`[Laya] conflict cascade enabled (tauHigh=${layaDeps.tauHigh}, tauLow=${layaDeps.tauLow}, url=${layaCfg.url})`);
```

- [ ] **Step 3: typecheck + 相关套件**

Run: `npm run build`（root，typecheck index.ts）→ Expected: exit 0
Run: `cd gateway; npx jest tests/unit/memory/ 2>&1 | Select-Object -Last 4` → Expected: 全绿

- [ ] **Step 4: Commit**

```bash
git add gateway/src/config.ts gateway/src/index.ts
git commit -m "feat: wire laya tauLow config (default 0 = off)"
```

---

### Task 3: 校准分析器（laya-calibrate 纯函数 + 脚本）

**Files:**
- Create: `gateway/src/memory/laya-calibrate.ts`
- Create: `gateway/scripts/calibrate-laya.ts`
- Test: `gateway/tests/unit/memory/laya-calibrate.test.ts`

**Interfaces:**
- Consumes: `JudgedPair` 的 jsonl 形态（`layaScores: [{id,p}]`、`verdict: 'create'|'update'`、`decidedBy`）。
- Produces: `proposeTauLow(records, opts?): TauLowProposal`（纯函数）；脚本 `npx ts-node scripts/calibrate-laya.ts [pairsPath]` 打印分布 + 提议 JSON。

- [ ] **Step 1: 写失败测试**

`gateway/tests/unit/memory/laya-calibrate.test.ts`：

```typescript
import { proposeTauLow, bucketDistribution, LayaPairRecord } from '../../../src/memory/laya-calibrate';

const rec = (p: number, verdict: 'create' | 'update'): LayaPairRecord => ({
  layaScores: [{ id: 'x', p }], verdict, decidedBy: 'llm', ts: 0,
});

describe('bucketDistribution', () => {
  test('buckets scores by verdict', () => {
    const recs = [rec(0.05, 'create'), rec(0.92, 'update'), rec(0.07, 'create')];
    const d = bucketDistribution(recs);
    expect(d.byVerdict.create['0.0-0.1']).toBe(2);
    expect(d.byVerdict.update['0.9-1.0']).toBe(1);
    expect(d.total).toBe(3);
  });

  test('records without layaScores are counted separately', () => {
    const d = bucketDistribution([{ verdict: 'create', ts: 0 }]);
    expect(d.noScores).toBe(1);
    expect(d.total).toBe(0);
  });
});

describe('proposeTauLow', () => {
  test('null when fewer than 50 scored pairs', () => {
    const recs = Array.from({ length: 49 }, () => rec(0.05, 'create'));
    expect(proposeTauLow(recs).proposal).toBeNull();
    expect(proposeTauLow(recs).reason).toContain('50');
  });

  test('null when fewer than 5 update pairs (no evidence for the boundary)', () => {
    const recs = [...Array.from({ length: 50 }, () => rec(0.05, 'create')), rec(0.9, 'update')];
    expect(proposeTauLow(recs).proposal).toBeNull();
  });

  test('proposes tauLow below the minimum update-band score', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.05 + Math.random() * 0.05, 'create'));
    const updates = [rec(0.42, 'update'), rec(0.9, 'update'), rec(0.35, 'update'), rec(0.5, 'update'), rec(0.6, 'update')];
    const r = proposeTauLow([...creates, ...updates]);
    expect(r.proposal).not.toBeNull();
    expect(r.proposal!.tauLow).toBeCloseTo(0.35, 5); // min update p
    expect(r.proposal!.maxCreateBelow).toBeGreaterThan(0); // 有 create 落在提议线以下
  });

  test('caps proposal at 0.3 sanity ceiling', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.05, 'create'));
    const updates = [0.8, 0.85, 0.9, 0.88, 0.95].map((p) => rec(p, 'update'));
    const r = proposeTauLow([...creates, ...updates]);
    expect(r.proposal!.tauLow).toBe(0.3); // min update 0.8 → 截到 0.3
  });

  test('null when create scores overlap the update band (no safe line)', () => {
    const creates = Array.from({ length: 50 }, () => rec(0.5, 'create'));
    const updates = [0.42, 0.9, 0.35, 0.5, 0.6].map((p) => rec(p, 'update'));
    expect(proposeTauLow([...creates, ...updates]).proposal).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway; npx jest tests/unit/memory/laya-calibrate.test.ts 2>&1 | Select-Object -Last 5`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`gateway/src/memory/laya-calibrate.ts`：

```typescript
// Calibration analysis for the laya three-way gate. Reads judged-pair audit
// records (consolidation-pairs.jsonl) and proposes tauLow from the REAL
// distribution — the only sanctioned way to open the low band.
// tauHigh is never auto-proposed (separate-class blindness band 0.899–0.926).

export interface LayaPairRecord {
  layaScores?: Array<{ id: string; p: number }>;
  verdict: 'create' | 'update' | string;
  decidedBy?: string;
  ts: number;
}

export interface BucketDistribution {
  total: number;
  noScores: number;
  byVerdict: Record<string, Record<string, number>>;
}

export interface TauLowProposal {
  tauLow: number;
  minUpdateP: number;
  maxCreateBelow: number;
  scoredPairs: number;
  updatePairs: number;
}

const BUCKETS = ['0.0-0.1','0.1-0.2','0.2-0.3','0.3-0.4','0.4-0.5','0.5-0.6','0.6-0.7','0.7-0.8','0.8-0.9','0.9-1.0'];
const MIN_SCORED = 50;
const MIN_UPDATES = 5;
const SANITY_CEILING = 0.3;

function bucketOf(p: number): string {
  const i = Math.min(BUCKETS.length - 1, Math.max(0, Math.floor(p * 10)));
  return BUCKETS[i];
}

/** Max laya score per record (the score the gate would act on). */
function recordScore(r: LayaPairRecord): number | null {
  if (!r.layaScores || r.layaScores.length === 0) return null;
  return Math.max(...r.layaScores.map((s) => s.p));
}

export function bucketDistribution(records: LayaPairRecord[]): BucketDistribution {
  const byVerdict: Record<string, Record<string, number>> = {};
  let total = 0;
  let noScores = 0;
  for (const r of records) {
    const p = recordScore(r);
    if (p === null) { noScores++; continue; }
    total++;
    const v = r.verdict || 'unknown';
    byVerdict[v] = byVerdict[v] ?? {};
    const b = bucketOf(p);
    byVerdict[v][b] = (byVerdict[v][b] ?? 0) + 1;
  }
  return { total, noScores, byVerdict };
}

export function proposeTauLow(
  records: LayaPairRecord[],
): { proposal: TauLowProposal | null; reason?: string } {
  const scored = records
    .map((r) => ({ p: recordScore(r), verdict: r.verdict }))
    .filter((x): x is { p: number; verdict: string } => x.p !== null);
  if (scored.length < MIN_SCORED) {
    return { proposal: null, reason: `need >= ${MIN_SCORED} scored pairs, have ${scored.length}` };
  }
  const updates = scored.filter((x) => x.verdict === 'update').map((x) => x.p);
  if (updates.length < MIN_UPDATES) {
    return { proposal: null, reason: `need >= ${MIN_UPDATES} update-verdict pairs, have ${updates.length}` };
  }
  const minUpdateP = Math.min(...updates);
  const createsBelow = scored.filter((x) => x.verdict === 'create' && x.p < minUpdateP).map((x) => x.p);
  if (createsBelow.length === 0) {
    return { proposal: null, reason: 'no create pairs below the update band — no safe line' };
  }
  const maxCreateBelow = Math.max(...createsBelow);
  // Safe line exists only if NO create score sits above minUpdateP.
  const createsAbove = scored.filter((x) => x.verdict === 'create' && x.p >= minUpdateP).length;
  if (createsAbove > 0) {
    return { proposal: null, reason: `${createsAbove} create pair(s) overlap the update band (>= ${minUpdateP})` };
  }
  return {
    proposal: {
      tauLow: Math.min(minUpdateP, SANITY_CEILING),
      minUpdateP,
      maxCreateBelow,
      scoredPairs: scored.length,
      updatePairs: updates.length,
    },
  };
}
```

`gateway/scripts/calibrate-laya.ts`：

```typescript
// Usage: npx ts-node scripts/calibrate-laya.ts [pairsJsonlPath]
// Default: ~/.mafw/logs/consolidation-pairs.jsonl
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { bucketDistribution, proposeTauLow, LayaPairRecord } from '../src/memory/laya-calibrate';

const file = process.argv[2] ?? path.join(os.homedir(), '.mafw', 'logs', 'consolidation-pairs.jsonl');
if (!fs.existsSync(file)) {
  console.log(JSON.stringify({ error: `not found: ${file}` }));
  process.exit(1);
}
const records: LayaPairRecord[] = fs.readFileSync(file, 'utf-8')
  .split('\n').filter(Boolean)
  .map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean);
console.log(JSON.stringify({ file, ...bucketDistribution(records), ...proposeTauLow(records) }, null, 2));
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway; npx jest tests/unit/memory/laya-calibrate.test.ts 2>&1 | Select-Object -Last 5`
Expected: PASS（7 例）

- [ ] **Step 5: 对真实 pairs 跑一次（只读分析）**

Run: `cd gateway; npx ts-node scripts/calibrate-laya.ts`
Expected: JSON 输出（当前 pairs 9 条 → reason 含 "50"）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/memory/laya-calibrate.ts gateway/scripts/calibrate-laya.ts gateway/tests/unit/memory/laya-calibrate.test.ts
git commit -m "feat: laya tauLow calibration analyzer (pairs jsonl -> threshold proposal)"
```

---

### Task 4: 文档 + 全量门禁

**Files:**
- Modify: `AGENTS.md`（§3.5 consolidation 段补三值门）
- Modify: `docs/research/2026-10-08-brain-like-roadmap.md`（§5 勾销 D3）

- [ ] **Step 1: AGENTS.md §3.5 候选池过滤段后追加**

```markdown
- **三值分流门（D3，2026-10-09）**：laya 级联升级为三值——p≥tauHigh→UPDATE、全部候选 p≤tauLow→直接 CREATE（跳 LLM；CREATE 本就是判官 fail-open 行为）、中间带→转 LLM。`tauLow` 默认 0=关闭，开闸需 `gateway/scripts/calibrate-laya.ts` 对 pairs jsonl（≥50 条 + ≥5 update 对 + create/update 带不重叠）提议 + 用户批准；tauHigh 保持 0.99（separate 失明带永不自动 UPDATE）。审计 `decidedBy:'laya-low'`，stats 增 `layaCreated`。
```

- [ ] **Step 2: roadmap §5 D3 行改勾销**（参考既有 ✅ 格式）

- [ ] **Step 3: 全量门禁**

Run: `cd gateway; npx jest --runInBand 2>&1 | Select-Object -Last 4` → Expected: 1786 + 12 = **1798 全绿**
Run: `npm run build`（root）→ Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/research/2026-10-08-brain-like-roadmap.md
git commit -m "docs: D3 laya three-way gate landed"
```

---

## Self-Review 记录

- **Spec 覆盖**：三值输出（T1）、默认零行为变化（T1 Step 3 `tauLow ?? 0` + T2 默认 0）、校准纪律（T3 pairs≥50/update≥5/带不重叠/0.3 上限）、tauHigh 不动（全局约束 + T1 测试 5）、审计与统计（T1 emitPair/stats）、文档（T4）。✅
- **占位符扫描**：T1 Step 1 的"placeholder"说明是测试草稿迭代演示，最终实现代码在 Step 1 完整给出——可接受。✅
- **类型一致性**：`tauLow`（deps/config/测试一致）、`decidedBy:'laya-low'`（类型扩展 + 测试一致）、`layaCreated`（stats + 测试一致）、`proposeTauLow`/`bucketDistribution`/`LayaPairRecord`/`TauLowProposal`（T3 测试与实现一致）。✅
- **已知留缺**：①consolidate() 的 create 路径仍写新向量（现状行为，不变）；②calibrate 不含 tauHigh 提议（刻意）；③D3 的"novelty 作 importance 先验"（能量调制）留待 τ_low 开闸后的二期。
