# C0 · 检索回源重建 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mafw_get_memory` 兑现指针时从 `t1_archive` 回源重建原始回合证据，补上"稀疏索引 → 重建"。

**Architecture:** 新增 `GatewayDatabase.searchArchive`（按锚点 LIKE 搜归档回合）+ 纯函数 `reconstructSource`（预算渲染）；`handleGetMemory` 附 `source`；`Services`/`index.ts` 注入。fail-open，不改存储与 boundary。

**Tech Stack:** TypeScript (CJS)、better-sqlite3、Jest（`--runInBand`）。

**Spec:** `docs/superpowers/specs/2026-09-23-c0-source-reconstruction-design.md`

## Global Constraints

- fail-open：回源失败不得使 `get_memory` 报错（返回 memory 本体照旧）。
- 预算：`k` 默认 5、`maxChars` 默认 1500。
- `searchArchive` 缺失时行为完全不变（可选注入）。
- 不改存储、不改 boundary recall / `<recall>` 块。
- 测试命令在 `gateway/` 下执行。

---

## File Structure

- **Modify** `gateway/src/memory/gateway-db.ts` — `searchArchive`。
- **Create** `gateway/src/recall/source-reconstruction.ts` — `reconstructSource`（纯）。
- **Modify** `gateway/src/mcp/handlers/get-memory.ts` — 附 `source`。
- **Modify** `gateway/src/types.ts` — `Services.searchArchive`。
- **Modify** `gateway/src/config.ts` — `recall.sourceEvidence`。
- **Modify** `gateway/src/index.ts` — services + HTTP 路由注入。
- **Create** `gateway/tests/unit/source-reconstruction.test.ts`、`gateway/tests/unit/source-reconstruction-db.test.ts`、`gateway/tests/unit/get-memory-source.test.ts`

---

### Task 1: `searchArchive`（DB）

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（`listArchiveTurns` 之后，~line 378）
- Test: `gateway/tests/unit/source-reconstruction-db.test.ts`

**Interfaces:**
- Produces: `GatewayDatabase.searchArchive(session_id: string, anchors: string[], k: number): T1Observation[]`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/source-reconstruction-db.test.ts`:

```ts
import { GatewayDatabase } from '../../src/memory/gateway-db';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function seed(db: GatewayDatabase, session: string, turn: number, source: string, content: string) {
  (db as any).db.prepare(
    'INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at) VALUES (?,?,?,?,?,?)',
  ).run(session, turn, source, content, 0, Math.floor(Date.now() / 1000));
}

describe('GatewayDatabase.searchArchive', () => {
  let dir: string;
  let db: GatewayDatabase;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcarch-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

  test('按锚点命中数排序，取 k 条', () => {
    seed(db, 's1', 1, 'user_input', 'kubernetes deployment question');
    seed(db, 's1', 2, 'assistant_reply', 'kubernetes rollout detail');
    seed(db, 's1', 3, 'assistant_reply', 'unrelated chatter');
    const out = db.searchArchive('s1', ['kubernetes', 'rollout'], 2);
    expect(out.length).toBe(2);
    expect(out[0].turn_id).toBe(2); // 两个锚点都命中
  });

  test('不跨会话', () => {
    seed(db, 's1', 1, 'user_input', 'kubernetes deployment');
    seed(db, 's2', 1, 'user_input', 'kubernetes deployment');
    const out = db.searchArchive('s1', ['kubernetes'], 5);
    expect(out.every(t => t.session_id === 's1')).toBe(true);
  });

  test('空参数返回空', () => {
    expect(db.searchArchive('s1', [], 5)).toEqual([]);
    expect(db.searchArchive('s1', ['x'], 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/source-reconstruction-db.test.ts --runInBand`
Expected: FAIL — `searchArchive is not a function`

- [ ] **Step 3: Implement**

In `gateway/src/memory/gateway-db.ts`, after `listArchiveTurns` (~line 378):

```ts
  /** Search a session's archived turns by anchor substrings (LIKE), best-match first. */
  searchArchive(session_id: string, anchors: string[], k: number): T1Observation[] {
    if (!session_id || anchors.length === 0 || k <= 0) return [];
    const needle = anchors.map(a => a.toLowerCase());
    const likes = needle.map(() => 'content LIKE ?').join(' OR ');
    const rows = this.db
      .prepare(`SELECT * FROM t1_archive WHERE session_id = ? AND (${likes}) ORDER BY turn_id LIMIT 200`)
      .all(session_id, ...needle.map(a => `%${a}%`)) as T1Observation[];
    const scored = rows
      .map(r => ({ r, hits: needle.filter(a => (r.content || '').toLowerCase().includes(a)).length }))
      .filter(x => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.r.turn_id - b.r.turn_id);
    return scored.slice(0, k).map(x => x.r);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/source-reconstruction-db.test.ts --runInBand`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/source-reconstruction-db.test.ts
git commit -m "feat(gateway): searchArchive 按锚点搜归档回合"
```

---

### Task 2: `reconstructSource`（纯渲染）

**Files:**
- Create: `gateway/src/recall/source-reconstruction.ts`
- Test: `gateway/tests/unit/source-reconstruction.test.ts`

**Interfaces:**
- Consumes: `T1Observation`（`../memory/gateway-db`）。
- Produces: `reconstructSource(turns: T1Observation[], maxChars: number): string`

- [ ] **Step 1: Write the failing test**

Create `gateway/tests/unit/source-reconstruction.test.ts`:

```ts
import { reconstructSource } from '../../src/recall/source-reconstruction';

const t = (source: string, content: string) => ({ source, content } as any);

describe('reconstructSource', () => {
  test('角色标签 + 换行合并', () => {
    const out = reconstructSource([
      t('user_input', 'hello\nworld'),
      t('assistant_reply', 'answer'),
      t('tool_result', 'out'),
      t('reasoning', 'think'),
    ], 1000);
    expect(out).toContain('[USER] hello world');
    expect(out).toContain('[ASSISTANT] answer');
    expect(out).toContain('[TOOL] out');
    expect(out).toContain('[THINKING] think');
  });

  test('预算截断', () => {
    const out = reconstructSource([t('user_input', 'a'.repeat(100)), t('assistant_reply', 'b'.repeat(100))], 60);
    expect(out.length).toBeLessThanOrEqual(60);
  });

  test('空输入空串', () => {
    expect(reconstructSource([], 1000)).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/source-reconstruction.test.ts --runInBand`
Expected: FAIL — `Cannot find module`

- [ ] **Step 3: Implement**

Create `gateway/src/recall/source-reconstruction.ts`:

```ts
import { T1Observation } from '../memory/gateway-db';

/** Render archived turns as budgeted evidence lines (empty when nothing fits). */
export function reconstructSource(turns: T1Observation[], maxChars: number): string {
  const lines: string[] = [];
  let used = 0;
  for (const t of turns) {
    const tag = t.source === 'user_input' ? 'USER'
      : t.source === 'reasoning' ? 'THINKING'
      : t.source === 'tool_result' ? 'TOOL' : 'ASSISTANT';
    const line = `[${tag}] ${(t.content || '').replace(/\s+/g, ' ').trim()}`;
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/source-reconstruction.test.ts --runInBand`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/recall/source-reconstruction.ts gateway/tests/unit/source-reconstruction.test.ts
git commit -m "feat(gateway): reconstructSource 原始证据渲染"
```

---

### Task 3: handler 兑现 + 配置 + 接线

**Files:**
- Modify: `gateway/src/config.ts`（`recall.sourceEvidence`）
- Modify: `gateway/src/types.ts`（`Services.searchArchive`）
- Modify: `gateway/src/mcp/handlers/get-memory.ts`（附 `source`）
- Modify: `gateway/src/index.ts`（services + HTTP 路由注入）
- Test: `gateway/tests/unit/get-memory-source.test.ts`

**Interfaces:**
- Consumes: Task 1 `searchArchive`、Task 2 `reconstructSource`。
- Produces: `Services.searchArchive?`。

- [ ] **Step 1: Add config**

In `gateway/src/config.ts`, `recall` interface (~line 177) add:
```ts
    /** Source-turn reconstruction for mafw_get_memory (C0). */
    sourceEvidence: { enabled: boolean; k: number; maxChars: number };
```
and defaults (~line 391) add:
```ts
      sourceEvidence: { enabled: true, k: 5, maxChars: 1500 },
```

- [ ] **Step 2: Add Services field**

In `gateway/src/types.ts`, `Services` add:
```ts
  /** Optional archive source-turn search for mafw_get_memory (C0). */
  searchArchive?: (sessionID: string, anchors: string[], k: number) => import('./memory/gateway-db').T1Observation[];
```

- [ ] **Step 3: Write the failing integration test**

Create `gateway/tests/unit/get-memory-source.test.ts`:

```ts
import { handleGetMemory } from '../../src/mcp/handlers/get-memory';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

async function setup(withArchive: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getmem-src-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  const unit: HarmonicUnit = { id: 'mem_1_abcdef', type: 'semantic', primary_abstraction: 'k8s note', cue_anchors: ['kubernetes'], memory_value: 'full value', energy: 0.8, created_at: now, updated_at: now, source_session_id: 's1' } as HarmonicUnit;
  const store = new HarmonicUnitFileStore(dir, index);
  await store.write(unit);
  const services: any = { memory: { harmonicIndex: index }, mafwDir: dir };
  if (withArchive) {
    services.searchArchive = (_sid: string, _anchors: string[], _k: number) => ([
      { source: 'user_input', content: 'raw kubernetes question' },
    ] as any);
  }
  return { dir, services };
}

describe('handleGetMemory source reconstruction', () => {
  test('有 searchArchive 时附 source.evidence', async () => {
    const { dir, services } = await setup(true);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.source.evidence).toContain('raw kubernetes question');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('无 searchArchive 时不附 source', async () => {
    const { dir, services } = await setup(false);
    const res = await handleGetMemory({ id: 'mem_1_abcdef' }, services);
    const body = JSON.parse(res.content[0].text);
    expect(body.source).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx jest tests/unit/get-memory-source.test.ts --runInBand`
Expected: FAIL — `body.source` undefined（未实现）

- [ ] **Step 5: Implement handler**

In `gateway/src/mcp/handlers/get-memory.ts`:

1. Import: `import { reconstructSource } from '../../recall/source-reconstruction';`
2. Destructure: `async (args, { memory, mafwDir, searchArchive }) => {`
3. Before the return (~line 61), add:
```ts
    let source: { sessionId: string; evidence: string } | undefined;
    if (searchArchive && unit.source_session_id && config.recall.sourceEvidence.enabled) {
      try {
        const turns = searchArchive(unit.source_session_id, unit.cue_anchors ?? [], config.recall.sourceEvidence.k);
        const evidence = reconstructSource(turns, config.recall.sourceEvidence.maxChars);
        if (evidence) source = { sessionId: unit.source_session_id, evidence };
      } catch { /* fail-open */ }
    }
```
4. Return body add `...(source ? { source } : {})`.

- [ ] **Step 6: Wire index.ts**

In `gateway/src/index.ts`:
1. `services` (~line 2086) add:
```ts
      searchArchive: (sid: string, anchors: string[], k: number) => this.getGatewayDb().searchArchive(sid, anchors, k),
```
2. HTTP route (~line 3376) add `searchArchive: (sid: string, anchors: string[], k: number) => this.getGatewayDb().searchArchive(sid, anchors, k),` to the passed object.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx jest tests/unit/get-memory-source.test.ts --runInBand`
Expected: PASS (2 tests)

- [ ] **Step 8: Build + full suite**

Run: `npm run build` then `npx jest --runInBand`
Expected: build exit 0；全绿

- [ ] **Step 9: Commit**

```bash
git add gateway/src/config.ts gateway/src/types.ts gateway/src/mcp/handlers/get-memory.ts gateway/src/index.ts gateway/tests/unit/get-memory-source.test.ts
git commit -m "feat(gateway): get_memory 回源重建原始证据（C0）"
```

---

## Self-Review

- **Spec §3.1 searchArchive** → Task 1 ✅
- **Spec §3.2 reconstructSource** → Task 2 ✅
- **Spec §3.3 兑现** → Task 3 Step 5 ✅
- **Spec §3.4 配置** → Task 3 Step 1 ✅
- **Spec §3.5 接线** → Task 3 Step 2/6 ✅
- **Spec §4 测试** → Tasks 1-3 ✅
- Placeholder：无。
- 类型一致性：`searchArchive`/`reconstructSource` 签名跨 Task 一致；`T1Observation` 从 `gateway-db` 引入。

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-09-23-c0-source-reconstruction.md`. 执行方式：① Subagent-Driven ② Inline。
