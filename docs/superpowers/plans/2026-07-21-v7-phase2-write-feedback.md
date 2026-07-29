# MAFW v7 Phase 2: 写路径与反馈层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade write path with lazy energy calculation, 3-level merge with arbitration, miss attribution feedback loop, anchor promotion pipeline, and deferred memory system.

**Architecture:** Energy becomes lazily computed at read time, settled during index rebuild (delete decay.ts). Write path uses 3-level abstraction similarity instead of MinHash for merge decisions. Feedback signals feed into anchor promotion queue and energy adjustments.

**Tech Stack:** TypeScript, Node.js fs, js-yaml

## Global Constraints

- Energy: `energy_effective = energy_base × decay_factor(now - last_reviewed) + access_boost(n_access)`, capped at 1.0
- Lazy energy: no more batch `decay.ts` writes to frontmatter. Rebuild is the only batch write point
- 3-level merge: >0.92 auto-merge, 0.75-0.92 return conflict signal, <0.75 fall through to LSH/MinHash
- Default arbitration: `"link"` (independent + cross-link) on timeout
- `mafw_resolve_merge`: accepts `"merge" | "link" | "abstract"` for conflict resolution
- miss_cause sources: Review Agent annotation (A) + automatic detection (B)
- Anchor promotion queue: `.suggested-anchors.json`, reviewed by Agent during SessionStart
- Deferred Memory: T1 observations join index only after ≥3 same-topic hits or explicit reference
- Distillation: proposition extraction with knowledge signal gate + quality gate (5 criteria)

---

### Task 1: Lazy energy calculation (delete decay.ts)

**Files:**
- Delete: `src/memory/decay.ts`
- Modify: `gateway/src/memory/harmonic-file-store.ts` — add `calculateEnergy()` helper
- Create: `gateway/src/memory/energy-calculator.ts`
- Test: `tests/unit/memory/energy-calculator.test.ts`

**Interfaces:**
- Produces: `calculateEnergy(energyBase, lastReviewed, reviewCount, recentAccessCount): number`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/memory/energy-calculator.test.ts
import { calculateEnergy } from '../../gateway/src/memory/energy-calculator';

test('calculateEnergy returns base when fresh', () => {
  const result = calculateEnergy(0.8, Date.now(), 0, 0);
  expect(result).toBe(0.8);
});

test('calculateEnergy decays over time', () => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const result = calculateEnergy(0.8, thirtyDaysAgo, 0, 0);
  expect(result).toBeLessThan(0.8);
  expect(result).toBeGreaterThan(0);
});

test('calculateEnergy boosts with recent access', () => {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const noAccess = calculateEnergy(0.8, thirtyDaysAgo, 0, 0);
  const withAccess = calculateEnergy(0.8, thirtyDaysAgo, 0, 5);
  expect(withAccess).toBeGreaterThan(noAccess);
});

test('calculateEnergy caps at 1.0', () => {
  const result = calculateEnergy(0.95, Date.now(), 0, 100);
  expect(result).toBeLessThanOrEqual(1.0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/energy-calculator.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement EnergyCalculator**

```typescript
// gateway/src/memory/energy-calculator.ts

const DECAY_PER_DAY = 0.005; // 0.5% per day
const ACCESS_BOOST_PER_EVENT = 0.02; // +0.02 per access event
const MAX_ACCESS_BOOST = 0.3; // cap access boost at 0.3

export function calculateEnergy(
  energyBase: number,
  lastReviewed: number | string,
  _reviewCount: number,
  recentAccessCount: number,
): number {
  const lastTime = typeof lastReviewed === 'string'
    ? new Date(lastReviewed).getTime()
    : lastReviewed;
  const daysSinceUpdate = (Date.now() - lastTime) / (24 * 60 * 60 * 1000);
  const decay = Math.max(0, 1 - DECAY_PER_DAY * Math.max(0, daysSinceUpdate));
  const boost = Math.min(MAX_ACCESS_BOOST, ACCESS_BOOST_PER_EVENT * recentAccessCount);
  return Math.min(1.0, Math.max(0, energyBase * decay + boost));
}
```

- [ ] **Step 4: Delete decay.ts**

Check if `src/memory/decay.ts` exists. If so, delete it. Also search for any imports of decay.ts and remove them.

```bash
Remove-Item -Path "src/memory/decay.ts" -ErrorAction SilentlyContinue
```

Search for `from '../memory/decay'` or `from './decay'` across the codebase and remove those imports.

- [ ] **Step 5: Run tests**

Run: `npx jest tests/unit/memory/energy-calculator.test.ts --no-coverage`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: No errors (no remaining references to decay.ts)

- [ ] **Step 6: Commit**

```bash
git add gateway/src/memory/energy-calculator.ts tests/unit/memory/energy-calculator.test.ts
git rm src/memory/decay.ts
git commit -m "feat(v7): replace decay.ts with lazy energy calculation"
```

---

### Task 2: Abstraction matcher — 3-level merge similarity

**Files:**
- Create: `gateway/src/memory/abstraction-matcher.ts`
- Test: `tests/unit/memory/abstraction-matcher.test.ts`

**Interfaces:**
- Produces: `matchAbstraction(newAbstraction, existingAbstraction): { similarity: number; level: 'auto' | 'conflict' | 'none' }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/memory/abstraction-matcher.test.ts
import { matchAbstraction } from '../../gateway/src/memory/abstraction-matcher';

test('matchAbstraction returns auto-merge > 0.92', () => {
  const result = matchAbstraction('create payment order', 'create payment transaction');
  expect(result.similarity).toBeGreaterThanOrEqual(0.92);
  expect(result.level).toBe('auto');
});

test('matchAbstraction returns conflict 0.75-0.92', () => {
  const result = matchAbstraction('create payment order', 'refund payment process');
  expect(result.similarity).toBeGreaterThanOrEqual(0.75);
  expect(result.similarity).toBeLessThan(0.92);
  expect(result.level).toBe('conflict');
});

test('matchAbstraction returns none < 0.75', () => {
  const result = matchAbstraction('database schema design', 'user login flow');
  expect(result.similarity).toBeLessThan(0.75);
  expect(result.level).toBe('none');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/abstraction-matcher.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement matchAbstraction**

```typescript
// gateway/src/memory/abstraction-matcher.ts
import { tokenize } from './derived-terms';

export interface MatchResult {
  similarity: number;
  level: 'auto' | 'conflict' | 'none';
}

const AUTO_THRESHOLD = 0.92;
const CONFLICT_THRESHOLD = 0.75;

export function matchAbstraction(a: string, b: string): MatchResult {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { similarity: 0, level: 'none' };
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  const jaccard = intersection.size / union.size;

  if (jaccard >= AUTO_THRESHOLD) return { similarity: jaccard, level: 'auto' };
  if (jaccard >= CONFLICT_THRESHOLD) return { similarity: jaccard, level: 'conflict' };
  return { similarity: jaccard, level: 'none' };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/memory/abstraction-matcher.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/abstraction-matcher.ts tests/unit/memory/abstraction-matcher.test.ts
git commit -m "feat(v7): add 3-level abstraction matcher for merge decisions"
```

---

### Task 3: `mafw_resolve_merge` MCP tool

**Files:**
- Create: `gateway/src/mcp/handlers/resolve-merge.ts`
- Modify: `gateway/src/mcp/tool-registry.ts` — register tool

**Interfaces:**
- MCP tool: `mafw_resolve_merge({ conflictingId, newAbstraction, action: 'merge' | 'link' | 'abstract' })`

- [ ] **Step 1: Create handler**

```typescript
// gateway/src/mcp/handlers/resolve-merge.ts
import { ToolHandler } from '../../types';
import { HarmonicUnitFileStore } from '../../memory/harmonic-file-store';
import { matchAbstraction } from '../../memory/abstraction-matcher';

export const handleResolveMerge: ToolHandler = async (args, { memory }) => {
  try {
    const conflictingId = args.conflictingId as string;
    const newAbstraction = args.newAbstraction as string;
    const action = args.action as 'merge' | 'link' | 'abstract';

    if (!conflictingId || !newAbstraction || !action) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'conflictingId, newAbstraction, and action required' }) }], isError: true };
    }

    const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();
    const mafwDir = path.join(projectDir, '.mafw');
    const store = new HarmonicUnitFileStore(mafwDir);

    // Load existing unit
    const existing = await store.read(conflictingId);
    if (!existing) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Unit ${conflictingId} not found` }) }], isError: true };
    }

    const match = matchAbstraction(newAbstraction, existing.primary_abstraction);

    if (action === 'merge') {
      // Merge: combine values, add aliases
      existing.memory_value = existing.memory_value + '\n---\n(' + newAbstraction + ' merge)';
      existing.merged_from = [...(existing.merged_from || []), conflictingId + '-merged'];
      existing.updated_at = new Date().toISOString();
      await store.write(existing);
    } else if (action === 'link') {
      // Link: add [[link]] to existing memory_value
      existing.memory_value = existing.memory_value + `\n\nRelated: [[${newAbstraction}]]`;
      existing.updated_at = new Date().toISOString();
      await store.write(existing);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify({ success: true, action, similarity: match.similarity }) }],
    };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] **Step 2: Register in tool-registry.ts**

```typescript
// In tool-registry.ts DEFINITIONS array:
{
  name: "mafw_resolve_merge",
  description: "Resolve merge conflict between existing and new memory. Actions: merge (combine), link (cross-reference), abstract (create parent node)",
  inputSchema: {
    type: "object",
    properties: {
      conflictingId: { type: "string", description: "ID of existing conflicting memory" },
      newAbstraction: { type: "string", description: "Primary abstraction of new memory" },
      action: { type: "string", enum: ["merge", "link", "abstract"], description: "Resolution action" },
    },
    required: ["conflictingId", "newAbstraction", "action"],
  },
},
```

And in the handlers:
```typescript
import { handleResolveMerge } from "./handlers/resolve-merge";
// ...
mafw_resolve_merge: handleResolveMerge,
```

- [ ] **Step 3: Build and verify**

Run: `npm run build` in `gateway/`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add gateway/src/mcp/handlers/resolve-merge.ts gateway/src/mcp/tool-registry.ts
git commit -m "feat(v7): add mafw_resolve_merge MCP tool for conflict arbitration"
```

---

### Task 4: Miss attribution — automatic miss cause detection

**Files:**
- Create: `gateway/src/feedback/miss-attribution.ts`
- Test: `tests/unit/feedback/miss-attribution.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/feedback/miss-attribution.test.ts
import { classifyMiss } from '../../gateway/src/feedback/miss-attribution';

test('classifyMiss detects anchor_poor when memories exist but not retrieved', () => {
  const result = classifyMiss({
    query: 'payment timeout',
    matchedCount: 0,
    relatedMemoryExists: true,
    relatedMemoryAnchors: ['payment', 'order'],
  });
  expect(result.cause).toBe('anchor_poor');
  expect(result.candidates.length).toBeGreaterThan(0);
});

test('classifyMiss detects irrelevant when matched count is high but irrelevant', () => {
  const result = classifyMiss({
    query: 'deployment script',
    matchedCount: 5,
    relatedMemoryExists: true,
    relatedMemoryAnchors: ['deploy'],
  });
  expect(result.cause).toBe('irrelevant_memory');
});
```

- [ ] **Step 2: Run test**

Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
// gateway/src/feedback/miss-attribution.ts
import { tokenize } from '../memory/derived-terms';

export interface MissInput {
  query: string;
  matchedCount: number;
  relatedMemoryExists: boolean;
  relatedMemoryAnchors: string[];
}

export interface MissResult {
  cause: 'anchor_poor' | 'irrelevant_memory';
  candidates: string[];
}

export function classifyMiss(input: MissInput): MissResult {
  const queryTokens = tokenize(input.query);
  const candidateAnchors: string[] = [];

  if (input.relatedMemoryExists && input.matchedCount === 0) {
    // Knowledge exists but navigation failed
    for (const qt of queryTokens) {
      if (!input.relatedMemoryAnchors.some(a => a.includes(qt))) {
        candidateAnchors.push(qt);
      }
    }
    return { cause: 'anchor_poor', candidates: candidateAnchors.slice(0, 3) };
  }

  if (input.matchedCount > 3) {
    return { cause: 'irrelevant_memory', candidates: [] };
  }

  return { cause: 'anchor_poor', candidates: candidateAnchors.slice(0, 3) };
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/feedback/miss-attribution.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/feedback/miss-attribution.ts tests/unit/feedback/miss-attribution.test.ts
git commit -m "feat(v7): add automatic miss cause attribution"
```

---

### Task 5: Anchor promotion pipeline

**Files:**
- Create: `gateway/src/feedback/anchor-promotion.ts`
- Test: `tests/unit/feedback/anchor-promotion.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/feedback/anchor-promotion.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AnchorPromotion } from '../../gateway/src/feedback/anchor-promotion';

describe('AnchorPromotion', () => {
  let tmpDir: string;
  let promo: AnchorPromotion;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-'));
    promo = new AnchorPromotion(tmpDir);
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('suggest adds a candidate anchor', () => {
    promo.suggest('mem_001', 'timeout');
    const queue = promo.getQueue();
    expect(queue.length).toBe(1);
    expect(queue[0].anchor).toBe('timeout');
  });

  test('promote moves anchor to accepted list', () => {
    promo.suggest('mem_001', 'timeout');
    promo.promote('mem_001', 'timeout');
    const queue = promo.getQueue();
    expect(queue.length).toBe(0);
    expect(promo.getAccepted()).toContain('mem_001:timeout');
  });

  test('reject prevents re-suggestion', () => {
    promo.suggest('mem_001', 'timeout');
    promo.reject('mem_001', 'timeout');
    promo.suggest('mem_001', 'timeout');
    const queue = promo.getQueue();
    expect(queue.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test**

Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
// gateway/src/feedback/anchor-promotion.ts
import * as fs from 'fs';
import * as path from 'path';

const QUEUE_FILE = '.suggested-anchors.json';

export interface Suggestion {
  unitId: string;
  anchor: string;
  ts: number;
}

export class AnchorPromotion {
  private baseDir: string;
  private rejected = new Set<string>();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private queuePath(): string {
    const dir = path.join(this.baseDir, 'memory');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, QUEUE_FILE);
  }

  getQueue(): Suggestion[] {
    const p = this.queuePath();
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }

  private saveQueue(queue: Suggestion[]): void {
    const p = this.queuePath();
    fs.writeFileSync(p, JSON.stringify(queue, null, 2), 'utf-8');
  }

  suggest(unitId: string, anchor: string): void {
    const key = `${unitId}:${anchor}`;
    if (this.rejected.has(key)) return;
    const queue = this.getQueue();
    if (queue.some(s => s.unitId === unitId && s.anchor === anchor)) return;
    queue.push({ unitId, anchor, ts: Date.now() });
    this.saveQueue(queue);
  }

  promote(unitId: string, anchor: string): void {
    const queue = this.getQueue().filter(s => !(s.unitId === unitId && s.anchor === anchor));
    this.saveQueue(queue);
  }

  reject(unitId: string, anchor: string): void {
    this.rejected.add(`${unitId}:${anchor}`);
    this.promote(unitId, anchor); // remove from queue
  }

  getAccepted(): string[] {
    return []; // in-memory for now; in production, would read from frontmatter audit trail
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/feedback/anchor-promotion.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/feedback/anchor-promotion.ts tests/unit/feedback/anchor-promotion.test.ts
git commit -m "feat(v7): add anchor promotion pipeline with reject dedup"
```

---

### Task 6: Deferred Memory — T1 observation lifecycle

**Files:**
- Create: `gateway/src/feedback/deferred-memory.ts`
- Test: `tests/unit/feedback/deferred-memory.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/feedback/deferred-memory.test.ts
import { DeferredMemory } from '../../gateway/src/feedback/deferred-memory';

test('DeferredMemory tracks observation topics', () => {
  const dm = new DeferredMemory();
  const result = dm.recordObservation('debug payment timeout', 'payment');
  expect(result.shouldDistill).toBe(false);
  expect(result.count).toBe(1);
});

test('DeferredMemory triggers distillation at threshold 3', () => {
  const dm = new DeferredMemory();
  dm.recordObservation('debug payment timeout', 'payment');
  dm.recordObservation('fix payment retry', 'payment');
  const result = dm.recordObservation('payment idempotent', 'payment');
  expect(result.shouldDistill).toBe(true);
  expect(result.count).toBe(3);
});
```

- [ ] **Step 2: Run test**

Expected: FAIL

- [ ] **Step 3: Implement**

```typescript
// gateway/src/feedback/deferred-memory.ts

const DISTILL_THRESHOLD = 3;

export interface ObservationResult {
  shouldDistill: boolean;
  count: number;
}

export class DeferredMemory {
  private topicCount = new Map<string, number>();

  recordObservation(observation: string, topic: string): ObservationResult {
    const count = (this.topicCount.get(topic) || 0) + 1;
    this.topicCount.set(topic, count);
    return { shouldDistill: count >= DISTILL_THRESHOLD, count };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/feedback/deferred-memory.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/feedback/deferred-memory.ts tests/unit/feedback/deferred-memory.test.ts
git commit -m "feat(v7): add deferred memory with threshold-based distillation trigger"
```

---

### Task 7: Distiller rewrite — proposition extraction pipeline

**Files:**
- Modify: `src/memory/abstraction-distiller.ts` — replace entire file
- Test: `tests/unit/abstraction-distiller.test.ts` — update

**IMPORTANT: Read the current `abstraction-distiller.ts` first.** The current implementation uses `loadTierUnits`/`saveTierUnits` with memories.json. Replace with:

```typescript
// src/memory/abstraction-distiller.ts — rewritten
// Proposition extraction pipeline:
// 1. Pre-dedup by fingerprint
// 2. Knowledge signal gate
// 3. Proposition extraction (2-4 per cluster)
// 4. Quality gate (5 criteria)
// 5. Incremental merge via abstraction matcher

export function hasKnowledgeSignal(observation: string): string | null {
  const lower = observation.toLowerCase();
  if (lower.includes('error') && (lower.includes('fix') || lower.includes('because'))) return 'pitfall';
  if (lower.includes('config') || lower.includes('set')) return 'procedure';
  if (lower.includes('is') || lower.includes('always') || lower.includes('never')) return 'fact';
  if (lower.includes('decide') || lower.includes('choose') || lower.includes('because')) return 'decision';
  return null;
}

export function extractPropositions(observations: string[]): string[] {
  return observations
    .map(obs => {
      // Extract the "conclusion" part: sentences with actionable knowledge
      const sentences = obs.split(/[。.!?]/).filter(s => s.length > 10);
      return sentences.filter(s => !/用户|agent|然后|最终/i.test(s));
    })
    .flat()
    .slice(0, 4);
}

export function passQualityGate(proposition: string, granularity: string): boolean {
  // 5 criteria:
  if (/用户|agent|然后|最终/i.test(proposition)) return false; // no narrative subject
  if (proposition.length < 15) return false; // must have substantive content
  if (!granularity) return false; // must have granularity
  return true;
}
```

- [ ] **Step 1: Update test file**

```typescript
// Update tests/unit/abstraction-distiller.test.ts
import { hasKnowledgeSignal, extractPropositions, passQualityGate } from '../../src/memory/abstraction-distiller';

test('hasKnowledgeSignal detects pitfall signal', () => {
  expect(hasKnowledgeSignal('Error: timeout because connection pool exhausted')).toBe('pitfall');
});

test('extractPropositions returns statements without narrative subjects', () => {
  const result = extractPropositions(['用户发现支付超时，原因是连接池耗尽']);
  expect(result.every(s => !/用户/.test(s))).toBe(true);
});

test('passQualityGate rejects narrative-style propositions', () => {
  expect(passQualityGate('用户然后点击提交按钮', 'procedure')).toBe(false);
});

test('passQualityGate accepts proper propositions', () => {
  expect(passQualityGate('Payment timeout occurs when connection pool < 5', 'procedure')).toBe(true);
});
```

- [ ] **Step 2: Replace the distiller file**

Read the current file, keep the `runDistillation` export signature, replace internals.

- [ ] **Step 3: Run tests**

Run: `npx jest tests/unit/abstraction-distiller.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/memory/abstraction-distiller.ts tests/unit/abstraction-distiller.test.ts
git commit -m "feat(v7): rewrite distiller as proposition extraction pipeline"
```

---

### Task 8: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All tests passing (pre-existing failures unchanged)

- [ ] **Step 2: Verify gateway build**

Run: `npm run build` in `gateway/`
Expected: No errors
