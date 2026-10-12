# V2 记忆演化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地 V2 记忆演化七项：MinHash 退役 + 三层去重 + 机械捕获（GLiNER/novelty）+ TCM 分段 shadow + F 层读原文 + graceRevisit + 学习率梯度化。

**Architecture:** 写路径摘除机械合并（MinHash 双消费点），去重迁三层（写时 exact-hash / 读时折叠 / 巩固层语义）；学习率以能量梯度化落地（cap 0.6 → 毕业 0.75）；巩固层重写由 graceRevisit（48h × PE 门控）承担，laya/routeAndWrite 成唯一判官。依据 spec `docs/superpowers/specs/2026-10-12-v2-memory-evolution-design.md`。

**Tech Stack:** TypeScript (gateway, CJS), jest, onnxruntime-node（@huggingface/transformers 传递依赖，已存在）, @huggingface/transformers tokenizer。

## Global Constraints

- 工作目录：仓库根 `C:\work\work-loop\opencode-plugin-mafw`；gateway 代码在 `gateway/`。
- **jest 输出必须重定向到文件再读**（PowerShell 会把 stderr 包成 ErrorRecord）：`cd gateway; npx jest <path> --runInBand > "$env:TEMP\j.txt" 2>&1; Get-Content "$env:TEMP\j.txt" | Select-Object -Last 25`
- 全量门禁：`cd gateway; npx jest --runInBand > "$env:TEMP\j.txt" 2>&1; Select-String -Path "$env:TEMP\j.txt" -Pattern "Test Suites:|Tests:"` 基线 **289 suites / 1933 tests** 全绿（并行会话可能加数——以跑时实际为基线，不允许回落）。
- **中文内容只经 write/edit 工具**（PowerShell 管道会损坏 UTF-8）；`gateway/src/memory/harmonic-file-store.ts` 磁盘上含历史乱码字节注释——编辑时**只碰 ASCII 代码行**，不匹配乱码注释行。
- jest 不 typecheck `gateway/src/index.ts`——改它后必须 `cd gateway; npx tsc --noEmit -p tsconfig.json`（或 root `npm run build`）验证。
- commit 直接到 `main`，格式沿用 `feat(gateway): ...` / `test(gateway): ...`；**绝不 `git add -A`**（并行会话有 WIP），只 add 本任务文件。
- `skipMerge` 参数**保留为 deprecated no-op 一个清理周期**（noReply 先例）——spec 原文说删除，此处偏离已记录：避免动 4 个 evaluation 文件，下周期清理。
- TDD 纪律：每个任务先写失败测试→跑红→最小实现→跑绿→commit。测试文件放 `gateway/tests/unit/<域>/<名>.test.ts`，import 用 `../../../src/` 相对路径（既有惯例）。
- config 新 flag 全部走 `gateway/src/config.ts`（interface + defaults 两处）。
- 时间用 ISO 字符串；"48h" = `48 * 3600 * 1000`。

## File Structure（新建/修改总览）

```
新建:
  gateway/src/memory/dedup-guard.ts          # L1 exact-hash LRU + L2 读时折叠（纯函数 + 计数器）
  gateway/src/memory/entity-harvest.ts       # 统一机械实体收割（regex；GLiNER 异步增广挂点）
  gateway/src/memory/gliner-engine.ts        # GLiNER ONNX 引擎（懒加载 fail-open）
  gateway/src/recall/commitment.ts           # ⑦ cap + 毕业（纯函数 + 计数器）
  gateway/src/recall/grace-revisit.ts        # ④ 宽限期重访管线（deps 注入）
  gateway/src/recall/topic-segmentation.ts   # ② TCM 分段（纯函数）
修改:
  gateway/src/core/memory/harmonic-types.ts  # novelty + commitment_capped_at 字段
  gateway/src/core/memory/harmonic-index.ts  # searchScored 出口接折叠
  gateway/src/memory/harmonic-file-store.ts  # 摘 MinHash merge；addEntry 带新字段
  gateway/src/memory/okf-writer.ts           # novelty 白名单
  gateway/src/recall/reflection.ts           # 摘 classifyInsight；graceRevisit phase；evidence hybrid
  gateway/src/recall/turn-pipeline.ts        # shadow 分段记录 + 事件段输入
  gateway/src/automation-engine.ts           # decay pass 接毕业
  gateway/src/index.ts                       # /api/memory/add 三处接线 + stats
  gateway/src/config.ts                      # flags
```

---

## Batch 1：摘除 + 三层去重 + 学习率（无依赖，先行）

### Task 1: L1 写时 exact-hash 守卫

**Files:**
- Create: `gateway/src/memory/dedup-guard.ts`
- Test: `gateway/tests/unit/memory/dedup-guard.test.ts`
- Modify: `gateway/src/index.ts`（/api/memory/add 处，~6994 行 content 校验后）

**Interfaces:**
- Produces: `exactHashOf(content: string): string`；`seenExactHash(hash: string): boolean`（记录并返回是否已存在）；`getDedupStats(): { exactHashSkips: number; collapsed: number }`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/memory/dedup-guard.test.ts
import { exactHashOf, seenExactHash, getDedupStats, resetDedupStatsForTest } from '../../../src/memory/dedup-guard';

describe('L1 exact-hash guard', () => {
  beforeEach(() => resetDedupStatsForTest());

  it('same content → same hash, different content → different hash', () => {
    expect(exactHashOf('用户偏好 TDD')).toBe(exactHashOf('用户偏好 TDD'));
    expect(exactHashOf('用户偏好 TDD')).not.toBe(exactHashOf('用户偏好 lint'));
  });

  it('first sight returns false, second sight returns true', () => {
    const h = exactHashOf('记忆内容 A');
    expect(seenExactHash(h)).toBe(false);
    expect(seenExactHash(h)).toBe(true);
  });

  it('LRU bounded: evicting old hashes makes them unseen again', () => {
    const first = exactHashOf('old');
    for (let i = 0; i < 10_100; i++) seenExactHash(exactHashOf(`bulk-${i}`));
    expect(seenExactHash(first)).toBe(false); // evicted
  });

  it('counts exactHashSkips', () => {
    const h = exactHashOf('x');
    seenExactHash(h); seenExactHash(h);
    expect(getDedupStats().exactHashSkips).toBe(1);
  });
});
```

- [ ] **Step 2: 跑红**

`cd gateway; npx jest tests/unit/memory/dedup-guard.test.ts --runInBand > "$env:TEMP\j.txt" 2>&1; Get-Content "$env:TEMP\j.txt" | Select-Object -Last 10`
预期：FAIL（Cannot find module '../../../src/memory/dedup-guard'）

- [ ] **Step 3: 最小实现**

```typescript
// gateway/src/memory/dedup-guard.ts
// V2 ①b L1: exact-content guard at the write boundary. An LRU of content
// hashes (in-memory only — a restart window is acceptable, read-time collapse
// backstops) catches worker double-submits with zero LLM cost.
import * as crypto from 'crypto';

const LRU_CAPACITY = 10_000;
const seen = new Map<string, true>(); // Map preserves insertion order → LRU via re-set

export const dedupStats = { exactHashSkips: 0, collapsed: 0 };

export function resetDedupStatsForTest(): void {
  dedupStats.exactHashSkips = 0;
  dedupStats.collapsed = 0;
  seen.clear();
}

export function exactHashOf(content: string): string {
  return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
}

/** Record + test in one call: true when the exact content was already written. */
export function seenExactHash(hash: string): boolean {
  const hit = seen.has(hash);
  if (hit) { dedupStats.exactHashSkips++; return true; }
  seen.set(hash, true);
  if (seen.size > LRU_CAPACITY) {
    const oldest = seen.keys().next().value as string;
    seen.delete(oldest);
  }
  return false;
}

export function getDedupStats(): { exactHashSkips: number; collapsed: number } {
  return { exactHashSkips: dedupStats.exactHashSkips, collapsed: dedupStats.collapsed };
}
```

- [ ] **Step 4: 跑绿**（同 Step 2 命令，预期 4 passed）

- [ ] **Step 5: 接线 /api/memory/add**

在 `gateway/src/index.ts` /api/memory/add 处，`if (!content || ...)` 校验块之后、`normalizeAuthority` 之前插入（读文件定位准确锚点，用 ASCII 上下文匹配）：

```typescript
        // V2 ①b L1: exact-content guard — skip verbatim re-submits (worker
        // double-writes). LRU is in-memory; read-time collapse backstops.
        if (config.memory.dedup?.exactHash !== false) {
          const { exactHashOf, seenExactHash } = require('./memory/dedup-guard.js');
          if (seenExactHash(exactHashOf(content))) {
            return { success: true, deduped: true, reason: 'exact-hash' };
          }
        }
```

同时在 `config.ts` 的 `memory` interface 加：

```typescript
    /** V2 three-tier dedup. exactHash: skip verbatim re-submits at write (L1). */
    dedup?: { exactHash?: boolean; readCollapse?: boolean };
```

defaults 处（`harvestIdentifierCues: true,` 附近）加 `dedup: { exactHash: true, readCollapse: true },`。

- [ ] **Step 6: tsc 验证 + commit**

`cd gateway; npx tsc --noEmit -p tsconfig.json > "$env:TEMP\t.txt" 2>&1; Get-Content "$env:TEMP\t.txt" | Select-Object -Last 5`（预期无 error）
`git add gateway/src/memory/dedup-guard.ts gateway/tests/unit/memory/dedup-guard.test.ts gateway/src/index.ts gateway/src/config.ts; git commit -m "feat(gateway): L1 exact-hash dedup guard at write boundary"`

---

### Task 2: L2 读时近重复折叠

**Files:**
- Modify: `gateway/src/memory/dedup-guard.ts`
- Modify: `gateway/src/core/memory/harmonic-index.ts`（searchScored 出口，`resolveSupersededHeads` 调用后 ~501 行）
- Test: `gateway/tests/unit/memory/dedup-guard.test.ts`（追加）

**Interfaces:**
- Consumes: `ScoredEntry`（harmonic-index.ts 导出）
- Produces: `collapseNearDuplicates(scored: ScoredEntry[], opts?: CollapseOpts): ScoredEntry[]`；`CollapseOpts = { maxCandidates?: number; tokenJaccardThreshold?: number; vectorCosineThreshold?: number; vectorFor?: (id: string) => number[] | null }`

- [ ] **Step 1: 追加失败测试**

```typescript
// dedup-guard.test.ts 追加
import { collapseNearDuplicates } from '../../../src/memory/dedup-guard';
import { ScoredEntry } from '../../../src/core/memory/harmonic-index';

function mkEntry(id: string, abs: string, energy = 0.8, cues: string[] = []): ScoredEntry['entry'] {
  return { id, type: 'semantic', primary_abstraction: abs, cue_anchors: cues, tier: 'semantic', energy } as any;
}

describe('L2 read-time near-duplicate collapse', () => {
  it('collapses high token-Jaccard pairs, keeping higher energy', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('a', 'BM25 token cache memoize harmonic index for speed', 0.6, ['bm25', 'cache']), score: 1 },
      { entry: mkEntry('b', 'BM25 token cache memoize harmonic index speed', 0.9, ['bm25', 'cache']), score: 0.95 },
      { entry: mkEntry('c', 'Completely different topic about desktop UI', 0.8, ['desktop']), score: 0.9 },
    ];
    const out = collapseNearDuplicates(scored, { vectorFor: () => null });
    expect(out.map(s => s.entry.id)).toEqual(['b', 'c']); // 'a' folded into 'b'
  });

  it('collapses by vector cosine when available (abstractions differ lexically)', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('x', 'totally different words alpha', 0.5), score: 1 },
      { entry: mkEntry('y', 'other words beta', 0.9), score: 0.9 },
    ];
    const vecs: Record<string, number[]> = { x: [1, 0], y: [1, 0.01] }; // cos ≈ 0.99995
    const out = collapseNearDuplicates(scored, { vectorFor: (id) => vecs[id] ?? null });
    expect(out.map(s => s.entry.id)).toEqual(['y']);
  });

  it('keeps lexically-shallow pairs that share only one anchor word', () => {
    const scored: ScoredEntry[] = [
      { entry: mkEntry('p', 'deploy gateway with docker compose stack', 0.8, ['deploy']), score: 1 },
      { entry: mkEntry('q', 'deploy failed because of port conflict windows', 0.8, ['deploy']), score: 0.9 },
    ];
    const out = collapseNearDuplicates(scored, { vectorFor: () => null });
    expect(out.map(s => s.entry.id)).toEqual(['p', 'q']); // below threshold → both kept
  });

  it('counts collapsed', () => {
    dedupStats.collapsed = 0;
    const scored: ScoredEntry[] = [
      { entry: mkEntry('m', 'same same words here', 0.5), score: 1 },
      { entry: mkEntry('n', 'same same words here', 0.9), score: 0.9 },
    ];
    collapseNearDuplicates(scored, { vectorFor: () => null });
    expect(getDedupStats().collapsed).toBe(1);
  });
});
```

- [ ] **Step 2: 跑红**（预期 collapseNearDuplicates 未导出）

- [ ] **Step 3: 实现**（dedup-guard.ts 追加；分词复用 harmonic-index 的 tokenize 约定——小写 ≥2 字符词 + CJK unigram）

```typescript
import { ScoredEntry } from '../core/memory/harmonic-index';

export interface CollapseOpts {
  /** Collapse window size on the ranked list (default 30). */
  maxCandidates?: number;
  tokenJaccardThreshold?: number; // default 0.8
  vectorCosineThreshold?: number; // default 0.92
  /** Embedding lookup — production resolves via getEmbeddingRuntime().vectors. */
  vectorFor?: (id: string) => number[] | null;
}

function tokensOf(entry: ScoredEntry['entry']): Set<string> {
  const raw = `${entry.primary_abstraction} ${(entry.cue_anchors ?? []).join(' ')}`.toLowerCase();
  const ascii = raw.match(/[a-z0-9_]{2,}/g) ?? [];
  const cjk = raw.match(/[\u4e00-\u9fff]/g) ?? [];
  return new Set([...ascii, ...cjk]);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Presentation-layer dedup among the top candidates: near-duplicates (cos
 * ≥ 0.92 when vectors resolve for BOTH ids, else token-Jaccard ≥ 0.8 on
 * abstraction+anchors) fold into the entry ranked higher (kept first).
 * No data mutation; O(k²) on the first k ≤ 30 kept entries only. */
export function collapseNearDuplicates(scored: ScoredEntry[], opts?: CollapseOpts): ScoredEntry[] {
  const k = Math.min(scored.length, opts?.maxCandidates ?? 30);
  const jt = opts?.tokenJaccardThreshold ?? 0.8;
  const ct = opts?.vectorCosineThreshold ?? 0.92;
  const vecFor = opts?.vectorFor ?? (() => null);
  const out: ScoredEntry[] = [];
  const outTokens: Set<string>[] = [];
  for (const s of scored) {
    let folded = false;
    if (out.length < k) {
      for (let i = 0; i < out.length; i++) {
        const va = vecFor(s.entry.id);
        const vb = vecFor(out[i].entry.id);
        const similar = (va && vb && va.length === vb.length)
          ? cosine(va, vb) >= ct
          : jaccard(tokensOf(s.entry), outTokens[i]) >= jt;
        if (similar) { dedupStats.collapsed++; folded = true; break; }
      }
    }
    if (!folded) { out.push(s); outTokens.push(tokensOf(s.entry)); }
  }
  return out;
}
```

- [ ] **Step 4: 跑绿**

- [ ] **Step 5: 接线 searchScored**

`gateway/src/core/memory/harmonic-index.ts` 的 searchScored 中，`resolveSupersededHeads` 块（~499-501 行）之后插入：

```typescript
    // ── V2 L2: read-time near-duplicate collapse (presentation only) ──
    if (config.memory.dedup?.readCollapse !== false && scored.length > 1) {
      const { collapseNearDuplicates } = require('../../memory/dedup-guard');
      let vectorFor: ((id: string) => number[] | null) | undefined;
      try {
        const { getEmbeddingRuntime } = require('../../memory/embedding-runtime');
        const rt = getEmbeddingRuntime();
        if (rt) vectorFor = (id) => rt.vectors.getVector(id) ?? null;
      } catch { /* fail-open: token Jaccard */ }
      scored = collapseNearDuplicates(scored, { vectorFor });
    }
```

先确认 `MemoryVectorStore` 有 `getVector(id)` 方法（读 `gateway/src/memory/vector-store.ts`；若无则用其现有按 id 取向量的方法名替换，或补一个 `getVector(id): number[] | null`——TDD 一并覆盖）。

- [ ] **Step 6: 全量回归 + 100ms 契约心算确认（top-30 O(k²) ≈ 435 对 × 微秒级 = 亚毫秒）+ commit**

`git add gateway/src/memory/dedup-guard.ts gateway/src/core/memory/harmonic-index.ts gateway/tests/unit/memory/dedup-guard.test.ts gateway/src/memory/vector-store.ts; git commit -m "feat(gateway): L2 read-time near-duplicate collapse at searchScored exit"`

---

### Task 3: MinHash 写路径退役

**Files:**
- Modify: `gateway/src/memory/harmonic-file-store.ts`（write() ~89-98 行 merge 块）
- Test: `gateway/tests/unit/memory/minhash-retired.test.ts`

**Interfaces:**
- Produces: `write(unit, tier?, opts?: { skipMerge?: boolean })`——`skipMerge` 保留但 @deprecated no-op

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/memory/minhash-retired.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';

function mkUnit(id: string, abs: string) {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic' as const, primary_abstraction: abs, cue_anchors: ['t'],
    memory_value: abs, energy: 0.8, created_at: now, updated_at: now,
  };
}

describe('V2 MinHash retirement', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwh-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('near-verbatim second write is NOT merged: both entries persist', async () => {
    const idx = new HarmonicIndexManager(dir);
    const store = new HarmonicUnitFileStore(dir, idx);
    await store.write(mkUnit('u1', 'BM25 token cache memoize harmonic index speed') as any);
    await store.write(mkUnit('u2', 'BM25 token cache memoize harmonic index speed') as any);
    const entries = idx.getIndex().entries;
    expect(entries.map(e => e.id).sort()).toEqual(['u1', 'u2']);
    expect((entries.find(e => e.id === 'u1') as any).superseded_by).toBeUndefined();
  });

  it('skipMerge option is an accepted no-op', async () => {
    const idx = new HarmonicIndexManager(dir);
    const store = new HarmonicUnitFileStore(dir, idx);
    await store.write(mkUnit('u3', 'anything'), undefined, { skipMerge: true });
    expect(idx.getIndex().entries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 跑红**（第一条会 FAIL——现状 u1 被 merge 掉/supersede）

- [ ] **Step 3: 实现——摘除 merge 块**

`harmonic-file-store.ts` write() 内（只碰 ASCII 行）：

删除：
```typescript
      let targetUnit = unit;
      if (!opts?.skipMerge) {
        const merged = await this.minHashMerger.merge(unit, this.indexManager, {
          read: (id) => this.read(id),
          deleteSync: (id) => this.deleteSync(id),
          markSuperseded: (id, byId) => this.markSuperseded(id, byId),
        });
        targetUnit = merged.merged_from?.length ? merged : unit;
      }
      writtenUnit = targetUnit;
```
替换为：
```typescript
      // V2 ①a (2026-10-12): write-path MinHash merge RETIRED. The brain's
      // write-time operation is pattern SEPARATION; dedup moved to three
      // tiers (exact-hash at write / read-time collapse / consolidation).
      // `opts.skipMerge` is a deprecated no-op kept one cleanup cycle
      // (noReply precedent) so evaluation callers keep compiling.
      void opts;
      writtenUnit = unit;
```
同时删除字段 `private minHashMerger: MinHashMerger;`、构造行 `this.minHashMerger = new MinHashMerger();`、顶部 import（`import { MinHashMerger } ...`）。注意 88 行前的乱码注释块**不动**（历史损坏字节，勿匹配）。

- [ ] **Step 4: 跑绿 + 全量**——`write-cue-harvest.test.ts:31` 传 skipMerge 应仍绿（no-op）；minhash-merger 自身的单测（纯函数）不动——模块保留（worktree 融合还在用）。

- [ ] **Step 5: commit**

`git add gateway/src/memory/harmonic-file-store.ts gateway/tests/unit/memory/minhash-retired.test.ts; git commit -m "feat(gateway): retire write-path MinHash merge (V2 ①a)"`

---

### Task 4: reflection classifyInsight 摘除

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（~263-314 classifyInsight + reflectSession 调用点 ~397-411）
- Test: `gateway/tests/unit/recall/reflection-classify-retired.test.ts`

**Interfaces:**
- Produces: insight 流直接进 `routeAndWrite`；`ReflectionResult.deduped` = routeAndWrite skip 计数；`superseded` = 0（保留字段，graceRevisit 接管后重赋义）

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/recall/reflection-classify-retired.test.ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReflectionPipeline, ReflectionOptions } from '../../../src/recall/reflection';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { ReflectCursor } from '../../../src/recall/reflect-cursor';

class FakeWorker {
  calls = 0;
  async prompt(): Promise<string> {
    this.calls++;
    if (this.calls === 1) return '{"questions":["how does bm25 cache work"]}';
    return JSON.stringify({ insights: [{ category: 'insight', content: 'BM25 tf 词频缓存上线 boundaryDense 否决', cue_anchors: ['bm25', 'cache'] }] });
  }
}

describe('V2 classifyInsight retirement', () => {
  it('insight routes through routeAndWrite only; near-identical existing entry does NOT pre-skip via MinHash', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwr-'));
    try {
      const idx = new HarmonicIndexManager(dir);
      const store = new (require('../../../src/memory/harmonic-file-store').HarmonicUnitFileStore)(dir, idx);
      const now = new Date().toISOString();
      // Pre-existing near-verbatim entry (MinHash would have classified the
      // new insight as duplicate — V2 requires it to reach the judge).
      await store.write({ id: 'existing1', type: 'semantic', primary_abstraction: 'BM25 tf 词频缓存上线 boundaryDense 否决',
        cue_anchors: ['bm25', 'cache'], memory_value: 'BM25 tf 词频缓存上线 boundaryDense 否决',
        energy: 0.8, created_at: now, updated_at: now } as any);
      // 预置 episodic 待反思
      await store.write({ id: 'ep1', type: 'episodic', primary_abstraction: 'round about bm25 cache',
        cue_anchors: ['bm25'], memory_value: 'we shipped the bm25 token cache', energy: 0.5,
        created_at: now, updated_at: now, source_session_id: 'ses_test' } as any);

      const workers = new Map<string, FakeWorker>();
      const opts: ReflectionOptions = {
        index: idx, baseDir: dir,
        workerFor: (sid) => workers.get(sid) ?? (workers.set(sid, new FakeWorker()), workers.get(sid)!),
        cursor: new ReflectCursor(dir),
      };
      const pipe = new ReflectionPipeline(opts);
      const res = await pipe.runSession('ses_test');
      // 关键断言：不经 MinHash 预跳过 —— insight 写入成功（routeAndWrite deps 未接线 → create）
      expect(res.distilled).toBe(1);
      expect(res.deduped).toBe(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
```

- [ ] **Step 2: 跑红**（现状：classifyInsight 判 duplicate → distilled 0 / deduped 1）

- [ ] **Step 3: 实现**

`reflection.ts`：
1. 删除 `private merger = new MinHashMerger();` 字段 + MinHashMerger import。
2. 整段删除 `classifyInsight()` 方法（~281-314 行）。
3. `reflectSession` 内 insight 循环改为：

```typescript
    for (const insight of insights.slice(0, maxInsights)) {
      const now = new Date().toISOString();
      const unit = buildInsightUnit(insight, sessionID, now);
      // V2 ①a: MinHash classifyInsight retired — routeAndWrite (laya + G2)
      // is the single judge. Conflict supersede duty moved to graceRevisit.
      try {
        const routeDeps = getRouteWriteDeps();
        if (routeDeps) {
          const routed = await routeAndWrite(unit, this.store as any, routeDeps);
          if (routed.action === 'skip') result.deduped++;
          else { result.distilled++; distilledGistIds.push(routed.id); }
        } else {
          await this.store.write(unit);
          result.distilled++;
          distilledGistIds.push(unit.id);
        }
      } catch {
        result.failed++;
      }
    }
```

- [ ] **Step 4: 跑绿 + 全量回归**（现有 reflection 测试若断言 deduped/superseded 语义，按新语义修正断言——机械迁移不是行为回归）

- [ ] **Step 5: commit**

`git add gateway/src/recall/reflection.ts gateway/tests/unit/recall/reflection-classify-retired.test.ts; git commit -m "feat(gateway): retire classifyInsight MinHash gate — routeAndWrite single judge"`

---

### Task 5: ⑦ 学习率 cap（写侧）

**Files:**
- Create: `gateway/src/recall/commitment.ts`
- Modify: `gateway/src/core/memory/harmonic-types.ts`（HaricUnit + HarmonicIndexEntry 加字段）
- Modify: `gateway/src/memory/harmonic-file-store.ts`（addEntry 透传）
- Modify: `gateway/src/index.ts`（/api/memory/add：cap + worker-origin 判定）
- Modify: `gateway/src/recall/reflection.ts`（insight 写入同样 cap）
- Test: `gateway/tests/unit/recall/commitment.test.ts`

**Interfaces:**
- Produces: `capCommitment(unit: HarmonicUnit, opts: { isPipeline: boolean; enabled?: boolean; cap?: number }): HarmonicUnit`——命中条件时返回带 `commitment_capped_at` 且 energy ≤ cap 的新对象（浅拷贝）；`COMMITMENT_CAP = 0.6`；commitmentStats 计数器 `{ capped: number; graduated: number }`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/recall/commitment.test.ts
import { capCommitment, COMMITMENT_CAP } from '../../../src/recall/commitment';

const now = '2026-10-12T00:00:00.000Z';
function mkUnit(energy: number) {
  return { id: 'u', type: 'semantic' as const, primary_abstraction: 'a', cue_anchors: ['k'],
    memory_value: 'v', energy, created_at: now, updated_at: now };
}

describe('⑦ commitment gradient — write-side cap', () => {
  it('pipeline semantic/procedural first-pass capped to 0.6 + stamped', () => {
    const out = capCommitment(mkUnit(0.9), { isPipeline: true });
    expect(out.energy).toBe(COMMITMENT_CAP);
    expect((out as any).commitment_capped_at).toBe(now);
  });

  it('low computed energy is NOT raised (cap is min, not set)', () => {
    const out = capCommitment(mkUnit(0.3), { isPipeline: true });
    expect(out.energy).toBe(0.3);
    expect((out as any).commitment_capped_at).toBe(now);
  });

  it('episodic / user writes / disabled → untouched', () => {
    const ep = { ...mkUnit(0.9), type: 'episodic' as const };
    expect(capCommitment(ep, { isPipeline: true }).energy).toBe(0.9);
    expect(capCommitment(mkUnit(0.9), { isPipeline: false }).energy).toBe(0.9);
    expect(capCommitment(mkUnit(0.9), { isPipeline: true, enabled: false }).energy).toBe(0.9);
  });
});
```

- [ ] **Step 2: 跑红**

- [ ] **Step 3: 实现**

```typescript
// gateway/src/recall/commitment.ts
// V2 ⑦: CLS small-step contract — first-pass pipeline writes to the slow
// system's store commit at a capped energy. Retrieval of FRESH content is
// served by the t1 verbatim layer (FTT dual-trace); gists mature here.
// Graduation (decay pass) lifts survivors to 0.75 after the 48h window.
import { HarmonicUnit } from '../core/memory/harmonic-types';

export const COMMITMENT_CAP = 0.6;
export const COMMITMENT_GRADUATE_TO = 0.75;
export const COMMITMENT_WINDOW_MS = 48 * 3600 * 1000;

export const commitmentStats = { capped: 0, graduated: 0 };

export interface CapOpts {
  isPipeline: boolean;
  /** Master flag (config.recall.commitmentGradient, default true). */
  enabled?: boolean;
  cap?: number;
  now?: string;
}

export function capCommitment(unit: HarmonicUnit, opts: CapOpts): HarmonicUnit {
  if (opts.enabled === false) return unit;
  if (!opts.isPipeline) return unit;
  if (unit.type !== 'semantic' && unit.type !== 'procedural') return unit;
  const cap = opts.cap ?? COMMITMENT_CAP;
  if (unit.energy <= cap) {
    commitmentStats.capped++;
    return { ...unit, commitment_capped_at: opts.now ?? new Date().toISOString() } as HarmonicUnit;
  }
  commitmentStats.capped++;
  return { ...unit, energy: cap, commitment_capped_at: opts.now ?? new Date().toISOString() } as HarmonicUnit;
}
```

`harmonic-types.ts`：`HarmonicUnit` 与 `HarmonicIndexEntry` 各加：

```typescript
  /** V2 ⑦: set at write when the commitment gradient capped this entry
   * (pipeline-origin semantic/procedural). Cleared by graduation (decay
   * pass) after the 48h grace window. Index-level bookkeeping — never
   * persisted to OKF frontmatter (mirrors last_decay_at). */
  commitment_capped_at?: string;
```

`harmonic-file-store.ts` addEntry 对象字面量里（`distilled_by: targetUnit.distilled_by,` 之后）加 `commitment_capped_at: (targetUnit as any).commitment_capped_at,`。

`index.ts` /api/memory/add：unit 构造后、`capTentativeEnergy` 之前插入（A2 优先——tentative 判定先走）：

```typescript
        // V2 ⑦: commitment gradient — pipeline worker first-pass writes cap
        // at 0.6; manual/user writes are exempt. Worker detection via the
        // V1 origin registry (registered = pipeline worker session).
        try {
          const { capCommitment } = require('./recall/commitment');
          const isPipelineWorker = Boolean(
            data?.sessionID && require('./recall/worker-origin').resolveWorkerOrigin(String(data.sessionID)));
          Object.assign(unit, capCommitment(unit as any, {
            isPipeline: isPipelineWorker,
            enabled: config.recall?.commitmentGradient !== false,
          }));
        } catch { /* fail-open */ }
```

`config.ts`：`recall` 段 interface 加 `commitmentGradient?: boolean;`（defaults `commitmentGradient: true`；recall 段若不存在则按 search 段模式建）。

`reflection.ts` reflectSession 的 routeAndWrite/store.write 前：

```typescript
      // V2 ⑦: reflection insights are pipeline writes — same gradient cap.
      const { capCommitment } = require('./commitment');
      const cappedUnit = capCommitment(unit, { isPipeline: true });
```
（后续 `routeAndWrite(cappedUnit, ...)` / `store.write(cappedUnit)`）

- [ ] **Step 4: 跑绿 + tsc + commit**

`git add gateway/src/recall/commitment.ts gateway/tests/unit/recall/commitment.test.ts gateway/src/core/memory/harmonic-types.ts gateway/src/memory/harmonic-file-store.ts gateway/src/index.ts gateway/src/recall/reflection.ts gateway/src/config.ts; git commit -m "feat(gateway): commitment gradient cap 0.6 for pipeline first-pass writes"`

---

### Task 6: ⑦ 毕业（decay pass 接线）

**Files:**
- Modify: `gateway/src/recall/commitment.ts`
- Modify: `gateway/src/automation-engine.ts`（runMemoryDecay 尾部 ~124 行 `indexManager.save()` 前）
- Modify: `gateway/src/core/memory/harmonic-index.ts`（若需 `clearCommitment(id)` 方法——优先直接操作 entries + save，参考 stampDecay 模式）
- Test: `gateway/tests/unit/recall/commitment.test.ts`（追加）

**Interfaces:**
- Produces: `selectGraduations(entries: HarmonicIndexEntry[], now: number): string[]`；`applyGraduations(indexManager, entries, now): number`（或内联于 decay pass——以纯函数 `selectGraduations` 为测试面）

- [ ] **Step 1: 追加失败测试**

```typescript
import { selectGraduations } from '../../../src/recall/commitment';

describe('⑦ graduation (decay pass)', () => {
  const T0 = Date.parse('2026-10-12T00:00:00.000Z');
  function mkEntry(id: string, cappedAtAgoH: number | null, energy = 0.6) {
    return { id, type: 'semantic', energy, cue_anchors: [],
      commitment_capped_at: cappedAtAgoH === null ? undefined : new Date(T0 - cappedAtAgoH * 3600 * 1000).toISOString(),
      created_at: new Date(T0 - (cappedAtAgoH ?? 0) * 3600 * 1000).toISOString() } as any;
  }

  it('capped > 48h ago → graduates', () => {
    expect(selectGraduations([mkEntry('a', 49)], T0)).toEqual(['a']);
  });
  it('capped < 48h → stays', () => {
    expect(selectGraduations([mkEntry('b', 47)], T0)).toEqual([]);
  });
  it('no cap stamp / superseded / rejected anchor / episodic → never', () => {
    expect(selectGraduations([mkEntry('c', 100)], T0, 0.8)).toEqual([]); // 高能量=已毕业过? 不——见下条修正
    const sup = { ...mkEntry('d', 100), superseded_by: 'x' };
    expect(selectGraduations([sup], T0)).toEqual([]);
    const rej = { ...mkEntry('e', 100), cue_anchors: ['rejected'] };
    expect(selectGraduations([rej], T0)).toEqual([]);
    const ep = { ...mkEntry('f', 100), type: 'episodic' };
    expect(selectGraduations([ep], T0)).toEqual([]);
  });
});
```

（注意 `mkEntry('c')` 用例意图：energy 已 > cap 说明非 capped 态——`selectGraduations` 应同时要求 `energy <= 0.62`，防误毕业自然低能条目。）

- [ ] **Step 2: 跑红**

- [ ] **Step 3: 实现**（commitment.ts 追加）

```typescript
import { HarmonicIndexEntry } from '../core/memory/harmonic-types';

/** Entries whose 48h window elapsed with no grace verdict: lift to
 * COMMITMENT_GRADUATE_TO. Guards: cap stamp present, energy still ≤ cap
 * (not already raised/superseded/demoted), not superseded, no rejected
 * anchor, slow-system types only. */
export function selectGraduations(entries: HarmonicIndexEntry[], now: number): string[] {
  const out: string[] = [];
  for (const e of entries) {
    if ((e as any).commitment_capped_at === undefined) continue;
    if (e.superseded_by) continue;
    if ((e.cue_anchors ?? []).includes('rejected')) continue;
    if (e.type !== 'semantic' && e.type !== 'procedural') continue;
    if (e.energy > COMMITMENT_CAP + 0.02) continue; // already graduated/promoted
    const cappedAt = Date.parse((e as any).commitment_capped_at);
    if (!Number.isFinite(cappedAt) || now - cappedAt < COMMITMENT_WINDOW_MS) continue;
    out.push(e.id);
  }
  return out;
}
```

`automation-engine.ts`：runMemoryDecay 的 decay 循环后、`indexManager.save()` 前插入：

```typescript
  // V2 ⑦ graduation: capped pipeline writes whose 48h window elapsed with
  // no interference graduate to 0.75 (mechanical — no LLM, independent of
  // the graceRevisit verdict phase). "Survived without PE = stabilized".
  try {
    const { selectGraduations, COMMITMENT_GRADUATE_TO } = require('./recall/commitment');
    const grads = selectGraduations(index.entries, now);
    for (const id of grads) {
      indexManager.updateEnergy(id, COMMITMENT_GRADUATE_TO - (indexManager.getIndex().entries.find(e => e.id === id)?.energy ?? 0));
      const ent = indexManager.getIndex().entries.find(e => e.id === id) as any;
      if (ent) delete ent.commitment_capped_at;
      // graduated counter via commitmentStats
    }
    if (grads.length > 0) { indexManager.save(); }
  } catch { /* fail-open */ }
```

（`require('./recall/commitment')` 从 automation-engine.ts 的相对路径是 `./recall/commitment`——实现时核对 automation-engine.ts 位于 `src/` 根，故正确。计数：commitmentStats.graduated += grads.length。）

- [ ] **Step 4: 跑绿 + 全量 + commit**

`git add gateway/src/recall/commitment.ts gateway/src/automation-engine.ts gateway/tests/unit/recall/commitment.test.ts; git commit -m "feat(gateway): commitment graduation in decay pass (48h no-PE → 0.75)"`

---

### Task 7: novelty 持久化 + stats 汇总

**Files:**
- Modify: `gateway/src/core/memory/harmonic-types.ts`（`novelty?: number`，Unit + Entry）
- Modify: `gateway/src/memory/okf-writer.ts`（白名单一行）
- Modify: `gateway/src/index.ts`（/api/memory/add：unit 带 novelty；stats 路由加块）
- Test: `gateway/tests/unit/memory/novelty-persist.test.ts`

**Interfaces:**
- Produces: `HarmonicUnit.novelty?: number`；stats 响应新增 `dedup: {...}`、`commitment: {...}` 块

- [ ] **Step 1: 失败测试**（store 层：写带 novelty 的 unit → index entry + OKF frontmatter 均含）

```typescript
// gateway/tests/unit/memory/novelty-persist.test.ts
import * as fs from 'fs'; import * as os from 'os'; import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';

describe('novelty persistence', () => {
  it('round-trips through index entry and OKF frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwn-'));
    try {
      const idx = new HarmonicIndexManager(dir);
      const store = new HarmonicUnitFileStore(dir, idx);
      const now = new Date().toISOString();
      await store.write({ id: 'nv1', type: 'semantic', primary_abstraction: 'abs',
        cue_anchors: ['k'], memory_value: 'v', energy: 0.8, novelty: 0.42,
        created_at: now, updated_at: now } as any);
      expect((idx.getIndex().entries[0] as any).novelty).toBe(0.42);
      const okf = fs.readFileSync(path.join(dir, 'memory', 'concepts', 'semantic', 'nv1.md'), 'utf-8');
      expect(okf).toContain('novelty: 0.42');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
```

（OKF 路径如与实际不符——先读 `okf-writer.ts` 的 `getOKFDirectory` 确认目录布局——按实际调整测试路径。）

- [ ] **Step 2: 跑红**

- [ ] **Step 3: 实现**
1. `harmonic-types.ts`：Unit 加 `/** V2 ①c: 1 − maxCos to nearest existing vector at write; null when embedding off. */ novelty?: number;`；Entry 同字段。
2. `okf-writer.ts`：`if (unit.novelty !== undefined) frontmatter.novelty = unit.novelty;`（salience 行旁）
3. `harmonic-file-store.ts` addEntry 字面量加 `novelty: (targetUnit as any).novelty,`
4. `index.ts` /api/memory/add：unit 字面量加 `novelty,`（novelty 变量已存在于 7008 行）
5. `index.ts` stats 路由（~4160 响应对象）加：

```typescript
              dedup: (() => { try { return getDedupStats(); } catch { return null; } })(),
              commitment: (() => {
                try {
                  const { commitmentStats } = require('./recall/commitment');
                  const capped = indexEntries.filter((e: any) => e.commitment_capped_at).length;
                  return { ...commitmentStats, inWindow: capped };
                } catch { return null; }
              })(),
```

顶部若无 `getDedupStats` import 则 require 引入（跟随该文件既有的 lazy-require 风格）。

- [ ] **Step 4: 跑绿 + tsc + commit**

`git add gateway/src/core/memory/harmonic-types.ts gateway/src/memory/okf-writer.ts gateway/src/memory/harmonic-file-store.ts gateway/src/index.ts gateway/tests/unit/memory/novelty-persist.test.ts; git commit -m "feat(gateway): persist novelty scalar + dedup/commitment stats"`

---

## Batch 2：机械捕获（依赖嵌入 runtime）

### Task 8: 统一 regex 实体收割

**Files:**
- Create: `gateway/src/memory/entity-harvest.ts`
- Modify: `gateway/src/recall/reflection.ts`（内联提取段 ~357-373 迁走）
- Test: `gateway/tests/unit/memory/entity-harvest.test.ts`

**Interfaces:**
- Produces: `extractEntities(text: string, opts?: { max?: number }): string[]`——camelCase/PascalCase/ALL_CAPS(≥3)/引号串，去重保序；reflection 的 entityBlock 与写路径共用

- [ ] **Step 1: 失败测试**

```typescript
// gateway/tests/unit/memory/entity-harvest.test.ts
import { extractEntities } from '../../../src/memory/entity-harvest';

describe('mechanical entity harvest', () => {
  it('finds camelCase, PascalCase, ALL_CAPS, quoted strings', () => {
    const out = extractEntities('HarmonicIndexManager uses BM25 with "worker origin" via resolveWorkerOrigin');
    expect(out).toContain('HarmonicIndexManager');
    expect(out).toContain('BM25');
    expect(out).toContain('worker origin');
    expect(out).toContain('resolveWorkerOrigin');
  });
  it('dedupes, preserves order, caps at max', () => {
    const out = extractEntities('FooBar FooBar AlphaBeta GammaDelta EpsilonZeta', { max: 3 });
    expect(out).toEqual(['FooBar', 'AlphaBeta', 'GammaDelta']);
  });
  it('CJK text returns CJK runs of length >= 2', () => {
    expect(extractEntities('海马体与模式分离')).toContain('海马体');
  });
});
```

（CJK 用例：实现按 `[\u4e00-\u9fff]{2,}` 连续段提取；测试与实现一致即可，具体切分粒度以实现为准调整测试。）

- [ ] **Step 2: 跑红 → Step 3: 实现**

```typescript
// gateway/src/memory/entity-harvest.ts
// V2 ①c: unified MECHANICAL entity harvest (zero LLM). Merges the regex
// extraction formerly inlined in reflection.ts with the write-path needs.
// GLiNER augmentation (gliner-engine) is layered on asynchronously at the
// write path — this module stays dependency-free.

const CAMEL = /\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g;
const ALL_CAPS = /\b[A-Z]{2,}\b/g;          // + length >= 3 filter below
const QUOTED = /['"]([^'"]+)['"]/g;
const CJK_RUN = /[\u4e00-\u9fff]{2,}/g;

export function extractEntities(text: string, opts?: { max?: number }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (s: string) => {
    const t = s.trim();
    if (!t || seen.has(t)) return;
    seen.add(t); out.push(t);
  };
  for (const m of text.match(CAMEL) ?? []) push(m);
  for (const m of text.match(ALL_CAPS) ?? []) if (m.length >= 3) push(m);
  for (const m of text.match(QUOTED) ?? []) push(m.slice(1, -1).trim());
  for (const m of text.match(CJK_RUN) ?? []) push(m);
  return opts?.max ? out.slice(0, opts.max) : out;
}
```

- [ ] **Step 4: 跑绿；Step 5: reflection.ts 内联段替换**

`reflection.ts` ~357-373 的 episodeEntities 提取改为：

```typescript
      // V2 ①c: shared mechanical harvester (was inlined regex).
      const { extractEntities } = require('../memory/entity-harvest');
      const episodeEntities = new Set<string>();
      for (const ep of episodes) {
        for (const e of extractEntities(ep.text, { max: 40 })) episodeEntities.add(e);
      }
```

entityBlock 构造不变（`[...episodeEntities].slice(0, 20)`）。

- [ ] **Step 6: 全量 + commit**

`git add gateway/src/memory/entity-harvest.ts gateway/tests/unit/memory/entity-harvest.test.ts gateway/src/recall/reflection.ts; git commit -m "refactor(gateway): unified mechanical entity harvester"`

---

### Task 9: GLiNER 引擎（ONNX，fail-open）

**Files:**
- Create: `gateway/src/memory/gliner-engine.ts`
- Test: `gateway/tests/unit/memory/gliner-engine.test.ts`（fake session，无模型依赖）

**Interfaces:**
- Produces: `getGliner(): Promise<GlinerEngine | null>`（懒加载单例，失败缓存可重试——kokoro 模式）；`GlinerEngine.extract(text: string, labels: string[]): Promise<Array<{ label: string; text: string; score: number }>>`；config：`recall.glinerModel?: string`（默认见 Step 1 验证结论）、`recall.entityHarvest?: boolean`

**实现要点（防发明——先验证再写死）**：
- 模型经 HF `resolve`（hf-mirror.com 回退，仓库已有 ghfast 模式先例）下载 ONNX 到 `~/.mafw/models/gliner/`；tokenizer 走 `@huggingface/transformers` 的 `AutoTokenizer`（独立可用）。
- **Step 1 是模型签名验证脚本**（一次性，产物记录进本文件注释）：下载候选模型（默认 `knowledgator/gliner-multitask-large-v0.5` 的 `onnx/model.onnx`；备选 `urchade/gliner_multi_pie-v1`），`require('onnxruntime-node').InferenceSession.create` 后打印 `inputNames/outputNames/dims`——GLiNER 标准 ONNX 接口为 `input_ids/attention_mask/token_type_ids` → span logits `[1, num_labels, seq, seq]`（parallel-encoding：label 段在前、text 段在后）。若签名不同，adapter 以实际为准，decode 语义不变。

- [ ] **Step 1: 签名验证脚本（不进 git，输出贴回本任务注释）**

```javascript
// scripts-tmp/inspect-gliner.js（临时文件，验证后删除）
const ort = require('onnxruntime-node');
const fs = require('fs');
(async () => {
  const buf = fs.readFileSync(process.argv[2]);
  const s = await ort.InferenceSession.fromBuffer(buf);
  console.log('inputs:', s.inputNames, 'outputs:', s.outputNames);
})().catch(e => console.error(e.message));
```

- [ ] **Step 2: 失败测试（fake InferenceSession + fake tokenizer——纯 decode 逻辑测试）**

```typescript
// gateway/tests/unit/memory/gliner-engine.test.ts
import { decodeGlinerOutput, buildGlinerInput } from '../../../src/memory/gliner-engine';

describe('gliner decode (fixture tensors)', () => {
  it('buildGlinerInput: label segment precedes text segment', () => {
    const ids = buildGlinerInput({ labelIds: [10, 11, 12], textIds: [20, 21, 22] });
    expect(ids).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it('decodeGlinerOutput: top scoring span per label above threshold', () => {
    // logits[numLabels][seq][seq] — label 0, span (textStart+1, textStart+2) 高分
    const seq = 6, textStart = 3;
    const logits = new Float32Array(1 * seq * seq).fill(-5);
    logits[0 * seq * seq + (textStart + 1) * seq + (textStart + 2)] = 4.5; // sigmoid ≈ 0.989
    const spans = decodeGlinerOutput(logits, {
      seqLen: seq, textStart, labels: ['tool'],
      tokens: ['a', 'b', 'c', 'BM25', 'cache', 'x'], threshold: 0.5,
    });
    expect(spans).toEqual([{ label: 'tool', text: 'BM25 cache', score: expect.any(Number) }]);
  });
});
```

- [ ] **Step 3: 跑红 → Step 4: 实现（引擎骨架）**

```typescript
// gateway/src/memory/gliner-engine.ts
// V2 ①c: zero-shot NER via GLiNER ONNX (arXiv:2311.08526 — OOD 52.7 F1,
// beats ChatGPT zero-shot NER). Lazy singleton; model downloaded on demand
// to ~/.mafw/models/gliner/; ALL failures fail-open (null engine → callers
// skip augmentation). Follows the kokoro optional-engine pattern.

export interface GlinerSpan { label: string; text: string; score: number }

export function buildGlinerInput(p: { labelIds: number[]; textIds: number[] }): number[] {
  // parallel encoding: [CLS] label [SEP] segments precede [CLS] text [SEP]
  return [...p.labelIds, ...p.textIds];
}

export function decodeGlinerOutput(
  logits: Float32Array,
  ctx: { seqLen: number; textStart: number; labels: string[]; tokens: string[]; threshold: number },
): GlinerSpan[] {
  const { seqLen, textStart, labels, tokens, threshold } = ctx;
  const out: GlinerSpan[] = [];
  for (let li = 0; li < labels.length; li++) {
    let best: { s: number; e: number; logit: number } | null = null;
    for (let s = textStart; s < seqLen; s++) {
      for (let e = s; e < Math.min(s + 8, seqLen); e++) {
        const v = logits[li * seqLen * seqLen + s * seqLen + e];
        if (!best || v > best.logit) best = { s, e, logit: v };
      }
    }
    if (best) {
      const score = 1 / (1 + Math.exp(-best.logit));
      if (score >= threshold) {
        out.push({ label: labels[li], text: tokens.slice(best.s, best.e + 1).join(' ').trim(), score });
      }
    }
  }
  return out;
}

// getGliner(): lazy engine — download via fetch to ~/.mafw/models/gliner/,
// InferenceSession from onnxruntime-node, AutoTokenizer from
// @huggingface/transformers. Every step try/catch → null (cached promise,
// resettable). extract(): tokenize labels+text per GLiNER prompt format,
// run session, decode. ~120 lines; follow embedding-runtime's llamacpp
// sidecar pattern for the download-with-mirror-fallback.
export async function getGliner(): Promise<GlinerEngine | null> { /* 引擎实现见上注释 */ }
export interface GlinerEngine { extract(text: string, labels: string[]): Promise<GlinerSpan[]> }
```

（引擎主体实现遵循 embedding-runtime 既有下载/懒加载/失败缓存模式；**所有 require 动态**——onnxruntime-node/transformers 仅在首次 getGliner() 时加载，与 ESM 桥无关均为 CJS 可直接 require。）

- [ ] **Step 5: 跑绿（decode 纯函数 2 例）+ 手动冒烟（可选，需真模型）：`MAFW_GLINER_SMOKE=1` 时跑真模型一句话抽取——默认 skip，模式同 TUI smoke**

- [ ] **Step 6: commit**

`git add gateway/src/memory/gliner-engine.ts gateway/tests/unit/memory/gliner-engine.test.ts; git commit -m "feat(gateway): GLiNER ONNX engine (fail-open, lazy)"`

---

### Task 10: GLiNER 接线（写路径异步增广）

**Files:**
- Modify: `gateway/src/memory/harmonic-file-store.ts`（write 尾部 onMemoryWritten 监听旁，或独立监听注册）
- Test: `gateway/tests/unit/memory/gliner-wiring.test.ts`

**Interfaces:**
- Consumes: `onMemoryWritten`（既有）、`getGliner`、`extractEntities`
- Produces: 监听器把 GLiNER span text 追加进 entry 的 cue_anchors（index 级、cap 10、去重；不重写 OKF——检索面即可）+ config flag `recall.entityHarvest`（默认 true，fail-open）

- [ ] **Step 1: 失败测试**——注册一个 fake gliner（模块级 `setGlinerForTest()`），写一条 unit → 监听器异步把 span 写进 index entry cue_anchors；flag off 时不写。**注意**：监听器改 entry 后需 `indexManager.save()`（异步 fire-and-forget，测试 await 一个 flush 钩子——给监听器工厂暴露 `__flushForTest`）。

- [ ] **Step 2-4: 红→实现→绿**——监听器注册进 `index.ts` 启动序列（`registerMemoryPipelineActions` 附近）：

```typescript
    // V2 ①c: GLiNER entity augmentation (fire-and-forget, fail-open).
    if (config.recall?.entityHarvest !== false) {
      onMemoryWritten(async (unit) => {
        try {
          const { getGliner } = require('./memory/gliner-engine');
          const engine = await getGliner();
          if (!engine) return;
          const spans = await engine.extract(unit.memory_value, ['tool', 'project', 'version', 'concept', 'command']);
          const texts = spans.map(s => s.text).filter(t => t.length >= 2 && t.length <= 40);
          if (texts.length === 0) return;
          const entry = this.memoryService.harmonicIndex.getIndex().entries.find((e: any) => e.id === unit.id);
          if (!entry || entry.superseded_by) return;
          const merged = [...new Set([...(entry.cue_anchors ?? []), ...texts])].slice(0, 10);
          entry.cue_anchors = merged;
          this.memoryService.harmonicIndex.save();
        } catch { /* fail-open */ }
      });
    }
```

（onMemoryWritten 是同步签名 `(unit) => void`——异步回调可直接传入（返回 promise 被忽略），监听器 try/catch 已包。）

- [ ] **Step 5: commit**——`feat(gateway): GLiNER entity augmentation wired into write path`

---

## Batch 3：graceRevisit + ⑤ + ⑥

### Task 11: grace-revisit 管线

**Files:**
- Create: `gateway/src/recall/grace-revisit.ts`
- Test: `gateway/tests/unit/recall/grace-revisit.test.ts`

**Interfaces:**
- Consumes: `selectNewerRelated`（`reconsolidate-pipeline.ts:22`——PE 判定复用）
- Produces:
  - `selectGraceCandidates(entries, now, opts?): Array<{ id: string; related: HarmonicIndexEntry[] }>`——age ≤ 48h、semantic/procedural、未 superseded、无 rejected/redundant 锚，且 `selectNewerRelated` 非空
  - `GraceRevisitDeps`（worker/readMemory/readRelated/writeSuperseding/markRejected/mergeInto/budget/onVerdict）
  - `GraceRevisitPipeline.runOnce(): Promise<{ selected: number; kept: number; updated: number; merged: number; demoted: number; skipped: number }>`
  - verdict JSON：`{"revisits":[{"id":"...","verdict":"keep|update|merge|demote","content":"<新版本全文，update/merge 时>","mergeWith":"<id，merge 时>"}]}`

- [ ] **Step 1: 失败测试**

```typescript
// gateway/tests/unit/recall/grace-revisit.test.ts
import { selectGraceCandidates } from '../../../src/recall/grace-revisit';
import { HarmonicIndexEntry } from '../../../src/core/memory/harmonic-types';

const T0 = Date.parse('2026-10-12T00:00:00.000Z');
const H = 3600 * 1000;
function mkEntry(id: string, hoursAgo: number, cues: string[], extra: any = {}): HarmonicIndexEntry {
  return { id, type: 'semantic', primary_abstraction: id, cue_anchors: cues, tier: 'semantic',
    energy: 0.6, created_at: new Date(T0 - hoursAgo * H).toISOString(), ...extra } as any;
}

describe('selectGraceCandidates (48h × PE gate)', () => {
  it('young gist with newer same-cue content → selected', () => {
    const young = mkEntry('g1', 10, ['bm25']);
    const newer = mkEntry('n1', 2, ['bm25']);
    const out = selectGraceCandidates([young, newer], T0);
    expect(out.map(o => o.id)).toEqual(['g1']);
    expect(out[0].related.map(r => r.id)).toEqual(['n1']);
  });
  it('young gist with NO newer related → not selected (no PE, no window)', () => {
    const young = mkEntry('g2', 10, ['docker']);
    const old = mkEntry('o1', 100, ['docker']);
    expect(selectGraceCandidates([young, old], T0)).toEqual([]);
  });
  it('older than 48h / superseded / rejected / episodic → excluded', () => {
    const a = mkEntry('a', 50, ['x']);            // 超窗（但仍会被 selectNewerRelated 命中与否先过窗）
    const b = mkEntry('b', 10, ['x'], { superseded_by: 'z' });
    const c = mkEntry('c', 10, ['x'], { cue_anchors: ['x', 'rejected'] });
    const d = mkEntry('d', 10, ['x'], { type: 'episodic' });
    const newer = mkEntry('n2', 1, ['x']);
    expect(selectGraceCandidates([a, b, c, d, newer], T0)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现选择器**

```typescript
// gateway/src/recall/grace-revisit.ts
// V2 ④: grace-period re-visit. Young (≤48h) slow-system writes with a
// prediction-error signal (newer same-cue content exists — selectNewerRelated
// reused from D2) are re-read nightly by the reflection worker; verdicts:
// keep / update (additive supersede) / merge (dupCandidate convergence) /
// demote. authority=user entries are observe-only. Sevenster 2014: PE
// demarcates retrieval→reconsolidation→new-learning; no PE = no window.
import { HarmonicIndexEntry, HarmonicUnit } from '../core/memory/harmonic-types';
import { selectNewerRelated } from './reconsolidate-pipeline';
import { PipelineBudgetLike } from './pipeline-budget';

export const GRACE_WINDOW_MS = 48 * 3600 * 1000;

export function selectGraceCandidates(
  entries: HarmonicIndexEntry[],
  now: number,
  opts?: { windowMs?: number; maxPerRun?: number },
): Array<{ id: string; related: HarmonicIndexEntry[] }> {
  const windowMs = opts?.windowMs ?? GRACE_WINDOW_MS;
  const out: Array<{ id: string; related: HarmonicIndexEntry[] }> = [];
  for (const e of entries) {
    if (out.length >= (opts?.maxPerRun ?? 20)) break;
    if (e.type !== 'semantic' && e.type !== 'procedural') continue;
    if (e.superseded_by) continue;
    const anchors = e.cue_anchors ?? [];
    if (anchors.includes('rejected') || anchors.some(a => a.startsWith('redundant:'))) continue;
    const created = e.created_at ? Date.parse(e.created_at) : 0;
    if (!created || now - created > windowMs) continue;
    const related = selectNewerRelated(
      { id: e.id, cue_anchors: anchors, created_at: e.created_at! }, entries, now, 5);
    if (related.length === 0) continue; // PE gate: no newer related → no window
    out.push({ id: e.id, related });
  }
  return out;
}
```

- [ ] **Step 4: 跑绿 → Step 5: 管线主体（同文件追加，TDD 第二轮）**

```typescript
export interface GraceVerdict { id: string; verdict: 'keep' | 'update' | 'merge' | 'demote'; content?: string; mergeWith?: string }

export interface GraceRevisitDeps {
  index: { getIndex(): { entries: HarmonicIndexEntry[] } };
  readMemory: (id: string) => Promise<HarmonicUnit | null>;
  worker: { prompt(text: string, system: string): Promise<string> };
  /** Additive rewrite: new version + supersedes old (Lei 2024). */
  writeSuperseding: (oldId: string, content: string) => Promise<string>;
  /** Merge convergence: combined unit supersedes both. */
  writeMerged: (aId: string, bId: string, content: string) => Promise<string>;
  markRejected: (id: string) => Promise<void>;
  /** shadow mode: verdicts logged, never executed. */
  mode: 'shadow' | 'live';
  /** Observe sink — every verdict lands here (jsonl in production). */
  onVerdict: (v: GraceVerdict & { executed: boolean }) => void;
  budget?: PipelineBudgetLike;
  maxPerRun?: number;
}

export const GRACE_SYSTEM = `You re-visit young long-term memories that have received newer related evidence. For each memory decide: "keep" (evidence adds nothing), "update" (evidence evolves/contradicts it — provide the merged updated full text), "merge" (a distinct memory listed in mergeWith says the same thing — provide the combined full text), or "demote" (the memory is wrong or worthless now). Reply with ONLY JSON: {"revisits":[{"id":"...","verdict":"keep|update|merge|demote","content":"<full merged text when update/merge>","mergeWith":"<related id when merge>"}]}`;

export class GraceRevisitPipeline {
  constructor(private opts: GraceRevisitDeps) {}

  async runOnce(): Promise<{ selected: number; kept: number; updated: number; merged: number; demoted: number; skipped: number }> {
    const r = { selected: 0, kept: 0, updated: 0, merged: 0, demoted: 0, skipped: 0 };
    if (this.opts.budget && !this.opts.budget.allow('reflect')) return r;
    const entries = this.opts.index.getIndex().entries;
    const now = Date.now();
    const candidates = selectGraceCandidates(entries, now, { maxPerRun: this.opts.maxPerRun ?? 20 });
    if (candidates.length === 0) return r;
    r.selected = candidates.length;

    const blocks: string[] = [];
    for (const c of candidates) {
      const unit = await this.opts.readMemory(c.id);
      if (!unit) { r.skipped++; continue; }
      const related = c.related.map(rel => `- [${rel.id}] ${rel.primary_abstraction}`).join('\n');
      blocks.push(`MEMORY [${c.id}]:\n${unit.memory_value.slice(0, 1500)}\nNEWER RELATED:\n${related}`);
    }
    if (blocks.length === 0) return r;

    let verdicts: GraceVerdict[] = [];
    try {
      const reply = await this.opts.worker.prompt(blocks.join('\n\n---\n\n'), GRACE_SYSTEM);
      const m = reply.match(/\{[\s\S]*\}/);
      const parsed = m ? JSON.parse(m[0]) : null;
      if (Array.isArray(parsed?.revisits)) verdicts = parsed.revisits;
    } catch { return r; }

    const byId = new Map(entries.map(e => [e.id, e]));
    for (const v of verdicts) {
      const entry = byId.get(v.id);
      if (!entry || entry.superseded_by) { r.skipped++; continue; }
      // G1 discipline: pipeline never rewrites user-authority memories.
      const isUser = (entry as any).authority === 'user';
      const executed = this.opts.mode === 'live' && !isUser && v.verdict !== 'keep';
      try {
        if (executed && v.verdict === 'update' && v.content?.trim()) {
          await this.opts.writeSuperseding(v.id, v.content.trim()); r.updated++;
        } else if (executed && v.verdict === 'merge' && v.mergeWith && v.content?.trim()) {
          await this.opts.writeMerged(v.id, v.mergeWith, v.content.trim()); r.merged++;
        } else if (executed && v.verdict === 'demote') {
          await this.opts.markRejected(v.id); r.demoted++;
        } else if (v.verdict === 'keep') {
          r.kept++;
        } else {
          r.skipped++;
        }
      } catch { r.skipped++; continue; }
      this.opts.onVerdict({ ...v, executed });
    }
    return r;
  }
}
```

**测试**（第二轮 TDD）：FakeWorker 返回 update/merge/demote/keep 四种 verdict → live 模式全执行、user 权威不执行、shadow 模式全 onVerdict(executed:false)。写出具体断言（模式照 reconsolidate-pipeline 的测试文件）。

- [ ] **Step 6: 全量 + commit**——`feat(gateway): graceRevisit pipeline (48h × PE-gated, additive verdicts)`

---

### Task 12: reflection 集成（runAll 尾 phase + flag + heartbeat）

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（runAll 尾部）+ `gateway/src/config.ts`（`recall.graceRevisit?: 'off' | 'shadow' | 'live'`，默认 `'shadow'`）+ `gateway/src/index.ts`（构建 GraceRevisitPipeline 的 deps：worker 用任一已存在 worker 或 reflection 首个 worker、writeSuperseding/writeMerged/markRejected 落地函数、onVerdict → `~/.mafw/logs/grace-verdicts.jsonl`）+ heartbeat `record('graceRevisit')`
- Test: `gateway/tests/unit/recall/grace-revisit-integration.test.ts`

**关键实现**：
- `writeSuperseding(oldId, content)`：复用 D2 在 index.ts 的同名落地（找 `writeSuperseding` 既有实现；若无独立函数则照 reconsolidate 的接线处抄）。
- `writeMerged(aId, bId, content)`：新 unit（cue_anchors = 双方并集 cap 8、`merged_from: [aId, bId]`、energy 0.75、authority 沿 higherAuthority）→ store.write → markSuperseded(aId) + markSuperseded(bId)。
- `markRejected(id)`：read → energy 0.05 + `rejected` 锚 → write（照 applyTentativeVerdicts 的 reject 分支）。
- flag off 时 phase 不跑；heartbeat ok = selected>0 或零候选也算 ok（counts 记录）。
- **测试**：mode shadow → jsonl 落盘且 store 无变化；mode live → update 走 supersede 链。

- [ ] **TDD 循环后 commit**——`feat(gateway): graceRevisit wired into reflection cron (shadow default)`

---

### Task 13: ⑤ evidence hybrid + 宽限期前置

**Files:**
- Modify: `gateway/src/recall/reflection.ts`（Step 2 检索 ~348 行）
- Test: `gateway/tests/unit/recall/reflection-evidence.test.ts`

**实现**（检索行改 + 排序加权）：

```typescript
          // V2 ⑤: hybrid evidence (dense fusion when embedding runtime is
          // available) with grace-window gists prioritized — they are the
          // reconcile targets of tonight's pass.
          const hits = this.opts.index.searchScored(q, 5, {
            retriever: 'hybrid', graphExpand: false,
          } as any);
```
（`retriever: 'hybrid'` 在无嵌入 runtime 时 searchScored 内部自然回退 bm25——核对 harmonic-index 的 retriever 分支确认回退路径存在；若无则保持 'bm25' 并在 denseScores 可用时手动传 denseScores 选项。**实现前先读 searchScored 的 retriever 分支**，以实际 API 为准。）

排序加权：evidence 数组构建时，`hit.entry` 满足 `age ≤ 48h && (semantic|procedural)` 的行前置（稳定排序，标记 `↳grace`）。

- [ ] **TDD：hybrid 调用参数 + grace 前置断言**（fake index.searchScored 捕获 opts）→ commit `feat(gateway): reflection evidence hybrid + grace-window priority`

---

### Task 14: ⑥ salience v2 observe

**Files:**
- Modify: `gateway/src/recall/grace-revisit.ts`（选样趟顺带计算 + jsonl）
- Test: `gateway/tests/unit/recall/salience-v2.test.ts`

**Interfaces:**
- Produces: `computeSalienceV2(entry, deps: { needFor?: (id: string) => number }): { static: number; need: number; authority: number; novelty: number; value: number }`——归一化加权和 `0.5·static + 0.25·needNorm + 0.15·authorityRank/3 + 0.10·novelty`（need 归一化 `min(1, need7d/5)`；novelty 缺省 0.5；authority rank 用 AUTHORITY_RANK/3）

**实现要点**：graceRevisit runOnce 在 selectGraceCandidates 后对候选 + 每 candidate 的 related 计算，append `~/.mafw/logs/salience-v2.jsonl`（id、分量、value、ts）；**不写回条目不动排序**。纯函数 + jsonl 追加，TDD 照 fok-samples 模式。

- [ ] **TDD 循环后 commit**——`feat(gateway): salience v2 observe-only (components jsonl)`

---

## Batch 4：TCM shadow + F 层读原文

### Task 15: TCM 分段纯模块

**Files:**
- Create: `gateway/src/recall/topic-segmentation.ts`
- Test: `gateway/tests/unit/recall/topic-segmentation.test.ts`

**Interfaces:**
- Produces:
  - `segmentTurns<T extends { text: string; structuralBreak?: boolean }>(turns: T[], opts?: SegmentationOpts): Array<{ items: T[]; boundaryBefore: boolean; sealedVector?: number[] }>`
  - `runningVector(prev: number[] | null, tokens: Set<string>, opts: { alpha: number }): number[]`——TCM 式加权质心：`v = α·current + (1-α)·prev`（current 为 token 均匀向量）
  - `SegmentationOpts = { alpha?: number; cosineThreshold?: number; vocabulary?: Map<string, number> }`（默认 alpha 0.3、threshold 0.55）
  - 词表：全局递增编号（vocabulary 传入共享），向量维度 = 词表大小（稀疏 → 用 Map<number, number> 表示，cosine 遍历非零键）
  - `structuralBreak: true` 强制切界（Tier0 信号：文件切换/goal/工具失败——由调用方标注）

- [ ] **Step 1: 失败测试**

```typescript
// gateway/tests/unit/recall/topic-segmentation.test.ts
import { segmentTurns } from '../../../src/recall/topic-segmentation';

describe('TCM topic segmentation', () => {
  it('topic drift creates a boundary; same topic stays one segment', () => {
    const turns = [
      { text: 'fix the BM25 token cache bug in harmonic index' },
      { text: 'the BM25 cache now memoizes tokens per entry' },
      { text: 'the BM25 cache speeds up boundary recall' },
      { text: 'switching gears: the desktop tray icon needs a new menu' },
      { text: 'tray menu should show pending approvals count' },
    ];
    const segs = segmentTurns(turns);
    expect(segs).toHaveLength(2);
    expect(segs[0].items).toHaveLength(3);
    expect(segs[1].items).toHaveLength(2);
    expect(segs[1].boundaryBefore).toBe(true);
  });

  it('structuralBreak forces a boundary regardless of cosine', () => {
    const turns = [
      { text: 'bm25 cache work continues here' },
      { text: 'bm25 cache work continues more', structuralBreak: true },
    ];
    const segs = segmentTurns(turns);
    expect(segs).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 跑红 → Step 3: 实现**

```typescript
// gateway/src/recall/topic-segmentation.ts
// V2 ②: TCM-style running-vector boundary detection (pure). Adjacent-turn
// cosine below threshold = event boundary ("splitter-is-the-indexer": the
// sealed segment vector doubles as the segment retrieval key). Tier0
// structural signals force boundaries. Shadow mode only in V2.

export interface SegmentationOpts { alpha?: number; cosineThreshold?: number }

function tokensOf(text: string): string[] {
  const raw = text.toLowerCase();
  return [...(raw.match(/[a-z0-9_]{2,}/g) ?? []), ...(raw.match(/[\u4e00-\u9fff]/g) ?? [])];
}

export function runningVector(
  prev: Map<number, number> | null,
  tokenIds: number[],
  alpha: number,
): Map<number, number> {
  const cur = new Map<number, number>();
  for (const id of tokenIds) cur.set(id, (cur.get(id) ?? 0) + 1);
  const out = new Map<number, number>();
  if (prev) for (const [k, v] of prev) out.set(k, v * (1 - alpha));
  for (const [k, v] of cur) out.set(k, (out.get(k) ?? 0) + v * alpha);
  return out;
}

function cosineSparse(a: Map<number, number>, b: Map<number, number>): number {
  let dot = 0, na = 0, nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const [k, v] of small) { const w = big.get(k); if (w) dot += v * w; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

export function segmentTurns<T extends { text: string; structuralBreak?: boolean }>(
  turns: T[],
  opts?: SegmentationOpts,
): Array<{ items: T[]; boundaryBefore: boolean; sealedVector?: Map<number, number> }> {
  const alpha = opts?.alpha ?? 0.3;
  const threshold = opts?.cosineThreshold ?? 0.55;
  const vocab = new Map<string, number>();
  const idOf = (t: string) => {
    let id = vocab.get(t);
    if (id === undefined) { id = vocab.size; vocab.set(t, id); }
    return id;
  };
  const segments: Array<{ items: T[]; boundaryBefore: boolean; sealedVector?: Map<number, number> }> = [];
  let current: T[] = [];
  let currentVec: Map<number, number> | null = null;
  let currentStartBoundary = false;
  const seal = () => {
    if (current.length > 0) segments.push({ items: current, boundaryBefore: currentStartBoundary, sealedVector: currentVec ?? undefined });
    current = []; currentVec = null; currentStartBoundary = true;
  };
  for (const t of turns) {
    if (t.structuralBreak && current.length > 0) seal();
    const ids = tokensOf(t.text).map(idOf);
    const nextVec = runningVector(currentVec, ids, alpha);
    if (currentVec && cosineSparse(currentVec, nextVec) < threshold) {
      seal();
      currentVec = runningVector(null, ids, alpha);
    } else {
      currentVec = nextVec;
    }
    current.push(t);
    if (currentStartBoundary && current.length === 1 && segments.length === 0) currentStartBoundary = false;
  }
  seal();
  return segments;
}
```

（首段 boundaryBefore=false 的细节以测试为准修正——实现时跑测试对齐。）

- [ ] **Step 4: 跑绿 + commit**——`feat(gateway): TCM running-vector topic segmentation (pure)`

---

### Task 16: ② shadow 接线（小时批旁记录）

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（runOnce 批处理处）+ `gateway/src/config.ts`（`recall.segmentation?: 'off' | 'shadow' | 'live'`，默认 `'shadow'`）
- Test: `gateway/tests/unit/recall/segmentation-shadow.test.ts`

**实现**：turn-pipeline 组批时（按会话聚合 turn 的循环旁）：

```typescript
      // V2 ② shadow: compute event-segment boundaries alongside the hourly
      // batch, log for comparison — never touches the trigger.
      if (config.recall?.segmentation === 'shadow') {
        try {
          const { segmentTurns } = require('./topic-segmentation');
          const segs = segmentTurns(sessionTurns.map((t: any) => ({ text: String(t.content ?? ''), structuralBreak: Boolean(t.structuralBreak) })));
          fs.appendFileSync(segmentationShadowLog(),
            JSON.stringify({ ts: Date.now(), sessionID, batchTurns: sessionTurns.length, segments: segs.map(s => ({ n: s.items.length, boundaryBefore: s.boundaryBefore })) }) + '\n');
        } catch { /* fail-open */ }
      }
```

（`segmentationShadowLog()` = `~/.mafw/logs/segmentation-shadow.jsonl` 路径 helper，模式照 fok-samples 的 `FOK_SAMPLES_FILE()`；sessionTurns 的实际字段名以 turn-pipeline.ts 现状为准——先读再写。）

- [ ] **TDD：flag shadow 时写日志行、off 时不写（注入 tmp 路径）→ commit** `feat(gateway): TCM segmentation shadow logging`

---

### Task 17: ③ F 层读事件段原文（flag + A/B）

**Files:**
- Modify: `gateway/src/recall/turn-pipeline.ts`（prompt 构建处 ~120-130 行 observationsToTranscript 旁）+ `gateway/src/config.ts`（`recall.eventSegmentInput?: boolean`，默认 false）
- Test: `gateway/tests/unit/recall/event-segment-input.test.ts`

**实现**：

```typescript
      // V2 ③: event-segment verbatim block (A/B: flag on → alternate by day
      // parity per session so both arms accumulate comparable need-hit data).
      const eventSegOn = config.recall?.eventSegmentInput === true
        && abAssignment(sessionID, Date.now()); // even-day arm
      if (eventSegOn) {
        try {
          const { segmentTurns } = require('./topic-segmentation');
          const segs = segmentTurns(sessionTurns.map(...));
          const block = segs.map((s, i) =>
            `### Event Segment ${i + 1}\n${s.items.map((t: any) => String(t.content ?? '')).join('\n').slice(0, 4000)}`).join('\n\n');
          transcript = `${transcript}\n\n--- EVENT-SEGMENT VERBATIM (A/B arm) ---\n${block}`;
        } catch { /* fail-open: batch transcript only */ }
      }
```

`abAssignment(sessionID, now)`（导出纯函数，同文件）：`new Date(now).getUTCDate() % 2 === 0`（会话级日交替双臂）。transcript 仍过 `capTranscript`。

- [ ] **TDD：abAssignment 确定性 + flag on 时 prompt 含 EVENT-SEGMENT 标头 + flag off 不含 → commit** `feat(gateway): F-layer event-segment verbatim input (A/B gated)`

---

## 收尾（全部批次完成后）

- [ ] 全量门禁：`cd gateway; npx jest --runInBand`（对照基线，报告 suites/tests 数）
- [ ] `cd gateway; npx tsc --noEmit -p tsconfig.json`
- [ ] root `npm run build`（index.ts 不在 jest 覆盖内）
- [ ] 更新 `docs/research/2026-10-10-memory-target-architecture.md` §4 V2 行状态（设计定案 → 已实施）
- [ ] 汇报：版本号建议（v4.27.0）+ commit 列表 + 新增测试数 + 全量通过数（用户惯例）
- [ ] push 需用户显式批准；部署走 mafw-gateway-restart skill 流程

## Self-Review 记录

- Spec 覆盖：①a(T3,T4) ①b(T1,T2,L3=T11 merge verdict) ①c(T8,T9,T10) ②(T15,T16) ③(T17) ④(T11,T12) ⑤(T13) ⑥(T14) ⑦(T5,T6) stats(T7)——全覆盖；spec 的"L3 ConsolidationService dupCandidate 标记"并入 T11 merge verdict 路径（ConsolidationService 本体不动，其 UPDATE 开闸是非目标）。
- 偏离记录：skipMerge 保留 deprecated no-op（noReply 先例，避免动 4 个 eval 文件）。
- 类型一致性：capCommitment/selectGraduations/commitment_capped_at/collapseNearDuplicates/selectGraceCandidates/GraceVerdict/segmentTurns 全计划统一命名。
- 风险点：T9 GLiNER 模型签名需先验证（Step 1 显式步骤）；T13 hybrid 回退路径需先读 searchScored 分支。
