# MAFW v7 Phase 1: 索引与检索层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Upgrade memory indexing to bigram + abstract-layer-only, split dual log (index log + event log), add IDF-weighted cognitive graph, implement guided iterative retrieval.

**Architecture:** Index becomes a pure-derivative construct rebuilt from OKF `.md` files. Two new `.log` files replace incremental index updates. IDF stats govern anchor noise across graph edges, retrieval rewriting, and hop traversal.

**Tech Stack:** TypeScript, Node.js fs, js-yaml

## Global Constraints

- Index fields: `primary_abstraction` (1.0), `cue_anchors` (0.8), `derived_terms` (0.4, index-only)
- Tokenizer: bigram (character bigram for CJK, word bigram for Latin)
- Index is pure derivative — rebuildable from `.md` files, no data loss if deleted
- Dual log: `index-increment.log` (derivative, discardable) + `.memory-events.log` (fact source)
- IDF: `IDF(anchor) = log(N / n)`, `θ_idf` applied in 3 places (graph edges, rewrite, hop)
- Retrieval budget: max 3 rounds, 2000 tokens, hop decay 1.0/0.9/0.75
- Cognitive graph: explicit edges 1.0, implicit edges `0.5 × (IDF / maxIDF)`
- Hub node: IDF normal but absolute count > 20 → relay hub
- Frontmatter discipline: no `derived_anchors`, `energy_effective_snapshot`, `suggested_anchors` in OKF files

---

### Task 1: Bigram tokenizer + derived terms extractor

**Files:**
- Create: `gateway/src/memory/derived-terms.ts`
- Test: `tests/unit/memory/derived-terms.test.ts`

**Interfaces:**
- Produces: `tokenize(text: string): string[]` — bigram tokens
- Produces: `extractDerivedTerms(text: string): string[]` — title entities + code entities + TF-IDF top 3

- [ ] **Step 1: Write failing test for tokenize**

```typescript
// tests/unit/memory/derived-terms.test.ts
import { tokenize, extractDerivedTerms } from '../../gateway/src/memory/derived-terms';

test('tokenize handles CJK bigrams', () => {
  const result = tokenize('创建支付订单');
  expect(result).toContain('创建');
  expect(result).toContain('建支');
  expect(result).toContain('支付');
  expect(result).toContain('付订');
  expect(result).toContain('订单');
});

test('tokenize handles Latin bigrams', () => {
  const result = tokenize('payment order');
  expect(result).toContain('payment');
  expect(result).toContain('t ord');
  expect(result).toContain('order');
});

test('tokenize mixed CJK/Latin', () => {
  const result = tokenize('createPayment 创建支付');
  expect(result.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/derived-terms.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tokenize**

```typescript
// gateway/src/memory/derived-terms.ts

export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    // CJK character range
    if (/[\u4e00-\u9fff]/.test(text[i])) {
      // CJK: character bigram
      if (i + 1 < text.length && /[\u4e00-\u9fff]/.test(text[i + 1])) {
        tokens.push(text[i] + text[i + 1]);
      } else {
        tokens.push(text[i]);
      }
      i++;
    } else if (/[a-zA-Z0-9]/.test(text[i])) {
      // Latin/alphanumeric: word-based bigram
      let word = '';
      while (i < text.length && /[a-zA-Z0-9]/.test(text[i])) {
        word += text[i];
        i++;
      }
      if (word.length > 0) tokens.push(word.toLowerCase());
      if (word.length > 1) {
        // Add word bigrams within compound words
        for (let j = 0; j < word.length - 1; j++) {
          tokens.push(word.slice(j, j + 2).toLowerCase());
        }
      }
    } else {
      i++;
    }
  }
  return [...new Set(tokens)];
}

export function extractDerivedTerms(text: string, topK = 3): string[] {
  const terms: string[] = [];
  // Extract [[linked]] references from body
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    terms.push(match[1]);
  }
  // Extract code-style entities: CamelCase, snake_case
  const entityRegex = /[A-Z][a-z]+[A-Z][a-z]+|[a-z]+_[a-z]+/g;
  while ((match = entityRegex.exec(text)) !== null) {
    terms.push(match[0]);
  }
  return [...new Set(terms)].slice(0, topK);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/memory/derived-terms.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/derived-terms.ts tests/unit/memory/derived-terms.test.ts
git commit -m "feat(v7): add bigram tokenizer and derived terms extractor"
```

---

### Task 2: IDF stats calculator

**Files:**
- Create: `gateway/src/retrieval/idf-stats.ts`
- Test: `tests/unit/retrieval/idf-stats.test.ts`

**Interfaces:**
- Consumes: `tokenize(text): string[]`
- Produces: `class IDFStats { addDocument(terms): void; idf(term): number; getThresholdIdf(): number; isNoisy(term): boolean }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/retrieval/idf-stats.test.ts
import { IDFStats } from '../../gateway/src/retrieval/idf-stats';

test('IDFStats computes correct IDF values', () => {
  const stats = new IDFStats();
  stats.addDocument(['payment', 'create']);
  stats.addDocument(['payment', 'refund']);
  stats.addDocument(['order']);
  // N=3: idf(payment)=log(3/2)≈0.405, idf(create)=log(3/1)≈1.099, idf(order)=log(3/1)≈1.099
  expect(stats.idf('payment')).toBeCloseTo(0.405, 2);
  expect(stats.idf('create')).toBeCloseTo(1.099, 2);
});

test('isNoisy returns true for IDF below threshold', () => {
  const stats = new IDFStats(0.5); // θ_idf = 0.5
  stats.addDocument(['common', 'common', 'common']); // N=1, n=1 → IDF=0
  stats.addDocument(['rare']);
  expect(stats.isNoisy('common')).toBe(true);
  expect(stats.isNoisy('rare')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/retrieval/idf-stats.test.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IDFStats**

```typescript
// gateway/src/retrieval/idf-stats.ts

export class IDFStats {
  private df = new Map<string, number>(); // document frequency
  private n = 0; // total documents
  private threshold: number;

  constructor(threshold = 0.5) {
    this.threshold = threshold;
  }

  addDocument(terms: string[]): void {
    this.n++;
    const unique = new Set(terms);
    for (const term of unique) {
      this.df.set(term, (this.df.get(term) || 0) + 1);
    }
  }

  idf(term: string): number {
    const freq = this.df.get(term) || 0;
    if (freq === 0) return 0;
    return Math.log(this.n / freq);
  }

  getThresholdIdf(): number {
    return this.threshold;
  }

  isNoisy(term: string): boolean {
    return this.idf(term) < this.threshold;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/retrieval/idf-stats.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/retrieval/idf-stats.ts tests/unit/retrieval/idf-stats.test.ts
git commit -m "feat(v7): add IDF stats calculator for anchor noise gating"
```

---

### Task 3: Dual log — event log and index increment log

**Files:**
- Create: `gateway/src/memory/event-log.ts`
- Test: `tests/unit/memory/event-log.test.ts`

**Interfaces:**
- Produces: `class EventLog { appendWrite(entry); appendArchive(id); appendMiss(query, cause); readAll(); rotate() }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/memory/event-log.test.ts
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { EventLog } from '../../gateway/src/memory/event-log';

describe('EventLog', () => {
  let tmpDir: string;
  let log: EventLog;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'el-'));
    log = new EventLog(tmpDir);
  });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('appendWrite and readAll', () => {
    log.appendWrite('mem_001', { primary: 'test', anchors: ['a'], terms: ['b'] });
    const all = log.readAll();
    expect(all.length).toBe(1);
    expect(all[0].op).toBe('write');
    expect(all[0].id).toBe('mem_001');
  });

  test('appendMiss', () => {
    log.appendMiss('payment timeout', 'anchor_poor');
    const all = log.readAll();
    expect(all.length).toBe(1);
    expect(all[0].op).toBe('miss');
    expect(all[0].miss_cause).toBe('anchor_poor');
  });

  test('appendArchive', () => {
    log.appendArchive('mem_001');
    const all = log.readAll();
    expect(all[0].op).toBe('archive');
  });

  test('tolerates corrupt lines', () => {
    const logDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, '.memory-events.log'), 'not json\n{"op":"write","id":"m1"}\n', 'utf-8');
    const all = log.readAll();
    expect(all.length).toBe(1);
    expect(all[0].id).toBe('m1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/event-log.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement EventLog**

```typescript
// gateway/src/memory/event-log.ts
import * as fs from 'fs';
import * as path from 'path';

const EVENT_LOG = '.memory-events.log';

export interface LogEntry {
  op: 'write' | 'archive' | 'rename' | 'access' | 'miss';
  id?: string;
  query?: string;
  miss_cause?: string;
  entry?: any;
  score?: number;
  round?: number;
  ts: number;
}

export class EventLog {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private logFile(): string {
    const dir = path.join(this.baseDir, 'memory');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, EVENT_LOG);
  }

  private append(entry: LogEntry): void {
    entry.ts = Date.now();
    fs.appendFileSync(this.logFile(), JSON.stringify(entry) + '\n', 'utf-8');
  }

  appendWrite(id: string, entryData: any): void {
    this.append({ op: 'write', id, entry: entryData });
  }

  appendArchive(id: string): void {
    this.append({ op: 'archive', id });
  }

  appendMiss(query: string, cause: string): void {
    this.append({ op: 'miss', query, miss_cause: cause });
  }

  appendAccess(id: string, round: number, score: number): void {
    this.append({ op: 'access', id, round, score });
  }

  readAll(): LogEntry[] {
    const filePath = this.logFile();
    if (!fs.existsSync(filePath)) return [];
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip corrupt lines
      }
    }
    return entries;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/memory/event-log.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/event-log.ts tests/unit/memory/event-log.test.ts
git commit -m "feat(v7): add dual event log with corrupt-line tolerance"
```

---

### Task 4: Anchor graph — IDF-weighted dual-track edges

**Files:**
- Create: `gateway/src/graph/anchor-graph.ts`
- Test: `tests/unit/graph/anchor-graph.test.ts`

**Interfaces:**
- Consumes: `IDFStats`, `CognitiveGraphManager` (existing)
- Produces: `class AnchorGraph { buildEdge(cognitiveGraph, idfStats): void; getNeighbors(id, explicitOnly?) }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/graph/anchor-graph.test.ts
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AnchorGraph } from '../../gateway/src/graph/anchor-graph';
import { IDFStats } from '../../gateway/src/retrieval/idf-stats';

test('AnchorGraph builds implicit edges from shared anchors', () => {
  const graph = new AnchorGraph();
  const idf = new IDFStats(0.5);
  idf.addDocument(['payment', 'create']);
  idf.addDocument(['payment', 'refund']);
  idf.addDocument(['order']);

  graph.addUnit('mem_001', ['payment', 'create']);
  graph.addUnit('mem_002', ['payment', 'refund']);

  graph.buildImplicitEdges(idf);
  const neighbors = graph.getNeighbors('mem_001');
  // mem_001 and mem_002 share "payment"
  expect(neighbors).toContain('mem_002');
});

test('AnchorGraph skips noisy anchors for implicit edges', () => {
  const graph = new AnchorGraph();
  const idf = new IDFStats(0.5);
  idf.addDocument(['common']);
  idf.addDocument(['common']);

  graph.addUnit('mem_001', ['common']);
  graph.addUnit('mem_002', ['common']);
  graph.buildImplicitEdges(idf);
  const neighbors = graph.getNeighbors('mem_001');
  // "common" IDF < 0.5 → no implicit edge
  expect(neighbors).not.toContain('mem_002');
});

test('AnchorGraph detects hub nodes', () => {
  const graph = new AnchorGraph(3); // hub threshold = 3
  for (let i = 0; i < 5; i++) {
    graph.addUnit(`mem_${i}`, ['shared_anchor']);
  }
  expect(graph.isHubNode('shared_anchor')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/graph/anchor-graph.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement AnchorGraph**

```typescript
// gateway/src/graph/anchor-graph.ts
import { IDFStats } from '../retrieval/idf-stats';

export class AnchorGraph {
  private anchorIndex = new Map<string, Set<string>>(); // anchor → set of unit IDs
  private hubThreshold: number;

  constructor(hubThreshold = 20) {
    this.hubThreshold = hubThreshold;
  }

  addUnit(id: string, anchors: string[]): void {
    for (const anchor of anchors) {
      if (!this.anchorIndex.has(anchor)) {
        this.anchorIndex.set(anchor, new Set());
      }
      this.anchorIndex.get(anchor)!.add(id);
    }
  }

  buildImplicitEdges(idfStats: IDFStats): Map<string, Set<string>> {
    const edges = new Map<string, Set<string>>();
    for (const [anchor, ids] of this.anchorIndex) {
      if (idfStats.isNoisy(anchor)) continue;
      if (ids.size > this.hubThreshold) continue; // hub node — skip pair-wise edges
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          if (!edges.has(a)) edges.set(a, new Set());
          edges.get(a)!.add(b);
          if (!edges.has(b)) edges.set(b, new Set());
          edges.get(b)!.add(a);
        }
      }
    }
    return edges;
  }

  isHubNode(anchor: string): boolean {
    const ids = this.anchorIndex.get(anchor);
    return ids !== undefined && ids.size >= this.hubThreshold;
  }

  getNeighbors(id: string, implicitEdges: Map<string, Set<string>>): string[] {
    return [...(implicitEdges.get(id) || [])];
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/graph/anchor-graph.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/graph/anchor-graph.ts tests/unit/graph/anchor-graph.test.ts
git commit -m "feat(v7): add IDF-weighted anchor graph with hub detection"
```

---

### Task 5: Write queue — single-writer serialization

**Files:**
- Create: `gateway/src/memory/write-queue.ts`
- Test: `tests/unit/memory/write-queue.test.ts`

**Interfaces:**
- Produces: `class WriteQueue { enqueue(fn): Promise<void>; async write(unit, store): Promise<string> }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/memory/write-queue.test.ts
import { WriteQueue } from '../../gateway/src/memory/write-queue';

test('WriteQueue serializes concurrent writes', async () => {
  const q = new WriteQueue();
  const order: number[] = [];
  const p1 = q.enqueue(async () => { await new Promise(r => setTimeout(r, 10)); order.push(1); });
  const p2 = q.enqueue(async () => { order.push(2); });
  await Promise.all([p1, p2]);
  expect(order).toEqual([1, 2]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/memory/write-queue.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement WriteQueue**

```typescript
// gateway/src/memory/write-queue.ts

type AsyncFn = () => Promise<void>;

export class WriteQueue {
  private queue: AsyncFn[] = [];
  private processing = false;

  async enqueue(fn: AsyncFn): Promise<void> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try { await fn(); resolve(); } catch (e) { reject(e); }
      });
      if (!this.processing) this.process();
    });
  }

  private async process(): Promise<void> {
    this.processing = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
    }
    this.processing = false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/memory/write-queue.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/write-queue.ts tests/unit/memory/write-queue.test.ts
git commit -m "feat(v7): add serialized write queue"
```

---

### Task 6: Update HarmonicUnitFileStore — integrate event log, write queue, derived terms

**Files:**
- Modify: `gateway/src/memory/harmonic-file-store.ts`

**Interfaces:**
- Consumes: `EventLog`, `WriteQueue`, `extractDerivedTerms`, `AnchorGraph`
- The write method now: 1) extracts derived terms (index-only, NOT to frontmatter), 2) logs via event log, 3) serialized via write queue

- [ ] **Step 1: Modify harmonic-file-store.ts**

Read the current file first. The key changes are in `write()`:

```typescript
// In write(), add after writing the .md file:
// 1. Extract derived terms
const derivedTerms = extractDerivedTerms(unit.memory_value);

// 2. Add to anchor graph for implicit edge computation
this.anchorGraph.addUnit(unit.id, unit.cue_anchors);

// 3. Log via event log (instead of direct index update)
this.eventLog.appendWrite(unit.id, {
  primary: unit.primary_abstraction,
  anchors: unit.cue_anchors,
  terms: tokenize(unit.primary_abstraction + ' ' + unit.cue_anchors.join(' ')),
  derived: derivedTerms,
});

// 4. Write via queue
const writeFn = async () => {
  // existing file write logic
};
return this.writeQueue.enqueue(writeFn);
```

Add these imports and new private fields to the class:

```typescript
import { EventLog } from './event-log';
import { WriteQueue } from './write-queue';
import { AnchorGraph } from '../graph/anchor-graph';
import { tokenize, extractDerivedTerms } from './derived-terms';

// New private fields:
private eventLog: EventLog;
private writeQueue: WriteQueue;
private anchorGraph: AnchorGraph;
```

Initialize in constructor:
```typescript
this.eventLog = new EventLog(baseDir);
this.writeQueue = new WriteQueue();
this.anchorGraph = new AnchorGraph();
```

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `npx jest tests/unit/memory/harmonic-file-store.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add gateway/src/memory/harmonic-file-store.ts
git commit -m "feat(v7): integrate event log, write queue, derived terms into FileStore"
```

---

### Task 7: Guided iterative retriever

**Files:**
- Create: `gateway/src/retrieval/guided-retriever.ts`
- Test: `tests/unit/retrieval/guided-retriever.test.ts`

**Interfaces:**
- Consumes: `HarmonicIndexManager`, `AnchorGraph`, `IDFStats`
- Produces: `class GuidedRetriever { search(query, options?): SearchResult[] }`

- [ ] **Step 1: Write failing test**

```typescript
// tests/unit/retrieval/guided-retriever.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { GuidedRetriever } from '../../gateway/src/retrieval/guided-retriever';

describe('GuidedRetriever', () => {
  let tmpDir: string;
  let indexManager: HarmonicIndexManager;
  let retriever: GuidedRetriever;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    indexManager = new HarmonicIndexManager(tmpDir);
    // Add some test entries
    indexManager.addEntry({ id: 'm1', type: 'semantic', primary_abstraction: 'payment create order', cue_anchors: ['payment', 'create'], tier: 'knowledge', energy: 0.8 } as any, 'knowledge');
    indexManager.addEntry({ id: 'm2', type: 'semantic', primary_abstraction: 'refund process', cue_anchors: ['refund', 'payment'], tier: 'knowledge', energy: 0.6 } as any, 'knowledge');
    retriever = new GuidedRetriever(indexManager);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('search returns results for query', async () => {
    const results = await retriever.search('payment');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('m1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/retrieval/guided-retriever.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement GuidedRetriever**

```typescript
// gateway/src/retrieval/guided-retriever.ts
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { IDFStats } from './idf-stats';
import { tokenize } from '../memory/derived-terms';

export interface SearchOptions {
  policy?: 'oneshot' | 'guided';
  budgetTokens?: number;
  maxRounds?: number;
  scope?: 'project' | 'global' | 'both';
}

export interface SearchResult {
  id: string;
  primary_abstraction: string;
  score: number;
  round: number;
  hopDecay: number;
}

const HOP_DECAY = [1.0, 0.9, 0.75];

export class GuidedRetriever {
  private indexManager: HarmonicIndexManager;

  constructor(indexManager: HarmonicIndexManager) {
    this.indexManager = indexManager;
  }

  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const policy = options.policy || 'guided';
    const maxRounds = options.maxRounds || 3;
    const results: SearchResult[] = [];
    const index = this.indexManager.getIndex();

    if (policy === 'oneshot') {
      // Simple BM25-style scoring over abstraction + anchors
      return this.bm25Search(query, index.entries, 1, 1.0).slice(0, 10);
    }

    // Guided: iterative rounds
    let currentQuery = query;
    for (let round = 0; round < maxRounds; round++) {
      const queryTokens = tokenize(currentQuery);
      const roundResults = this.bm25Search(currentQuery, index.entries, round, HOP_DECAY[round]);
      results.push(...roundResults);

      // Check saturation: top score ≥ 0.8 or ≥ 3 results with low variance → stop
      if (roundResults.length > 0 && roundResults[0].score >= 0.8) break;
      if (roundResults.length >= 3) {
        const scores = roundResults.map(r => r.score);
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;
        if (variance < 0.05) break;
      }

      // Query expansion: use top-2 result's anchors as next query
      if (roundResults.length > 0) {
        const topEntry = index.entries.find(e => e.id === roundResults[0].id);
        if (topEntry) {
          currentQuery = query + ' ' + topEntry.cue_anchors.slice(0, 3).join(' ');
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, 10);
  }

  private bm25Search(query: string, entries: any[], round: number, hopDecay: number): SearchResult[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    return entries.map((entry: any) => {
      const text = `${entry.primary_abstraction} ${entry.cue_anchors?.join(' ') || ''}`;
      const docTokens = tokenize(text);
      let score = 0;
      for (const qt of queryTokens) {
        for (const dt of docTokens) {
          // Bigram match: exact or partial
          if (dt === qt || dt.includes(qt) || qt.includes(dt)) {
            score += qt.length / queryTokens.length;
          }
        }
      }
      // Apply field weights: abstraction 1.0, anchors 0.8
      const inAbstraction = tokenize(entry.primary_abstraction || '').some((t: string) => queryTokens.some((qt: string) => t === qt));
      const weight = inAbstraction ? 1.0 : 0.8;
      score *= weight;
      // Apply energy
      const energyEffective = entry.energy || 0.5;
      score = score * (0.5 + 0.5 * energyEffective) * hopDecay;
      return { id: entry.id, primary_abstraction: entry.primary_abstraction, score, round, hopDecay };
    }).filter(r => r.score > 0).sort((a, b) => b.score - a.score);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/retrieval/guided-retriever.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/retrieval/guided-retriever.ts tests/unit/retrieval/guided-retriever.test.ts
git commit -m "feat(v7): add guided iterative retriever with hop decay"
```

---

### Task 8: Update `mafw_search_hybrid` to support guided policy

**Files:**
- Modify: `src/mcp/tools.ts` — `mafw_search_hybrid` handler

**Interfaces:**
- Consumes: `GuidedRetriever`
- Adds: `policy` parameter to `mafw_search_hybrid`

- [ ] **Step 1: Modify the search handler**

In `src/mcp/tools.ts`, find the `mafw_search_hybrid` handler. Add `policy` parameter support:

```typescript
mafw_search_hybrid: async (args) => {
  try {
    const query = args.query as string;
    const topK = (args.topK as number) || 20;
    const policy = (args.policy as string) || 'guided';

    const { HarmonicIndexManager } = await import('../memory/harmonic-index.js');
    const { GuidedRetriever } = await import('../../gateway/src/retrieval/guided-retriever.js');
    const index = new HarmonicIndexManager(projectDir);
    const retriever = new GuidedRetriever(index);

    let results: any[];
    if (policy === 'guided') {
      results = await retriever.search(query, { policy: 'guided', maxRounds: 3 });
    } else {
      // Fall back to existing hybrid search (BM25 + RRF)
      const { BM25Index } = await import('../compression/bm25-index.js');
      const { reciprocalRankFusion } = await import('../compression/rrf-fusion.js');
      const allEntries = index.getIndex().entries;
      const bm25 = new BM25Index();
      for (const entry of allEntries) {
        bm25.addDocument(entry.id, `${entry.primary_abstraction} ${entry.cue_anchors.join(' ')}`);
      }
      const tokenResults = index.search(query, topK * 3);
      const bm25Results = bm25.search(query, topK * 3);
      const tokenRRF = tokenResults.map((r: any, i: number) => ({ id: r.id, score: 0 }));
      const bm25RRF = bm25Results.map(r => ({ id: r.id, score: 0 }));
      const fused = reciprocalRankFusion(60, tokenRRF, bm25RRF);
      results = fused.slice(0, topK);
    }

    if (args.memoryType) {
      const allEntries = index.getIndex().entries;
      const idToEntry = new Map(allEntries.map((e: any) => [e.id, e]));
      results = results.filter((r: any) => idToEntry.get(r.id)?.type === args.memoryType);
    }

    return { content: [{ type: 'text', text: JSON.stringify({ results, count: results.length }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }], isError: true };
  }
},
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/unit/mcp/tools.test.ts --no-coverage`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/mcp/tools.ts
git commit -m "feat(v7): add guided policy to mafw_search_hybrid"
```

---

### Task 9: Wire all new components into gateway startup

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts` — add `policy` parameter schema to `mafw_search_hybrid`

- [ ] **Step 1: Update tool schema**

In `gateway/src/mcp/tool-registry.ts`, modify the `mafw_search_hybrid` definition to add `policy`:

```typescript
{
  name: "mafw_search_hybrid",
  description: "Search memory units using guided iterative retrieval or BM25 hybrid",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text" },
      topK: { type: "number", description: "Maximum results", default: 20 },
      memoryType: { type: "string", enum: ["episodic", "semantic", "procedural", "global"], description: "Optional filter" },
      policy: { type: "string", enum: ["guided", "oneshot"], default: "guided", description: "Retrieval strategy" },
    },
    required: ["query"],
  },
},
```

- [ ] **Step 2: Build and verify**

Run: `npm run build` in `gateway/`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add gateway/src/mcp/tool-registry.ts
git commit -m "feat(v7): add policy parameter to search tool schema"
```

---

### Task 10: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx jest --no-coverage`
Expected: All pre-existing tests passing, all new tests passing

- [ ] **Step 2: Verify gateway build**

Run: `npm run build` in `gateway/`
Expected: No errors
