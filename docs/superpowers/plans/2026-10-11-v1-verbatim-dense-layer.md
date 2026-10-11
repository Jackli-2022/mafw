# V1 Verbatim Dense Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 t1_archive（51616 轮 verbatim）变成 dense 可检索层——写时 fire-and-forget 嵌入、快照路径融合 #t1 命中、指针兑现、provenance 修复（用户定案：H 层检索直接上 dense；边界路径不动）。

**Architecture:** 复用现有 EmbeddingRuntime 基建加第二条 t1 向量通道（`vectors-t1-<model>.json`，独立 MemoryVectorStore + EmbeddingIndexer）；obs capture 写时嵌入（key=`session:turn:contentHash`，跨 obs→archive 迁移稳定）；R8 快照构建（后台，无 100ms 约束）注入 `searchT1` dep 融合 verbatim 行；`mafw_get_memory` 支持 `t1:<tail>:<turn>` 指针；worker-origin 注册表修复管线记忆的 source_session_id。

**Tech Stack:** TypeScript (gateway)、jest、better-sqlite3、既有 EmbeddingRuntime（ONNX/dashscope provider 不动）。

**设计依据：** `docs/research/2026-10-10-memory-target-architecture.md` §4 V1 行；`docs/research/2026-10-10-hippocampal-layer-redesign-survey.md`（dense 定案 + V1 决策点 4）。

## Global Constraints

- TDD：每 Task 先红后绿；测试 import 路径用 `../../../src/`。
- **jest 不 typecheck `gateway/src/index.ts`**——凡改 index.ts 的 Task 完成后必须跑 root `npm run build`（exit 0）。
- 中文内容只经 write/edit 工具落盘（不走 PowerShell 管道）。
- commit 用 repo 根相对路径 `git add gateway/src/... gateway/tests/...`。
- 全量门禁：`cd gateway && npx jest --runInBand`（基线 **1902**，以实际首跑为准）。
- **fail-open 铁律**：所有新代码不得阻塞 `/api/obs/capture` 响应或边界 recall 100ms 契约——嵌入/检索全部 try/catch 吞错降级。
- 边界实时路径（`/api/recall/context` 的 BM25 回退）**一行不动**；t1 融合只发生在后台 `buildSnapshot`。
- 不新增 cron 规则、不新增 LLM 调用（零新 LLM 成本）。

---

## 现状代码事实（实施者必读）

| 事实 | 位置 |
|---|---|
| `MemoryVectorStore(filePath, dims, model)`：通用 id→vector，`upsert/get/remove/size/ids/flush/searchByCosine(query, topK)`，JSON 原子持久化 | `gateway/src/memory/vector-store.ts:19` |
| `EmbeddingIndexer({vectors, provider, getTextForId})`：私有 queue + `flushQueue()`（batchSize 16、重入护栏）、`backfill(ids)` | `vector-store.ts:126` |
| `initEmbeddingRuntime({baseDir, getTextForId, cfg})` → `EmbeddingRuntime{provider, vectors, indexer, scheduleFlush()}`；`getEmbeddingRuntime()` | `gateway/src/memory/embedding-runtime.ts:43` |
| obs capture 路由：`append()` 在 `index.ts:6128`，变量 `sessionID/turnId/redacted` 可用 | `index.ts:6083-6159` |
| R8 快照：`buildSnapshot(deps, sessionID, cfg, topK)`，`SnapshotDeps{recentTurnTexts, search, verify, render, store}` | `gateway/src/recall/snapshot-builder.ts:15` |
| 快照接线点：`refreshSnapshotInner` 的 deps 字面量（`search:` 在 `index.ts:1827`） | `index.ts:1804-1850` |
| t1 DB 方法：`readArchiveTurn(sid, tid)`、`readTurn(sid, tid)`（observations）、`listArchiveTurns()`、`archiveCount()` | `gateway/src/memory/gateway-db.ts:422/379/429/446` |
| `/api/memory/add` 设 `source_session_id: data?.sessionID`（worker 写入时=worker 会话 → 回源 no-op，本计划修） | `index.ts:6994` |
| worker 池：`SessionWorkerPool.getWorker(sessionID, kind)` 创建 pair，`onSessionCreated` 回调在创建处包装 | `gateway/src/recall/session-worker-pool.ts:53-93` |
| `hashText(s)` FNV-1a 8-hex 已导出 | `gateway/src/recall/index-scan.ts:90` |
| `handleGetMemory` 签名 `(args, { memory, mafwDir, searchArchive })` | `gateway/src/mcp/handlers/get-memory.ts:12` |

**t1 向量 key 设计**：`${sessionId}:${turnId}:${hashText(content)}`——content hash 使 key 跨 obs→archive 迁移稳定（两表 id 不同），同内容同 key 自然幂等去重。

---

### Task 1: verbatim-recall 纯模块

**Files:**
- Create: `gateway/src/recall/verbatim-recall.ts`
- Test: `gateway/tests/unit/recall/verbatim-recall.test.ts`

**Interfaces:**
- Consumes: `hashText`（`./index-scan` 导出）。
- Produces（后续 Task 依赖的确切签名）:
  - `t1VectorKey(sessionId: string, turnId: number, content: string): string`
  - `parseT1Key(key: string): { sessionId: string; turnId: number } | null`
  - `groupT1HitsToTurns(hits: Array<{ id: string; cosine: number }>, cap?: number): Array<{ sessionId: string; turnId: number; cosine: number }>`
  - `excerptFromRows(rows: T1Row[], key: string, maxChars: number): string`
  - `renderT1Lines(hits: T1Hit[], opts: { k: number; maxChars: number }): string`
  - `interface T1Hit { sessionId: string; turnId: number; cosine: number; excerpt: string }`
  - `interface T1Row { session_id: string; turn_id: number; source: string; content: string }`
  - 指针格式：行内 `[t1|<sessionId尾6>:<turnId>]`；`mafw_get_memory` 兑现 id 为 `t1:<尾6>:<turnId>`

- [ ] **Step 1: 写失败测试**

```typescript
import {
  t1VectorKey, parseT1Key, groupT1HitsToTurns, excerptFromRows, renderT1Lines, T1Hit,
} from '../../../src/recall/verbatim-recall';

const row = (s: string, t: number, src: string, c: string) => ({ session_id: s, turn_id: t, source: src, content: c });

describe('t1VectorKey / parseT1Key', () => {
  test('roundtrip: parse recovers session and turn', () => {
    const key = t1VectorKey('ses_abc123', 42, 'hello world');
    expect(key.startsWith('ses_abc123:42:')).toBe(true);
    expect(parseT1Key(key)).toEqual({ sessionId: 'ses_abc123', turnId: 42 });
  });
  test('same content → same key (idempotent); different content → different key', () => {
    expect(t1VectorKey('s', 1, 'x')).toBe(t1VectorKey('s', 1, 'x'));
    expect(t1VectorKey('s', 1, 'x')).not.toBe(t1VectorKey('s', 1, 'y'));
  });
  test('garbage key → null', () => {
    expect(parseT1Key('no-colons')).toBeNull();
    expect(parseT1Key('a:b')).toBeNull();
    expect(parseT1Key('a:x:1')).toBeNull();
  });
});

describe('groupT1HitsToTurns', () => {
  test('dedupes rows of the same turn keeping max cosine, sorts desc, caps', () => {
    const k = (s: string, t: number, c: string) => t1VectorKey(s, t, c);
    const hits = [
      { id: k('s1', 1, 'a'), cosine: 0.9 },
      { id: k('s1', 1, 'b'), cosine: 0.5 },   // same turn → suppressed
      { id: k('s1', 2, 'c'), cosine: 0.7 },
      { id: k('s2', 1, 'd'), cosine: 0.8 },
      { id: 'garbage', cosine: 0.99 },          // unparseable → dropped
    ];
    const out = groupT1HitsToTurns(hits, 2);
    expect(out).toEqual([
      { sessionId: 's1', turnId: 1, cosine: 0.9 },
      { sessionId: 's2', turnId: 1, cosine: 0.8 },
    ]);
  });
  test('empty → empty', () => {
    expect(groupT1HitsToTurns([])).toEqual([]);
  });
});

describe('excerptFromRows', () => {
  test('finds the row whose content hash matches the key', () => {
    const rows = [row('s', 1, 'user_input', 'first'), row('s', 1, 'tool_result', 'the matched one')];
    const key = t1VectorKey('s', 1, 'the matched one');
    expect(excerptFromRows(rows, key, 100)).toBe('the matched one');
  });
  test('falls back to first row, truncates to maxChars', () => {
    const rows = [row('s', 1, 'user_input', 'x'.repeat(500))];
    expect(excerptFromRows(rows, 'unmatched:key:0000', 10)).toBe('x'.repeat(10));
  });
  test('no rows → empty string', () => {
    expect(excerptFromRows([], 'k', 10)).toBe('');
  });
});

describe('renderT1Lines', () => {
  const hit = (s: string, t: number, ex: string): T1Hit => ({ sessionId: s, turnId: t, cosine: 0.8, excerpt: ex });
  test('renders pointer lines with tail-6 session id and budget cap', () => {
    const lines = renderT1Lines([hit('ses_PROVIDER123456', 7, 'hello verbatim')], { k: 3, maxChars: 600 });
    expect(lines).toContain('[t1|123456:7]');
    expect(lines).toContain('hello verbatim');
  });
  test('respects total maxChars budget — drops lines that overflow', () => {
    const hits = [hit('s1', 1, 'a'.repeat(300)), hit('s2', 2, 'b'.repeat(300)), hit('s3', 3, 'c'.repeat(300))];
    const lines = renderT1Lines(hits, { k: 3, maxChars: 500 });
    expect(lines.length).toBeLessThanOrEqual(500);
    expect(lines).toContain('a'.repeat(200)); // first line kept (truncated)
  });
  test('empty hits → empty string', () => {
    expect(renderT1Lines([], { k: 3, maxChars: 600 })).toBe('');
  });
});
```

- [ ] **Step 2: 跑红**

Run: `cd gateway; npx jest tests/unit/recall/verbatim-recall.test.ts 2>&1 | Select-Object -Last 5`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```typescript
// V1 verbatim dense layer: pure helpers for t1 vector keys, hit grouping,
// excerpt extraction and pointer-line rendering. Zero I/O — the side-effecting
// search factory lives here too (Task 6) but everything in this file is
// fail-open and dependency-injected.
import { hashText } from './index-scan';

export interface T1Row { session_id: string; turn_id: number; source: string; content: string }
export interface T1Hit { sessionId: string; turnId: number; cosine: number; excerpt: string }

export function t1VectorKey(sessionId: string, turnId: number, content: string): string {
  return `${sessionId}:${turnId}:${hashText(content)}`;
}

export function parseT1Key(key: string): { sessionId: string; turnId: number } | null {
  const parts = key.split(':');
  if (parts.length !== 3) return null;
  const turnId = Number(parts[1]);
  if (!Number.isInteger(turnId) || turnId < 0 || !parts[0] || !parts[2]) return null;
  return { sessionId: parts[0], turnId };
}

export function groupT1HitsToTurns(
  hits: Array<{ id: string; cosine: number }>,
  cap = 5,
): Array<{ sessionId: string; turnId: number; cosine: number }> {
  const best = new Map<string, { sessionId: string; turnId: number; cosine: number }>();
  for (const h of hits) {
    const parsed = parseT1Key(h.id);
    if (!parsed) continue;
    const k = `${parsed.sessionId}:${parsed.turnId}`;
    const prev = best.get(k);
    if (!prev || h.cosine > prev.cosine) {
      best.set(k, { sessionId: parsed.sessionId, turnId: parsed.turnId, cosine: h.cosine });
    }
  }
  return [...best.values()].sort((a, b) => b.cosine - a.cosine).slice(0, cap);
}

export function excerptFromRows(rows: T1Row[], key: string, maxChars: number): string {
  if (!rows.length) return '';
  const parsed = parseT1Key(key);
  const match = parsed
    ? rows.find(r => r.session_id === parsed.sessionId && r.turn_id === parsed.turnId && t1VectorKey(r.session_id, r.turn_id, r.content) === key)
    : undefined;
  const text = (match ?? rows[0]).content || '';
  return text.slice(0, maxChars);
}

export function renderT1Lines(hits: T1Hit[], opts: { k: number; maxChars: number }): string {
  const lines: string[] = [];
  let used = 0;
  for (const h of hits.slice(0, opts.k)) {
    if (!h.excerpt) continue;
    const tail = h.sessionId.slice(-6);
    const text = `[t1|${tail}:${h.turnId}] ${h.excerpt.replace(/\s+/g, ' ').trim()}`;
    const remaining = opts.maxChars - used;
    if (remaining <= 0) break;
    const line = text.length > remaining ? `${text.slice(0, Math.max(0, remaining - 1))}…` : text;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: 跑绿** → 同 Step 2 命令，11 例 PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/verbatim-recall.ts gateway/tests/unit/recall/verbatim-recall.test.ts
git commit -m "feat: verbatim-recall pure helpers (t1 keys, grouping, pointer rendering)"
```

---

### Task 2: EmbeddingIndexer.enqueueText（通用入队）

**Files:**
- Modify: `gateway/src/memory/vector-store.ts`（EmbeddingIndexer 类）
- Test: `gateway/tests/unit/memory/embedding-indexer-enqueue.test.ts`

**Interfaces:**
- Produces: `EmbeddingIndexer.enqueueText(id: string, text: string): void` —— t1 通道直接以原文入队（不走 harmonic 的 documentText 抽象域）。

- [ ] **Step 1: 写失败测试**

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EmbeddingIndexer, MemoryVectorStore } from '../../../src/memory/vector-store';

class FakeProvider {
  name = 'fake-embed';
  dims = 4;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => [t.length, 1, 0, 0]);
  }
}

describe('EmbeddingIndexer.enqueueText', () => {
  test('enqueues raw text (not documentText), flushes into the vector store', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-enq-'));
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 4, 'fake');
    const indexer = new EmbeddingIndexer({ vectors: vectors as any, provider: new FakeProvider() as any });
    indexer.enqueueText('k1', 'raw verbatim content');
    const r = await indexer.flushQueue();
    expect(r.indexed).toBe(1);
    expect(vectors.get('k1')).toEqual([19, 1, 0, 0]); // 'raw verbatim content'.length === 19
  });
  test('overwrites same id (idempotent upsert)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idx-enq2-'));
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 4, 'fake');
    const indexer = new EmbeddingIndexer({ vectors: vectors as any, provider: new FakeProvider() as any });
    indexer.enqueueText('k1', 'a');
    indexer.enqueueText('k1', 'longer text');
    await indexer.flushQueue();
    expect(vectors.get('k1')).toEqual([11, 1, 0, 0]);
  });
});
```

- [ ] **Step 2: 跑红** → FAIL（enqueueText 不存在）

- [ ] **Step 3: 实现**（`vector-store.ts` 的 `EmbeddingIndexer` 类内，`onUnitWritten` 方法后加）：

```typescript
  /** Generic raw-text enqueue (t1 verbatim channel): bypasses the harmonic
   *  documentText domain — the caller owns what gets embedded. */
  enqueueText(id: string, text: string): void {
    if (!id || !text) return;
    this.queue.set(id, { id, text });
  }
```

- [ ] **Step 4: 跑绿** → PASS（2 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/vector-store.ts gateway/tests/unit/memory/embedding-indexer-enqueue.test.ts
git commit -m "feat: EmbeddingIndexer.enqueueText (raw-text queue for the t1 channel)"
```

---

### Task 3: EmbeddingRuntime t1 通道

**Files:**
- Modify: `gateway/src/memory/embedding-runtime.ts`
- Test: `gateway/tests/unit/memory/embedding-runtime-t1.test.ts`

**Interfaces:**
- Produces: `EmbeddingRuntime` 增 `t1Vectors: MemoryVectorStore`（无 provider 时 undefined）与 `t1Indexer: EmbeddingIndexer`；`scheduleFlush()` 同时 flush 两个 indexer；`InitEmbeddingRuntimeOptions` 增 `createProviderFn?: typeof createEmbeddingProvider`（测试注入假 provider 用）。
- 向量文件：`<baseDir>/memory/vectors-t1-<modelTag>.json`（与 harmonic 的 `vectors-<modelTag>.json` 分离）。

- [ ] **Step 1: 写失败测试**

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { initEmbeddingRuntime, setEmbeddingRuntime, getEmbeddingRuntime } from '../../../src/memory/embedding-runtime';

class FakeProvider {
  name = 'fake-embed';
  dims = 4;
  async embed(texts: string[], _kind?: string): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}

describe('initEmbeddingRuntime t1 channel', () => {
  test('provider active → t1Vectors/t1Indexer created with separate file; harmonic channel intact', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-'));
    const rt = initEmbeddingRuntime({
      baseDir: dir,
      cfg: { provider: 'local', model: 'fake', dimensions: 4 } as any,
      createProviderFn: (async () => new FakeProvider() as any) as any,
    });
    expect(rt).toBeTruthy();
    expect(rt!.t1Vectors).toBeTruthy();
    expect(rt!.t1Indexer).toBeTruthy();
    expect(fs.existsSync(path.join(dir, 'memory', 'vectors-t1-fake-embed.json'))).toBe(false); // created lazily on flush
    // t1 channel round-trip
    rt!.t1Indexer!.enqueueText('k1', 'hello verbatim');
    await rt!.t1Indexer!.flushQueue();
    expect(rt!.t1Vectors!.get('k1')).toEqual([1, 0, 0, 0]);
    expect(fs.existsSync(path.join(dir, 'memory', 'vectors-t1-fake-embed.json'))).toBe(true);
    // harmonic channel still separate
    expect(rt!.vectors).not.toBe(rt!.t1Vectors);
    setEmbeddingRuntime(null);
  });
  test('provider off → null runtime (t1 channel absent too)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-off-'));
    const rt = initEmbeddingRuntime({ baseDir: dir, cfg: { provider: 'off' } as any });
    expect(rt).toBeNull();
  });
  test('scheduleFlush flushes both channels', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-t1-flush-'));
    const rt = initEmbeddingRuntime({
      baseDir: dir,
      cfg: { provider: 'local', model: 'fake', dimensions: 4 } as any,
      createProviderFn: (async () => new FakeProvider() as any) as any,
    });
    setEmbeddingRuntime(rt);
    rt!.indexer.enqueueText('h1', 'harmonic text');
    rt!.t1Indexer!.enqueueText('t1k', 'verbatim text');
    await rt!.indexer.flushQueue();
    await rt!.t1Indexer!.flushQueue();
    expect(rt!.vectors.get('h1')).toEqual([1, 0, 0, 0]);
    expect(rt!.t1Vectors!.get('t1k')).toEqual([1, 0, 0, 0]);
    setEmbeddingRuntime(null);
  });
});
```

- [ ] **Step 2: 跑红** → FAIL（t1Vectors 属性不存在 / createProviderFn 选项不存在）

- [ ] **Step 3: 实现**（`embedding-runtime.ts` 改三处）：

3a. 接口扩展：

```typescript
export interface EmbeddingRuntime {
  provider: EmbeddingProvider;
  vectors: MemoryVectorStore;
  indexer: EmbeddingIndexer;
  /** V1 verbatim layer: second vector namespace over t1 rounds (undefined when no provider). */
  t1Vectors: MemoryVectorStore;
  t1Indexer: EmbeddingIndexer;
  /** Debounced async flush of both embedding queues (call after each write). */
  scheduleFlush(): void;
}
```

3b. `InitEmbeddingRuntimeOptions` 加：

```typescript
  /** Test seam: override the provider factory (fake providers). */
  createProviderFn?: typeof createEmbeddingProvider;
```

3c. `initEmbeddingRuntime` 内：`const provider = (opts.createProviderFn ?? createEmbeddingProvider)({...});`；harmonic `vectors` 创建后加 t1 通道；`scheduleFlush` 闭包改双 flush：

```typescript
    const t1Vectors = new MemoryVectorStore(
      path.join(opts.baseDir, 'memory', `vectors-t1-${modelTag}.json`),
      cfg.dimensions || provider.dims,
      cfg.model,
    );
    const t1Indexer = new EmbeddingIndexer({ vectors: t1Vectors, provider });

    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const rt: EmbeddingRuntime = {
      provider,
      vectors,
      indexer,
      t1Vectors,
      t1Indexer,
      scheduleFlush() {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flushTimer = null;
          Promise.all([indexer.flushQueue(), t1Indexer.flushQueue()]).catch(() => { /* fail-open */ });
        }, 2000);
        (flushTimer as any).unref?.();
      },
    };
```

- [ ] **Step 4: 跑绿** → PASS（3 例）+ **回归**：`npx jest tests/unit/memory 2>&1 | Select-Object -Last 4`（既有 vector-store/embedding 套件不破）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/embedding-runtime.ts gateway/tests/unit/memory/embedding-runtime-t1.test.ts
git commit -m "feat: EmbeddingRuntime t1 channel (second vector namespace + dual flush)"
```

---

### Task 4: 配置 + SnapshotConfig 扩展

**Files:**
- Modify: `gateway/src/config.ts`（`recall` 接口 + 默认值，紧挨 `sourceEvidence`，~line 320 / ~591）
- Modify: `gateway/src/recall/recall-snapshot.ts`（`SnapshotConfig` + `SNAPSHOT_DEFAULTS` + `RecallSnapshot`）
- Test: `gateway/tests/unit/recall/snapshot-t1.test.ts`（本 Task 只建骨架断言默认值，融合逻辑在 Task 5）

**Interfaces:**
- Produces: `config.recall.t1Recall: { enabled: boolean; k: number; maxChars: number }`，默认 `{ enabled: true, k: 3, maxChars: 600 }`；`SnapshotConfig` 增 `t1K?: number; t1MaxChars?: number`（`SNAPSHOT_DEFAULTS` 同步默认 3/600）；`RecallSnapshot` 增 `t1Hits?: Array<{ sessionId: string; turnId: number; cosine: number; excerpt: string }>`。

- [ ] **Step 1: 写失败测试**（新文件，先只测默认值与类型透传）

```typescript
import { SNAPSHOT_DEFAULTS } from '../../../src/recall/recall-snapshot';
import { config } from '../../../src/config';

describe('t1 snapshot config defaults', () => {
  test('SNAPSHOT_DEFAULTS carries t1K/t1MaxChars', () => {
    expect(SNAPSHOT_DEFAULTS.t1K).toBe(3);
    expect(SNAPSHOT_DEFAULTS.t1MaxChars).toBe(600);
  });
  test('config.recall.t1Recall defaults enabled', () => {
    expect(config.recall.t1Recall?.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现**

`config.ts`（recall 接口 sourceEvidence 声明旁加）：

```typescript
    /** V1 verbatim dense layer: fuse t1 round hits into R8 snapshots. */
    t1Recall: { enabled: boolean; k: number; maxChars: number };
```

（默认值区 sourceEvidence 默认旁加）：

```typescript
      t1Recall: { enabled: true, k: 3, maxChars: 600 },
```

`recall-snapshot.ts`：`SnapshotConfig` 接口加 `t1K?: number; t1MaxChars?: number;`；`SNAPSHOT_DEFAULTS` 对象加 `t1K: 3, t1MaxChars: 600,`；`RecallSnapshot` 接口加：

```typescript
  /** V1: verbatim t1 hits fused into this snapshot (session:turn excerpts). */
  t1Hits?: Array<{ sessionId: string; turnId: number; cosine: number; excerpt: string }>;
```

- [ ] **Step 4: 跑绿** → PASS（2 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/config.ts gateway/src/recall/recall-snapshot.ts gateway/tests/unit/recall/snapshot-t1.test.ts
git commit -m "feat: t1Recall config + snapshot t1 fields"
```

---

### Task 5: snapshot-builder searchT1 融合

**Files:**
- Modify: `gateway/src/recall/snapshot-builder.ts`
- Test: `gateway/tests/unit/recall/snapshot-t1.test.ts`（追加）

**Interfaces:**
- Consumes: Task 1 的 `renderT1Lines`/`T1Hit`、Task 4 的 `t1K/t1MaxChars`。
- Produces: `SnapshotDeps` 增 `searchT1?: (query: string, k: number) => Promise<T1Hit[]> | T1Hit[]`；`buildSnapshot` 在 `render` 之后调它，把 verbatim 行追加到 block 尾部，`snapshot.t1Hits` 记录命中。

- [ ] **Step 1: 追加失败测试**

```typescript
import { buildSnapshot, SnapshotDeps } from '../../../src/recall/snapshot-builder';

const mem = (id: string) => ({ id, primary_abstraction: `abs ${id}`, cue_anchors: ['x'], created_at: '2026-10-10T00:00:00Z' } as any);

function makeDeps(overrides: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    recentTurnTexts: () => ['hello gateway'],
    search: () => [mem('m1'), mem('m2')],
    render: (ms: any[]) => `block with ${ms.length} memories`,
    store: () => {},
    ...overrides,
  } as SnapshotDeps;
}

describe('buildSnapshot searchT1 fusion', () => {
  test('appends t1 lines to the block and records t1Hits', async () => {
    const stored: any[] = [];
    const deps = makeDeps({
      searchT1: async () => [
        { sessionId: 'ses_PROVIDER123456', turnId: 3, cosine: 0.8, excerpt: 'verbatim hit one' },
      ],
      store: (_sid, snap) => stored.push(snap),
    });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400, t1K: 3, t1MaxChars: 300 } as any, 3);
    expect(snap).toBeTruthy();
    expect(snap!.block).toContain('block with 2 memories');
    expect(snap!.block).toContain('[t1|123456:3]');
    expect(snap!.block).toContain('verbatim hit one');
    expect(snap!.t1Hits).toHaveLength(1);
    expect(stored[0].t1Hits).toHaveLength(1);
  });
  test('searchT1 empty → block unchanged, t1Hits undefined', async () => {
    const deps = makeDeps({ searchT1: async () => [] });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap!.block).toBe('block with 2 memories');
    expect(snap!.t1Hits).toBeUndefined();
  });
  test('searchT1 absent → behavior identical to today', async () => {
    const deps = makeDeps();
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap!.block).toBe('block with 2 memories');
    expect(snap!.t1Hits).toBeUndefined();
  });
  test('searchT1 throws → fail-open (snapshot still built)', async () => {
    const deps = makeDeps({
      searchT1: async () => { throw new Error('embed down'); },
    });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap).toBeTruthy();
    expect(snap!.t1Hits).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑红** → FAIL（searchT1 不在 deps 类型上）

- [ ] **Step 3: 实现**（`snapshot-builder.ts`）：

3a. import 加：`import { renderT1Lines, T1Hit } from './verbatim-recall';`

3b. `SnapshotDeps` 加：

```typescript
  /** V1 verbatim layer: dense search over t1 rounds (fail-open — absence
   *  keeps the snapshot harmonic-only). */
  searchT1?: (query: string, k: number) => Promise<T1Hit[]> | T1Hit[];
```

3c. `buildSnapshot` 里 `const block = deps.render(memories, fokStatus);` 之后、`if (!block) return null;` 之前改为：

```typescript
  let block = deps.render(memories, fokStatus);
  if (!block) return null;

  // V1: verbatim fusion — append t1 round hits after the pointer block.
  let t1Hits: T1Hit[] | undefined;
  if (deps.searchT1) {
    try {
      const hits = await deps.searchT1(query, cfg.t1K ?? SNAPSHOT_DEFAULTS.t1K ?? 3);
      if (hits && hits.length > 0) {
        const lines = renderT1Lines(hits, { k: cfg.t1K ?? 3, maxChars: cfg.t1MaxChars ?? 600 });
        if (lines) {
          block = `${block}\n${lines}`;
          t1Hits = hits.slice(0, cfg.t1K ?? 3);
        }
      }
    } catch { /* fail-open: harmonic-only snapshot */ }
  }
```

（后面 `const snapshot: RecallSnapshot = {...}` 对象里加 `t1Hits,`——`t1Hits` 为 undefined 时 JSON 序列化自然省略。）

- [ ] **Step 4: 跑绿** → PASS（追加 4 例；含 Task 4 的 2 例共 6）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/snapshot-builder.ts gateway/tests/unit/recall/snapshot-t1.test.ts
git commit -m "feat: snapshot builder fuses t1 verbatim hits (searchT1 dep, fail-open)"
```

---

### Task 6: makeT1Search 工厂（可注入实现）

**Files:**
- Modify: `gateway/src/recall/verbatim-recall.ts`
- Test: `gateway/tests/unit/recall/verbatim-recall.test.ts`（追加）

**Interfaces:**
- Consumes: Task 3 的 runtime 形状 `{ provider: { embed(texts, kind): Promise<number[][]> }; t1Vectors?: { searchByCosine(q, k): Array<{id, cosine}> } | null }`（结构化，不 import 具体类——测试可假）。
- Produces: `makeT1Search(deps: T1SearchDeps): (query: string, k: number) => Promise<T1Hit[]>`

```typescript
export interface T1SearchDeps {
  runtime: {
    provider: { embed(texts: string[], kind: string): Promise<number[][]> };
    t1Vectors?: { searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> } | null;
  };
  /** Archive-first row lookup (falls back to live observations). */
  fetchRows: (sessionId: string, turnId: number) => T1Row[];
}
```

- [ ] **Step 1: 追加失败测试**

```typescript
import { makeT1Search } from '../../../src/recall/verbatim-recall';

describe('makeT1Search', () => {
  const key = (s: string, t: number, c: string) => t1VectorKey(s, t, c);
  test('embeds query, groups hits to turns, builds excerpts from rows', async () => {
    const store = {
      searchByCosine: (_q: number[], k: number) => [
        { id: key('s1', 1, 'row a'), cosine: 0.9 },
        { id: key('s1', 1, 'row b'), cosine: 0.6 },
        { id: key('s2', 2, 'row c'), cosine: 0.7 },
      ].slice(0, k),
    };
    const rowsByTurn = new Map<string, any[]>([
      ['s1:1', [row('s1', 1, 'user_input', 'row a'), row('s1', 1, 'tool_result', 'row b')]],
      ['s2:2', [row('s2', 2, 'assistant_reply', 'row c')]],
    ]);
    const search = makeT1Search({
      runtime: { provider: { embed: async () => [[1, 0]] }, t1Vectors: store as any },
      fetchRows: (sid, tid) => rowsByTurn.get(`${sid}:${tid}`) ?? [],
    });
    const hits = await search('query', 3);
    expect(hits.map(h => [h.sessionId, h.turnId])).toEqual([['s1', 1], ['s2', 2]]);
    expect(hits[0].cosine).toBe(0.9);
    expect(hits[0].excerpt).toBe('row a'); // matched by content hash
    expect(hits[1].excerpt).toBe('row c');
  });
  test('missing rows → hit dropped (no empty excerpts)', async () => {
    const store = { searchByCosine: () => [{ id: key('sX', 9, 'gone'), cosine: 0.95 }] };
    const search = makeT1Search({
      runtime: { provider: { embed: async () => [[1, 0]] }, t1Vectors: store as any },
      fetchRows: () => [],
    });
    expect(await search('q', 3)).toEqual([]);
  });
  test('no t1Vectors → empty; embed throws → empty (fail-open)', async () => {
    const noVec = makeT1Search({ runtime: { provider: { embed: async () => [[]] }, t1Vectors: null }, fetchRows: () => [] });
    expect(await noVec('q', 3)).toEqual([]);
    const broken = makeT1Search({
      runtime: { provider: { embed: async () => { throw new Error('down'); } }, t1Vectors: { searchByCosine: () => [] } as any },
      fetchRows: () => [],
    });
    expect(await broken('q', 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑红** → FAIL

- [ ] **Step 3: 实现**（`verbatim-recall.ts` 末尾追加）

```typescript
export interface T1SearchDeps {
  runtime: {
    provider: { embed(texts: string[], kind: string): Promise<number[][]> };
    t1Vectors?: { searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> } | null;
  };
  /** Archive-first row lookup (falls back to live observations). */
  fetchRows: (sessionId: string, turnId: number) => T1Row[];
}

/** Factory for the SnapshotDeps.searchT1 dep: dense search over t1 vectors,
 *  grouped to turns, excerpts resolved through the row fetcher. Fail-open. */
export function makeT1Search(deps: T1SearchDeps): (query: string, k: number) => Promise<T1Hit[]> {
  return async (query: string, k: number): Promise<T1Hit[]> => {
    const vecs = deps.runtime.t1Vectors;
    if (!vecs || !query.trim()) return [];
    try {
      const [qv] = await deps.runtime.provider.embed([query], 'query');
      if (!qv) return [];
      const raw = vecs.searchByCosine(qv, Math.max(k * 4, 12));
      const turns = groupT1HitsToTurns(raw, k);
      const out: T1Hit[] = [];
      for (const t of turns) {
        const rows = deps.fetchRows(t.sessionId, t.turnId);
        if (!rows.length) continue;
        const matchKey = raw.find(h => h.id.startsWith(`${t.sessionId}:${t.turnId}:`))?.id ?? '';
        const excerpt = excerptFromRows(rows, matchKey, 220);
        if (excerpt) out.push({ sessionId: t.sessionId, turnId: t.turnId, cosine: t.cosine, excerpt });
      }
      return out;
    } catch {
      return []; // fail-open — snapshot stays harmonic-only
    }
  };
}
```

- [ ] **Step 4: 跑绿** → PASS（3 例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/verbatim-recall.ts gateway/tests/unit/recall/verbatim-recall.test.ts
git commit -m "feat: makeT1Search factory (dense t1 search with row excerpts)"
```

---

### Task 7: mafw_get_memory 的 t1 指针兑现

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（`findArchiveBySessionTail`）
- Modify: `gateway/src/mcp/handlers/get-memory.ts`
- Modify: `gateway/src/types.ts`（Services 加 `resolveT1`）
- Modify: `gateway/src/index.ts`（services 注入点 ×2，~line 2894 与 ~4217——同 searchArchive 的注入位置）
- Test: `gateway/tests/unit/mcp/get-memory-t1.test.ts`

**Interfaces:**
- Produces: `GatewayDatabase.findArchiveBySessionTail(tail: string, turnId: number): T1Observation[]`；Services 增 `resolveT1?: (sessionTail: string, turnId: number) => T1Observation[]`；`mafw_get_memory` 接受 id 形如 `t1:<sessionTail6>:<turnId>`，返回 `{ success, t1: { sessionId, turnId, rows: Array<{source, content}> } }`。

- [ ] **Step 1: 写失败测试**

```typescript
import { handleGetMemory } from '../../../src/mcp/handlers/get-memory';

describe('handleGetMemory t1 pointer redemption', () => {
  const rows = [
    { session_id: 'ses_FULL123456', turn_id: 5, source: 'user_input', content: 'what did the deploy say' },
    { session_id: 'ses_FULL123456', turn_id: 5, source: 'tool_result', content: 'deploy ok in 3s' },
  ];
  test('t1:<tail>:<turn> resolves through resolveT1 and returns rows', async () => {
    const res = await handleGetMemory({ id: 't1:123456:5' }, {
      resolveT1: (tail, turn) => (tail === '123456' && turn === 5 ? rows as any : []),
    } as any);
    expect(res.success).toBe(true);
    expect(res.t1.sessionId).toBe('ses_FULL123456');
    expect(res.t1.turnId).toBe(5);
    expect(res.t1.rows).toHaveLength(2);
    expect(res.t1.rows[1].content).toBe('deploy ok in 3s');
  });
  test('no matches → success false with helpful error', async () => {
    const res = await handleGetMemory({ id: 't1:zzzzzz:9' }, { resolveT1: () => [] } as any);
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain('t1');
  });
  test('non-t1 id → t1 branch not triggered', async () => {
    let called = false;
    try {
      await handleGetMemory({ id: 'mem_1234567890_abcdef' }, { resolveT1: () => { called = true; return []; } } as any);
    } catch { /* existing memory path may throw without a memory store — fine */ }
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: 跑红** → FAIL（t1 分支不存在）

- [ ] **Step 3: 实现**

3a. `gateway-db.ts`（`searchArchive` 方法后加）：

```typescript
  /** V1 t1 pointer redemption: find archive rows by session-id tail + turn. */
  findArchiveBySessionTail(tail: string, turnId: number): T1Observation[] {
    if (!tail || !Number.isInteger(turnId) || turnId < 0) return [];
    return this.db
      .prepare(`SELECT * FROM t1_archive WHERE session_id LIKE '%' || ? || '%' AND turn_id = ? ORDER BY id LIMIT 50`)
      .all(tail, turnId) as T1Observation[];
  }
```

3b. `types.ts` Services（searchArchive 声明旁加）：

```typescript
  resolveT1?: (sessionTail: string, turnId: number) => import('./memory/gateway-db').T1Observation[];
```

3c. `get-memory.ts`（handler 顶部、正常流程之前加 t1 分支；解构加 `resolveT1`）：

```typescript
  // V1: t1 pointer redemption — ids of the form `t1:<sessionTail>:<turnId>`
  // resolve to raw archived round rows (verbatim layer).
  if (typeof args?.id === 'string' && /^t1:[^:]+:\d+$/.test(args.id)) {
    const [, tail, turnStr] = args.id.split(':');
    const turnId = Number(turnStr);
    if (!resolveT1) return { success: false as const, error: 't1 pointer resolution unavailable (gateway service missing)' };
    const rows = resolveT1(tail, turnId);
    if (!rows.length) return { success: false as const, error: `no t1 rows for session tail ${tail} turn ${turnId}` };
    return {
      success: true as const,
      t1: {
        sessionId: rows[0].session_id,
        turnId,
        rows: rows.map(r => ({ source: r.source, content: r.content })),
      },
    };
  }
```

3d. `index.ts` 两处 services 注入（searchArchive 旁各加一行）：

```typescript
        resolveT1: (tail: string, turnId: number) => this.getGatewayDb().findArchiveBySessionTail(tail, turnId),
```

- [ ] **Step 4: 跑绿** → PASS（3 例）+ `npx jest tests/unit/mcp 2>&1 | Select-Object -Last 4` 回归

- [ ] **Step 5: 门禁 + Commit**（改了 index.ts → root `npm run build` exit 0）

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/mcp/handlers/get-memory.ts gateway/src/types.ts gateway/src/index.ts gateway/tests/unit/mcp/get-memory-t1.test.ts
git commit -m "feat: mafw_get_memory t1 pointer redemption (t1:<tail>:<turn>)"
```

---

### Task 8: provenance 修复（worker-origin）

**Files:**
- Create: `gateway/src/recall/worker-origin.ts`
- Modify: `gateway/src/recall/session-worker-pool.ts`
- Modify: `gateway/src/index.ts:6994`（add 路由 source 覆盖）
- Test: `gateway/tests/unit/recall/worker-origin.test.ts`

**Interfaces:**
- Produces: `registerWorkerOrigin(workerSessionId: string, sourceSessionId: string): void`、`resolveWorkerOrigin(workerSessionId: string): string | null`、`clearWorkerOrigins(): void`。add 路由：worker 会话写入 → source_session_id 改写为源会话。

- [ ] **Step 1: 写失败测试**

```typescript
import { registerWorkerOrigin, resolveWorkerOrigin, clearWorkerOrigins } from '../../../src/recall/worker-origin';
import { SessionWorkerPool } from '../../../src/recall/session-worker-pool';

describe('worker-origin registry', () => {
  test('register + resolve + unknown → null', () => {
    clearWorkerOrigins();
    registerWorkerOrigin('w1', 'src-1');
    expect(resolveWorkerOrigin('w1')).toBe('src-1');
    expect(resolveWorkerOrigin('nope')).toBeNull();
    clearWorkerOrigins();
    expect(resolveWorkerOrigin('w1')).toBeNull();
  });
});

describe('SessionWorkerPool registers origin on session creation', () => {
  test('worker session id maps back to the source session', async () => {
    clearWorkerOrigins();
    let seq = 0;
    const client = {
      session: {
        create: async () => ({ id: `w-${++seq}` }),
        prompt: async () => ({ parts: [{ type: 'text', text: 'ok' }] }),
        summarize: async () => true,
        delete: async () => {},
      },
    };
    const created: Array<[string, string]> = [];
    const pool = new SessionWorkerPool({
      client: client as any,
      directory: '/tmp',
      ttlMs: 60_000,
      onSessionCreated: (sid, role) => created.push([sid, role]),
    });
    const worker = pool.getWorker('src-42', 'extract');
    await worker.prompt('hi', 'sys');
    const mapped = resolveWorkerOrigin('w-1');
    expect(mapped).toBe('src-42');
    expect(created).toContainEqual(['w-1', 'extract']);
    await pool.disposeAll();
  });
});
```

- [ ] **Step 2: 跑红** → FAIL（模块不存在）

- [ ] **Step 3: 实现**

3a. `worker-origin.ts`（新文件）：

```typescript
// V1 provenance fix: pipeline workers (turnCompress/reflection) write
// memories via HTTP with THEIR session id as source_session_id — those worker
// sessions never land in t1_archive, so C0 source reconstruction no-ops. This
// registry maps worker session id → the SOURCE session it was spawned for;
// the /api/memory/add route rewrites source_session_id through it.
//
// Bounded by distinct source sessions (the pool caps at ~64 live pairs);
// eviction pruning is accepted as a V1 simplification — stale entries are
// only readable, never harmful.
const origins = new Map<string, string>();

export function registerWorkerOrigin(workerSessionId: string, sourceSessionId: string): void {
  if (!workerSessionId || !sourceSessionId) return;
  origins.set(workerSessionId, sourceSessionId);
}

export function resolveWorkerOrigin(workerSessionId: string): string | null {
  return origins.get(workerSessionId) ?? null;
}

export function clearWorkerOrigins(): void {
  origins.clear();
}
```

3b. `session-worker-pool.ts`：顶部 import 加 `import { registerWorkerOrigin } from './worker-origin';`；两处 `onSessionCreated` 包装改为无条件（extract 与 reflect 各一）：

```typescript
          onSessionCreated: (sid) => {
            registerWorkerOrigin(sid, sessionID);
            this.opts.onSessionCreated?.(sid, 'extract');
          },
```

（reflect 处同型，role 换 `'reflect'`。）

3c. `index.ts:6994` add 路由：unit 字面量里 `source_session_id` 一行替换为：

```typescript
          // V1 provenance: pipeline workers write via HTTP with their own
          // session id — map back to the source session for C0 reconstruction.
          source_session_id: (data?.sessionID && resolveWorkerOrigin(String(data.sessionID))) || (data?.sessionID ? String(data.sessionID) : undefined),
```

（index.ts 顶部 import 区已有 worker/recall 相关 require 惯例——在该路由所在作用域内加 `const { resolveWorkerOrigin } = require('./recall/worker-origin');`，与本文件内联 require 风格一致。）

- [ ] **Step 4: 跑绿** → PASS（3 例）+ `npx jest tests/unit/recall 2>&1 | Select-Object -Last 4` 回归

- [ ] **Step 5: 门禁 + Commit**（改 index.ts → root `npm run build`）

```bash
git add gateway/src/recall/worker-origin.ts gateway/src/recall/session-worker-pool.ts gateway/src/index.ts gateway/tests/unit/recall/worker-origin.test.ts
git commit -m "feat: worker-origin registry fixes pipeline memory provenance (source_session_id rewrite)"
```

---

### Task 9: index.ts 接线（capture 嵌入 + 快照 searchT1 注入）

**Files:**
- Modify: `gateway/src/index.ts`（两处：obs capture ~6128 后；refreshSnapshotInner deps ~1827 后）

**Interfaces:**
- Consumes: Task 3 runtime、Task 1 `t1VectorKey`/`makeT1Search`、Task 4 config。
- Produces: 写路径 fire-and-forget t1 嵌入；快照融合上线（`config.recall.t1Recall.enabled` 门控）。

- [ ] **Step 1: obs capture 嵌入**（`index.ts` 6139 行 `});`（append 调用结束）之后、`// Async scan prefetch` 注释之前插入）：

```typescript
              // V1 verbatim layer: fire-and-forget dense embedding of the raw
              // row. Key = session:turn:contentHash — stable across the
              // obs→archive move, idempotent on identical content. Fail-open.
              try {
                const rt = getEmbeddingRuntime();
                const { t1VectorKey } = require('./recall/verbatim-recall');
                if (rt?.t1Indexer && redacted) {
                  rt.t1Indexer.enqueueText(t1VectorKey(sessionID, turnId, redacted), redacted.slice(0, 2000));
                  rt.scheduleFlush();
                }
              } catch { /* fail-open */ }
```

（`getEmbeddingRuntime` 该作用域已可用——如无顶部 import，则参照本文件内联 require 惯例 `const { getEmbeddingRuntime } = require('./memory/embedding-runtime');` 加在同一 try 块内。）

- [ ] **Step 2: 快照注入**（`refreshSnapshotInner` 的 `buildSnapshot({...})` deps 字面量中，`search:` 键之后追加）：

```typescript
      // V1 verbatim layer: dense t1 round hits fused into the snapshot block.
      ...(config.recall.t1Recall?.enabled !== false
        ? (() => {
            const { getEmbeddingRuntime } = require('./memory/embedding-runtime');
            const { makeT1Search } = require('./recall/verbatim-recall');
            const rt = getEmbeddingRuntime();
            if (!rt?.t1Vectors) return {};
            return {
              searchT1: makeT1Search({
                runtime: rt,
                fetchRows: (sid: string, tid: number) => {
                  const rows = db.readArchiveTurn(sid, tid);
                  return rows.length ? rows : db.readTurn(sid, tid);
                },
              }),
            };
          })()
        : {}),
```

- [ ] **Step 3: 门禁**

Run: root `npm run build`（exit 0）——jest 不 typecheck index.ts，此步是唯一类型门。
Run: `cd gateway; npx jest --runInBand 2>&1 | Select-Object -Last 5` → 全绿（基线 1902 + 本计划新增 ~24）

- [ ] **Step 4: 冒烟**（gateway 运行态手动验证，可选但推荐）：
  1. `mafw restart-agent` 或等下一轮真实会话产生 obs；
  2. 查日志 `~/.mafw/logs/mafw.log` 无新 ERROR；
  3. 次轮 recall 的快照块日志（`[Recall] snapshot served`）照常；
  4. `Test-Path ~/.mafw/memory/vectors-t1-*.json` 若嵌入 runtime 开启（provider 非 off）应为 true 且体积增长。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat: wire t1 embedding at capture + snapshot searchT1 fusion (V1 verbatim layer)"
```

---

### Task 10: 存量回填脚本

**Files:**
- Create: `gateway/scripts/backfill-t1-embeddings.ts`

**Interfaces:**
- Consumes: Task 1 `t1VectorKey`、Task 3 `initEmbeddingRuntime`。
- Produces: `npx ts-node scripts/backfill-t1-embeddings.ts [--apply]`——dry-run（默认）只统计缺口；`--apply` 嵌入全部缺失行。**要求 gateway 停止**（向量文件内存属主是运行中的进程）：先 `mafw stop`。

- [ ] **Step 1: 实现脚本**

```typescript
// One-time backfill: embed every archived t1 round into the t1 vector store
// (V1 verbatim dense layer). Usage:
//   mafw stop
//   cd gateway && npx ts-node scripts/backfill-t1-embeddings.ts            # dry-run
//   cd gateway && npx ts-node scripts/backfill-t1-embeddings.ts --apply    # embed
// Resume-safe: rows whose vector key already exists are skipped.
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { initEmbeddingRuntime } from '../src/memory/embedding-runtime';
import { t1VectorKey } from '../src/recall/verbatim-recall';

const apply = process.argv.includes('--apply');
const mafwDir = path.join(os.homedir(), '.mafw');
const db = new Database(path.join(mafwDir, 'memory', 'gateway.db'), { readonly: true });

const rt = initEmbeddingRuntime({ baseDir: mafwDir });
if (!rt || !rt.t1Indexer) {
  console.log('embedding provider is off — enable memory.embedding (local or dashscope) first.');
  process.exit(1);
}

interface Row { session_id: string; turn_id: number; source: string; content: string }

const rows = db
  .prepare('SELECT session_id, turn_id, source, content FROM t1_archive WHERE length(trim(content)) > 0')
  .all() as Row[];

let missing = 0;
let skipped = 0;
let enqueued = 0;
let sinceFlush = 0;
const t0 = Date.now();

for (const r of rows) {
  const key = t1VectorKey(r.session_id, r.turn_id, r.content);
  if (rt.t1Vectors.get(key)) {
    skipped++;
    continue;
  }
  missing++;
  if (!apply) continue;
  rt.t1Indexer.enqueueText(key, r.content.slice(0, 2000));
  enqueued++;
  sinceFlush++;
  if (sinceFlush >= 500) {
    void rt.t1Indexer.flushQueue().then(() => { /* progress flush */ });
    sinceFlush = 0;
    console.log(`[backfill] enqueued ${enqueued}/${missing + skipped} (${Math.round((enqueued / rows.length) * 100)}%) ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}

if (apply && enqueued > 0) {
  rt.t1Indexer.flushQueue().then(({ indexed, failed }) => {
    console.log(`[backfill] final flush: indexed=${indexed} failed=${failed}`);
    console.log(`[backfill] done: total=${rows.length} embedded=${indexed} skipped(existing)=${skipped} failed=${failed} in ${Math.round((Date.now() - t0) / 1000)}s`);
    process.exit(failed > 0 ? 2 : 0);
  }).catch((e: any) => { console.error('flush failed:', e?.message || e); process.exit(3); });
} else {
  console.log(`[backfill] dry-run: total rows=${rows.length} missing vectors=${missing} already embedded=${skipped}`);
  console.log(apply ? 'nothing to embed' : 're-run with --apply to embed');
}
```

- [ ] **Step 2: dry-run 验证**

Run（gateway 停止或运行均可，dry-run 零写入）: `cd gateway; npx ts-node scripts/backfill-t1-embeddings.ts`
Expected: `[backfill] dry-run: total rows=51xxx missing vectors=51xxx already embedded=0`（数量级与 t1_archive 一致）

- [ ] **Step 3: 部署后手动 --apply**（用户批准后执行；流程见收尾）

- [ ] **Step 4: Commit**

```bash
git add gateway/scripts/backfill-t1-embeddings.ts
git commit -m "feat: t1 embedding backfill script (dry-run default, resume-safe)"
```

---

## 执行顺序与门禁汇总

| Task | 交付物 | 新增测试 |
|---|---|---|
| 1 | verbatim-recall 纯模块 | 11 |
| 2 | enqueueText | 2 |
| 3 | runtime t1 通道 | 3 |
| 4 | config + snapshot 字段 | 2 |
| 5 | 快照融合 | 4 |
| 6 | makeT1Search | 3 |
| 7 | t1 指针兑现 | 3 |
| 8 | provenance 修复 | 3 |
| 9 | index.ts 接线 + 全量门禁 + root build | 0（门禁） |
| 10 | 回填脚本 | 0（dry-run 验证） |

全部完成后：root `npm run build` exit 0 + `cd gateway && npx jest --runInBand` 全绿（预计 **1902 + 31 ≈ 1933**），然后统一 bump 版本（4.26.0）+ pack + 部署 + 回填 `--apply`（`mafw stop` → script → `mafw daemon`）+ 验证：`mafw health`、日志无 ERROR、`vectors-t1-*.json` 体积 ≈ 5 万行 × dims、次轮会话 recall 正常。

## 已知边界（显式记债，不在本计划修）

- **标识符/精确串盲区**（dense 已知盲点，R7 教训）——V2 键增广（GLiNER+regex）偿还；`mafw_get_memory` 的 C0 LIKE 兜底已存在。
- worker-origin 注册表无逐出清理（bounded by 会话数，V1 接受）。
- t1 命中不参与 FOK 门（FOK 是 harmonic 记忆的元认知信号；verbatim 层独立有界 k=3）。
