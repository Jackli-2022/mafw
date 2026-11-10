# T1 Identity and Storage Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every T1 turn and observation a permanent identity, stop turn-number reuse after archival, and preserve coding-time salience and provenance fields through the archive move.

**Architecture:** Add a durable `t1_turns` identity/sequence table, add `trace_id` and `observation_key` to active and archived observations, and make the obs capture route allocate turns through the database. Legacy duplicate `(session_id, turn_id)` rows stay physically intact and are marked `legacy_ambiguous`; no guessed history is merged. The active/archive tables remain physically separate in this phase, but identity semantics are stable across the move.

**Tech Stack:** TypeScript, better-sqlite3, Node `crypto.randomUUID`, Jest, existing `GatewayDatabase` and route registry.

**Spec:** `docs/superpowers/specs/2026-11-10-t1-experience-knowledge-skill-design.md`

## Global Constraints

- T1 `trace_id` and `observation_key` are permanent; archival never changes them.
- `turn_seq` is monotonic per session and never reused, even when no active rows remain.
- Raw observation content is immutable; this phase only adds identity/metadata.
- Existing `(session_id, turn_id, source, content)` dedup and old pointer/search readers must keep working.
- Legacy ambiguous data is preserved and marked; never guess a precise historical boundary.
- No runtime LLM calls, no boundary-recall changes, no activation/provenance/retrieval work in this phase.
- Gateway tests use `npx jest --runInBand`; type gate is `npx tsc --noEmit -p tsconfig.json` (without `-p` is a false green).
- `t1-db.ts` is an unused legacy duplicate of the store; do not extend or migrate it in this plan.

## Review Focus

- Re-opening an existing production DB with duplicate legacy turn keys: startup must not throw, duplicate identities, or silently merge unrelated epochs; the owning test is in Task 4.
- A non-user observation arriving after its turn was archived: it must not be dropped or written to turn 0; Task 2 and Task 3 pin this behavior.
- Process restart between allocation and next turn: the sequence must advance from durable state, not from currently active rows; Task 1 pins this.
- Old archive search/pointer readers and direct-SQL test fixtures: they must still read rows after the added columns; Task 3 and Task 4 cover compatibility.
- Repeated migration on every startup: it must be idempotent and leave exactly one `t1_turns` row per legacy composite key; Task 4 pins this.

---

### Task 1: Durable Turn Identity and Sequence

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (schema block around the T1 tables; T1 section around `nextTurnId`/`currentTurnId`)
- Test: `gateway/tests/unit/gateway-db-t1-identity.test.ts` (create)

**Interfaces:**
- Consumes: existing better-sqlite3 handle in `GatewayDatabase`.
- Produces:

```ts
export interface T1Turn {
  trace_id: string;
  session_id: string;
  turn_seq: number;
  created_at: number;
  archived_at: number | null;
  encoding_salience: number | null;
  legacy_ambiguous: number;
}

beginTurn(session_id: string, encodingSalience?: number): T1Turn;
currentTurn(session_id: string): T1Turn | null;
nextTurnId(session_id: string): number;
currentTurnId(session_id: string): number;
```

- `beginTurn` allocates one new row in `t1_turns` via a transaction and returns it.
- `nextTurnId` is a non-allocating peek. It must consider `t1_turns`, active rows, and archive rows so even untracked legacy fixtures cannot cause reuse.
- `currentTurn` returns the highest `turn_seq` for the session regardless of archived state. Late non-user observations can therefore attach to the latest logical turn.
- New trace IDs use the prefix `t1t_`; `created_at` uses Unix seconds.

- [ ] **Step 1: Write the failing identity test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('GatewayDatabase T1 turn identity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-identity-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('beginTurn allocates monotonically and nextTurnId only peeks', () => {
    const a = db.beginTurn('s1', 0.7);
    const b = db.beginTurn('s1');
    expect(a.turn_seq).toBe(1);
    expect(b.turn_seq).toBe(2);
    expect(a.trace_id).toMatch(/^t1t_/);
    expect(a.encoding_salience).toBeCloseTo(0.7, 6);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.currentTurn('s1')?.trace_id).toBe(b.trace_id);
  });

  test('archiving every active row does not reset the sequence', () => {
    const first = db.beginTurn('s1');
    (db as any).db.prepare(
      `INSERT INTO t1_observations (session_id, turn_id, source, content, failure)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('s1', first.turn_seq, 'user_input', 'first', 0);
    db.archiveTurn('s1', first.turn_seq);

    expect(db.count()).toBe(0);
    expect(db.nextTurnId('s1')).toBe(2);
    const second = db.beginTurn('s1');
    expect(second.turn_seq).toBe(2);
    expect(second.trace_id).not.toBe(first.trace_id);
  });

  test('sequence survives reopening the database', () => {
    const p = path.join(dir, 'persist.db');
    const a = new GatewayDatabase(p);
    a.beginTurn('s1');
    a.beginTurn('s1');
    a.close();

    db.close(); // close the beforeEach instance before replacing it
    db = new GatewayDatabase(p);
    expect(db.nextTurnId('s1')).toBe(3);
    expect(db.beginTurn('s1').turn_seq).toBe(3);
  });

  test('sessions have independent sequences', () => {
    db.beginTurn('a');
    db.beginTurn('a');
    expect(db.beginTurn('b').turn_seq).toBe(1);
    expect(db.nextTurnId('a')).toBe(3);
  });

  test('untracked legacy archive rows raise the next sequence', () => {
    (db as any).db.prepare(
      `INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('s1', 40, 'user_input', 'legacy', 0, 1);
    expect(db.nextTurnId('s1')).toBe(41);
    expect(db.beginTurn('s1').turn_seq).toBe(41);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-identity.test.ts`
Expected: FAIL because `t1_turns`, `beginTurn`, and the new `currentTurn` are missing.

- [ ] **Step 3: Implement the schema and methods**

Add `t1_turns` to the main schema with `UNIQUE(session_id, turn_seq)`, a session index, and the fields from `T1Turn`. Implement one private `nextTurnSeq(session_id)` query over the union of `t1_turns`, `t1_observations`, and `t1_archive`. Use a better-sqlite3 transaction in `beginTurn` to compute `next = nextTurnSeq(...)`, insert `t1t_${randomUUID()}`, and return the inserted row. Replace `nextTurnId` with the peek helper and `currentTurnId` with `currentTurn(...)?.turn_seq ?? 0`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-identity.test.ts`
Expected: PASS (5 tests). If the test file was written before Task 2, `append` may still accept rows without `trace_id`; that compatibility is temporary and must be tightened in Task 2.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-identity.test.ts
git commit -m "feat(memory): durable T1 turn identity and sequence"
```

---

### Task 2: Stable Observation Identity and Capture Route Integration

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`T1Observation`, `append`)
- Modify: `gateway/src/routes/obs.ts`
- Modify: `gateway/tests/unit/gateway-db-salience.test.ts`
- Modify: `gateway/tests/unit/recall/segmentation-wiring.test.ts`
- Modify: `gateway/tests/unit/routes/obs-wiring.test.ts`
- Test: `gateway/tests/unit/gateway-db-t1-observation-identity.test.ts` (create)

**Interfaces:**
- Consumes: `T1Turn`, `beginTurn`, `currentTurn` from Task 1.
- Produces:

```ts
export interface T1Observation {
  id: number;
  session_id: string;
  turn_id: number;
  trace_id: string;
  observation_key: string;
  source: ObservationSource;
  content: string;
  failure: number;
  salience?: number | null;
  created_at: number;
}

append(obs: {
  session_id: string;
  turn_id: number;
  trace_id: string;
  observation_key?: string;
  source: ObservationSource;
  content: string;
  failure: number;
  salience?: number | null;
}): number | null;
```

- `append` throws `trace_id required` when missing/empty and `unknown trace_id: <id>` when no `t1_turns` row matches.
- A missing `observation_key` becomes `t1o_${randomUUID()}`.
- Appending raises `t1_turns.encoding_salience` to the maximum supplied salience.
- Capture response is additive: `{ ok, id, turnId, traceId, deduped }` for stored rows; blank content keeps the existing no-turn response.

- [ ] **Step 1: Write the failing observation identity test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('T1 observation identity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-obs-id-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('append stores the trace, generates a stable observation key, and updates salience', () => {
    const t = db.beginTurn('s1', 0.4);
    const id = db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'tool_result', content: 'output', failure: 0, salience: 0.9,
    });
    expect(id).not.toBeNull();
    const row = db.readTurn('s1', t.turn_seq)[0];
    expect(row.trace_id).toBe(t.trace_id);
    expect(row.observation_key).toMatch(/^t1o_/);
    expect(row.salience).toBeCloseTo(0.9, 6);
    expect(db.currentTurn('s1')?.encoding_salience).toBeCloseTo(0.9, 6);
  });

  test('append rejects missing or unknown trace ids', () => {
    expect(() => db.append({
      session_id: 's1', turn_id: 1, source: 'user_input', content: 'x', failure: 0,
    } as any)).toThrow('trace_id required');
    expect(() => db.append({
      session_id: 's1', turn_id: 1, trace_id: 't1t_missing',
      source: 'user_input', content: 'x', failure: 0,
    })).toThrow('unknown trace_id');
  });

});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-observation-identity.test.ts`
Expected: FAIL because `T1Observation` has no trace/key fields and `append` does not validate or generate them.

- [ ] **Step 3: Implement observation identity and update the capture route**

In `GatewayDatabase.append`, validate the trace, generate `t1o_${randomUUID()}`, insert the new columns, raise turn encoding salience, and preserve `INSERT OR IGNORE` dedup. In `routes/obs.ts`, redact and compute salience before allocating the turn; call `beginTurn` for `user_input`, and `currentTurn(...) ?? beginTurn(...)` for other sources; pass `trace_id` into `append`; include `traceId` in the stored response. Update the three existing direct-append tests to call `beginTurn` and pass the returned trace. Update the fake DB in `obs-wiring.test.ts` to implement `beginTurn`/`currentTurn` and assert both the stored `trace_id` and returned `traceId`.

- [ ] **Step 4: Run the focused tests**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-observation-identity.test.ts tests/unit/gateway-db-salience.test.ts tests/unit/recall/segmentation-wiring.test.ts tests/unit/routes/obs-wiring.test.ts`
Expected: PASS. Existing blank-content, recursion-guard, oversized-body, prefetch, and fail-open tests remain green.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/routes/obs.ts gateway/tests/unit/gateway-db-t1-observation-identity.test.ts gateway/tests/unit/gateway-db-salience.test.ts gateway/tests/unit/recall/segmentation-wiring.test.ts gateway/tests/unit/routes/obs-wiring.test.ts
git commit -m "feat(memory): stable T1 observation identity in capture"
```

---

### Task 3: Archive Fidelity and Trace Reads

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (`archiveTurn`, T1 read methods)
- Test: `gateway/tests/unit/gateway-db-t1-archive-identity.test.ts` (create)

**Interfaces:**
- Consumes: `T1Turn`, `T1Observation`, `beginTurn`, `append`.
- Produces:

```ts
export interface T1TraceRead {
  turn: T1Turn;
  rows: T1Observation[];
  archived: boolean;
}

readTrace(trace_id: string): T1TraceRead | null;
```

- `archiveTurn` moves rows inside one transaction and copies `trace_id`, `observation_key`, and `salience` into `t1_archive`; it then stamps `t1_turns.archived_at`.
- `append` clears `archived_at` when a late observation arrives for the turn (reopening it without changing identity).
- `readTrace` combines active and archived rows, ordered by `created_at` then stable row id within each source, and returns `archived` from the turn metadata.
- Existing `readArchiveTurn`, `searchArchive`, `findArchiveBySessionTail`, and `readTurn` signatures remain unchanged.

- [ ] **Step 1: Write the failing archive test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('T1 archive identity fidelity', () => {
  let dir: string;
  let db: GatewayDatabase;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-archive-id-'));
    db = new GatewayDatabase(path.join(dir, 'test.db'));
  });
  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('archive preserves trace, observation key and salience', () => {
    const t = db.beginTurn('s1', 0.6);
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'question', failure: 0, salience: 0.6,
    });
    const before = db.readTurn('s1', t.turn_seq)[0];
    expect(db.archiveTurn('s1', t.turn_seq)).toBe(1);

    const after = db.readArchiveTurn('s1', t.turn_seq)[0];
    expect(after.trace_id).toBe(before.trace_id);
    expect(after.observation_key).toBe(before.observation_key);
    expect(after.salience).toBeCloseTo(0.6, 6);
    expect(db.currentTurn('s1')?.archived_at).not.toBeNull();
  });

  test('readTrace works before and after archival', () => {
    const t = db.beginTurn('s1');
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'q', failure: 0,
    });
    expect(db.readTrace(t.trace_id)?.archived).toBe(false);
    db.archiveTurn('s1', t.turn_seq);
    const read = db.readTrace(t.trace_id);
    expect(read?.turn.trace_id).toBe(t.trace_id);
    expect(read?.rows.map((r) => r.content)).toEqual(['q']);
    expect(read?.archived).toBe(true);
    expect(db.readTrace('t1t_missing')).toBeNull();
  });

  test('late append reopens the archived turn and keeps the same trace', () => {
    const t = db.beginTurn('s1');
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'user_input', content: 'ask', failure: 0,
    });
    db.archiveTurn('s1', t.turn_seq);
    expect(db.currentTurn('s1')?.archived_at).not.toBeNull();
    db.append({
      session_id: 's1', turn_id: t.turn_seq, trace_id: t.trace_id,
      source: 'tool_result', content: 'late', failure: 0,
    });
    expect(db.currentTurn('s1')?.archived_at).toBeNull();
    expect(db.readTrace(t.trace_id)?.rows.map((r) => r.content)).toEqual(['ask', 'late']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-archive-identity.test.ts`
Expected: FAIL because `t1_archive` does not carry the new fields and `readTrace` does not exist.

- [ ] **Step 3: Implement archive fidelity and trace reads**

Extend fresh and migrated schemas for `t1_archive` with `trace_id`, `observation_key`, and `salience`. Copy those fields in the existing archive transaction, stamp `t1_turns.archived_at`, clear it in `append` on a late observation, and implement `readTrace` as an active+archive lookup. Do not change the old pointer/search methods.

- [ ] **Step 4: Run the focused test**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-archive-identity.test.ts tests/unit/source-reconstruction-db.test.ts tests/unit/mcp/get-memory-t1.test.ts`
Expected: PASS; old archive search and T1 pointer behavior remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-archive-identity.test.ts
git commit -m "feat(memory): preserve T1 identity through archival"
```

---

### Task 4: Legacy Backfill and Ambiguity Marking

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts` (constructor migrations, private backfill)
- Test: `gateway/tests/unit/gateway-db-t1-legacy-migration.test.ts` (create)

**Interfaces:**
- Consumes: all Task 1–3 schema and methods.
- Produces: constructor-time, idempotent `migrateT1Identity()` with these rules:
  - one `t1_turns` row per existing `(session_id, turn_id)` composite;
  - deterministic legacy trace `t1l_<sha1(session_id + NUL + turn_id).slice(0,20)>`;
  - `legacy_ambiguous = 1` when the composite contains more than one `user_input`, or exists in both active and archive tables;
  - all legacy observation rows receive their composite trace and a table-scoped legacy observation key;
  - next allocated sequence is greater than every legacy sequence.

- [ ] **Step 1: Write the failing migration test**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { GatewayDatabase } from '../../src/memory/gateway-db';

function makeLegacyDb(file: string): void {
  const raw = new Database(file);
  raw.exec(`
    CREATE TABLE t1_observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      failure INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(session_id, turn_id, source, content)
    );
    CREATE TABLE t1_archive (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      turn_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      content TEXT NOT NULL,
      failure INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      archived_at INTEGER DEFAULT (unixepoch())
    );
  `);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'user_input', 'first', 0, 1);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'user_input', 'second', 0, 2);
  raw.prepare(`INSERT INTO t1_archive (session_id, turn_id, source, content, failure, created_at)
               VALUES (?,?,?,?,?,?)`).run('s1', 1, 'assistant_reply', 'answer', 0, 3);
  raw.prepare(`INSERT INTO t1_observations (session_id, turn_id, source, content, failure)
               VALUES (?,?,?,?,?)`).run('s1', 1, 'user_input', 'third live epoch', 0);
  raw.close();
}

describe('T1 legacy identity migration', () => {
  test('marks duplicate legacy turns and links every row without merging content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't1-legacy-'));
    const file = path.join(dir, 'legacy.db');
    makeLegacyDb(file);

    const db = new GatewayDatabase(file);
    const turn = db.currentTurn('s1');
    expect(turn?.legacy_ambiguous).toBe(1);
    expect(turn?.trace_id).toMatch(/^t1l_/);
    const active = db.readTurn('s1', 1);
    const archived = db.readArchiveTurn('s1', 1);
    expect(active[0].trace_id).toBe(turn?.trace_id);
    expect(archived.every((r) => r.trace_id === turn?.trace_id)).toBe(true);
    expect(active[0].observation_key).not.toBe(archived[0].observation_key);
    expect(db.nextTurnId('s1')).toBe(2);
    expect(db.beginTurn('s1').turn_seq).toBe(2);

    db.close();
    const reopened = new GatewayDatabase(file);
    const legacyTurn = (reopened as any).getStore()
      .prepare("SELECT legacy_ambiguous FROM t1_turns WHERE trace_id LIKE 't1l_%'")
      .get() as { legacy_ambiguous: number };
    expect(legacyTurn.legacy_ambiguous).toBe(1);
    expect(reopened.nextTurnId('s1')).toBe(3);
    reopened.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

> Amendment after Task 4 review: the original reopen assertion called
> `currentTurn('s1')` after `beginTurn('s1')` had already created turn 2, so it
> could never observe the legacy turn's `legacy_ambiguous=1`. The query-based
> check above is the equivalent idempotency assertion used by the implementation.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-legacy-migration.test.ts`
Expected: FAIL because legacy rows have no `t1_turns` row and no trace/key columns.

- [ ] **Step 3: Implement the idempotent legacy migration**

After column migrations and before normal use, run one transaction that groups the union of active/archive rows by `(session_id, turn_id)`. Insert missing `t1_turns` rows with `INSERT OR IGNORE`, deterministic `t1l_` traces, archived/salience metadata, and the ambiguity rule above. Backfill only rows whose `trace_id` is null; backfill missing observation keys as `t1o_legacy_active_<id>` or `t1o_legacy_archive_<id>`. Create trace/observation-key indexes after the ALTERs. Wrap the migration so a failure is logged and does not prevent gateway startup, but do not partially commit the transaction.

- [ ] **Step 4: Run migration and identity tests**

Run: `cd gateway; npx jest --runInBand tests/unit/gateway-db-t1-legacy-migration.test.ts tests/unit/gateway-db-t1-identity.test.ts tests/unit/gateway-db-t1-observation-identity.test.ts tests/unit/gateway-db-t1-archive-identity.test.ts tests/unit/gateway-db-salience.test.ts`
Expected: PASS, including reopen idempotency.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/tests/unit/gateway-db-t1-legacy-migration.test.ts
git commit -m "feat(memory): migrate legacy T1 identities without guessing"
```

---

### Task 5: Full Regression, Production Migration Verification, and Release Note

**Files:**
- Modify: `docs/releases/2026-11-10-t1-identity.md` (create)
- No additional source files.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: a verified branch and an honest release record of the identity fix and its unresolved later phases.

- [ ] **Step 1: Run the full gateway suite**

Run: `cd gateway; npx jest --runInBand --forceExit`
Expected: all suites pass. Record the exact passing count; do not report a count from an earlier run.

- [ ] **Step 2: Run the type and build gates**

Run: `cd gateway; npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

Run from repo root: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Verify a copy of the real database before deployment**

Do not mutate `~/.mafw/memory/gateway.db`. Open it read-only with better-sqlite3 and use its `backup(tempPath)` API (not a raw file copy, which can miss WAL state), then instantiate `GatewayDatabase` against the backup and record:

- `t1_turns` count;
- ambiguous legacy turn count;
- rows missing `trace_id` (must be 0 after migration);
- next sequence for the sessions that previously reused turn 1.

Do not proceed to deployment if migration changes the active/archive row counts (excluding the new `t1_turns` table), throws, or leaves trace IDs null.

- [ ] **Step 4: Stop before deployment**

Do not deploy from this task. Deployment is a production side effect and must
wait until the whole-branch final review is clean. The controller performs the
verified deployment after that review.

- [ ] **Step 5: Write the release note**

Create `docs/releases/2026-11-10-t1-identity.md` with the implemented identity contract, migration behavior, test counts, type/build results, verification numbers, and an explicit "not yet implemented" list: T1 direct search, activation, provenance propagation, raw replay, and skill capability changes.

- [ ] **Step 6: Commit**

```bash
git add docs/releases/2026-11-10-t1-identity.md
git commit -m "docs(memory): record T1 identity migration"
```
