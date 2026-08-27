# Goal Outcome Observability (RSI Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add structured outcome recording to every goal lifecycle endpoint (archive success/failure/ABORT) so Phase 2 evolution loops have data to evaluate against.

**Architecture:** Three new SQLite tables (`goal_outcomes`, `goal_sessions`, `evolution_proposals`) in the existing `GatewayDatabase`; an `OutcomeRecorder` module that aggregates cost/feedback/trajectory data at archive time; policy version snapshot at goal creation; component registry for future evolvable parameters. All writes are fail-open (never block the goal lifecycle).

**Tech Stack:** TypeScript, better-sqlite3 (synchronous in-process SQLite), Jest + ts-jest, fs-based state files, Node.js `path`/`fs` modules.

## Global Constraints

- **Fail-open everywhere**: outcome/session writes must never throw to the caller; catch-and-log only
- **Upsert idempotency**: `goal_outcomes.goal_id` is PRIMARY KEY; duplicate archive updates the same row
- **No behavior change**: Phase 1 is pure observability; existing goal lifecycle logic stays identical
- **Prune exemption**: trajectory TTL (14 days) must not delete sessions registered in `goal_sessions`
- **Policy snapshot at creation**: `policy_version` + `evolution_proposal_id` snapshot into request file at goal creation, NOT at archive time
- **Route regex**: all new HTTP routes must use `(?:\?|$)` suffix pattern (AGENTS.md section 6.5)
- **Test framework**: Jest with ts-jest, `beforeEach`/`afterEach` for setup/teardown, in-memory SQLite (`:memory:`) for DB tests

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `gateway/src/memory/gateway-db.ts` | Modify | +3 tables: `goal_outcomes`, `goal_sessions`, `evolution_proposals`; CRUD methods |
| `gateway/src/orchestration/policy.ts` | Create | `getActivePolicy()` — reads `~/.mafw/orchestration/active.json` |
| `gateway/src/orchestration/registry.ts` | Create | `OrchestrationComponent` registry — declares evolvable components |
| `gateway/src/orchestration/outcome-recorder.ts` | Create | `OutcomeRecorder` — aggregates and writes goal outcomes |
| `gateway/src/core/engine/phase-orchestrator.ts` | Modify | `recordSession()` appends to `goal_sessions` table |
| `gateway/src/trajectory/trajectory-store.ts` | Modify | `pruneOlderThan()` exempts goal-registered sessions |
| `gateway/src/index.ts` | Modify | Policy snapshot on create; `recordOutcome()` calls in archive/ABORT; API route |
| `tests/unit/gateway/outcome-recorder.test.ts` | Create | Aggregation, upsert idempotency, fail-open, failure signature |
| `tests/unit/gateway/goal-sessions.test.ts` | Create | Append semantics, cross-loop persistence, prune exemption |
| `tests/unit/gateway/policy.test.ts` | Create | active.json missing/corrupt/normal branches |
| `tests/unit/gateway/registry.test.ts` | Create | Component ID uniqueness, source location validity |

---

### Task 1: Gateway Database Schema — goal_outcomes, goal_sessions, evolution_proposals

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts:42-174` (add tables in constructor, CRUD methods after line 382)
- Test: `tests/unit/gateway/goal-db.test.ts` (create new)

**Interfaces:**
- Consumes: nothing new (uses existing `GatewayDatabase` class)
- Produces: `upsertOutcome(outcome)`, `getOutcome(goalId)`, `listOutcomes(filters)`, `upsertGoalSession(row)`, `listGoalSessions(goalId)`, `listGoalSessionIds()`, `createEvolutionProposal(proposal)`, `getEvolutionProposal(id)`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/goal-db.test.ts`:

```typescript
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';

let db: GatewayDatabase;

beforeEach(() => {
  db = new GatewayDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('goal_outcomes', () => {
  test('upsertOutcome inserts and updates idempotently', () => {
    db.upsertOutcome({
      goal_id: 'g1',
      project_id: 'proj-1',
      verdict: 'PASS',
      rounds: 3,
      duration_ms: 60000,
      policy_version: 'builtin-v1',
      created_at: new Date().toISOString(),
      archived_at: new Date().toISOString(),
    });

    const row = db.getOutcome('g1');
    expect(row).not.toBeNull();
    expect(row!.verdict).toBe('PASS');
    expect(row!.rounds).toBe(3);

    db.upsertOutcome({
      goal_id: 'g1',
      project_id: 'proj-1',
      verdict: 'FAIL',
      rounds: 5,
      duration_ms: 90000,
      policy_version: 'builtin-v1',
      created_at: new Date().toISOString(),
      archived_at: new Date().toISOString(),
    });

    const updated = db.getOutcome('g1');
    expect(updated!.verdict).toBe('FAIL');
    expect(updated!.rounds).toBe(5);
  });

  test('listOutcomes filters by verdict and project', () => {
    db.upsertOutcome({ goal_id: 'g1', project_id: 'p1', verdict: 'PASS', rounds: 1, duration_ms: 1000, policy_version: 'builtin-v1', created_at: '2026-08-27T00:00:00Z', archived_at: '2026-08-27T01:00:00Z' });
    db.upsertOutcome({ goal_id: 'g2', project_id: 'p1', verdict: 'FAIL', rounds: 2, duration_ms: 2000, policy_version: 'builtin-v1', created_at: '2026-08-27T00:00:00Z', archived_at: '2026-08-27T01:00:00Z' });
    db.upsertOutcome({ goal_id: 'g3', project_id: 'p2', verdict: 'PASS', rounds: 1, duration_ms: 1000, policy_version: 'builtin-v1', created_at: '2026-08-27T00:00:00Z', archived_at: '2026-08-27T01:00:00Z' });

    const passOnly = db.listOutcomes({ verdict: 'PASS' });
    expect(passOnly).toHaveLength(2);

    const projOnly = db.listOutcomes({ project_id: 'p1' });
    expect(projOnly).toHaveLength(2);

    const both = db.listOutcomes({ verdict: 'PASS', project_id: 'p1' });
    expect(both).toHaveLength(1);
    expect(both[0].goal_id).toBe('g1');
  });

  test('listOutcomes respects limit', () => {
    for (let i = 0; i < 10; i++) {
      db.upsertOutcome({ goal_id: `g${i}`, project_id: 'p1', verdict: 'PASS', rounds: 1, duration_ms: 1000, policy_version: 'builtin-v1', created_at: '2026-08-27T00:00:00Z', archived_at: '2026-08-27T01:00:00Z' });
    }
    const limited = db.listOutcomes({ limit: 3 });
    expect(limited).toHaveLength(3);
  });
});

describe('goal_sessions', () => {
  test('upsertGoalSession appends and is idempotent on PK', () => {
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1, created_at: '2026-08-27T00:00:00Z' });
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'execute', loop: 1, created_at: '2026-08-27T00:01:00Z' });
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's3', phase: 'plan', loop: 2, created_at: '2026-08-27T00:02:00Z' });

    const sessions = db.listGoalSessions('g1');
    expect(sessions).toHaveLength(3);
  });

  test('upsertGoalSession deduplicates on same goal_id + session_id', () => {
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1, created_at: '2026-08-27T00:00:00Z' });
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1, created_at: '2026-08-27T00:00:00Z' });

    const sessions = db.listGoalSessions('g1');
    expect(sessions).toHaveLength(1);
  });

  test('listGoalSessionIds returns all distinct session IDs', () => {
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1, created_at: '2026-08-27T00:00:00Z' });
    db.upsertGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'execute', loop: 1, created_at: '2026-08-27T00:01:00Z' });
    db.upsertGoalSession({ goal_id: 'g2', session_id: 's3', phase: 'plan', loop: 1, created_at: '2026-08-27T00:02:00Z' });

    const ids = db.listGoalSessionIds();
    expect(ids).toHaveLength(3);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
    expect(ids).toContain('s3');
  });
});

describe('evolution_proposals', () => {
  test('createEvolutionProposal and getEvolutionProposal round-trip', () => {
    db.createEvolutionProposal({
      id: 'prop-1',
      requires: 'policy',
      component_diffs: JSON.stringify([{ component_id: 'review.samematch_threshold', field: 'threshold', from: '2', to: '3' }]),
      declared_prediction: 'review_false_fail ratio drops from 40% to <25%',
      rationale: 'Lowering threshold reduces false negatives',
      status: 'proposed',
      created_at: '2026-08-27T00:00:00Z',
      updated_at: '2026-08-27T00:00:00Z',
    });

    const row = db.getEvolutionProposal('prop-1');
    expect(row).not.toBeNull();
    expect(row!.status).toBe('proposed');
    expect(row!.requires).toBe('policy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/goal-db.test.ts --no-coverage`
Expected: FAIL with `TypeError: db.upsertOutcome is not a function`

- [ ] **Step 3: Add table DDL to GatewayDatabase constructor**

In `gateway/src/memory/gateway-db.ts`, add three `CREATE TABLE IF NOT EXISTS` statements inside the `this.db.exec(...)` block, after the `t1_noop_log` table (before the closing backtick at line 153):

```sql
CREATE TABLE IF NOT EXISTS goal_outcomes (
  goal_id TEXT PRIMARY KEY,
  project_id TEXT,
  verdict TEXT NOT NULL,
  rounds INTEGER DEFAULT 0,
  duration_ms INTEGER,
  tokens_input INTEGER,
  tokens_output INTEGER,
  total_cost REAL,
  tool_error_count INTEGER,
  thumbs_up INTEGER DEFAULT 0,
  thumbs_down INTEGER DEFAULT 0,
  policy_version TEXT NOT NULL,
  evolution_proposal_id TEXT,
  failure_kind TEXT,
  failure_signature TEXT,
  created_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outcomes_policy_verdict ON goal_outcomes(policy_version, verdict);
CREATE INDEX IF NOT EXISTS idx_outcomes_project_policy ON goal_outcomes(project_id, policy_version);

CREATE TABLE IF NOT EXISTS goal_sessions (
  goal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  loop INTEGER NOT NULL,
  created_at TEXT,
  PRIMARY KEY (goal_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_goal ON goal_sessions(goal_id);

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY,
  requires TEXT DEFAULT 'policy',
  component_diffs TEXT,
  declared_prediction TEXT,
  rationale TEXT,
  status TEXT NOT NULL,
  validation_result TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

- [ ] **Step 4: Add CRUD methods to GatewayDatabase**

Add these methods after the `kvAll` method (before `close()` at line 384):

```typescript
  // ── Goal outcomes ───────────────────────────────────────────────────────

  upsertOutcome(outcome: {
    goal_id: string;
    project_id: string | null;
    verdict: string;
    rounds: number;
    duration_ms: number | null;
    tokens_input?: number | null;
    tokens_output?: number | null;
    total_cost?: number | null;
    tool_error_count?: number | null;
    thumbs_up?: number;
    thumbs_down?: number;
    policy_version: string;
    evolution_proposal_id?: string | null;
    failure_kind?: string | null;
    failure_signature?: string | null;
    created_at: string;
    archived_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO goal_outcomes
          (goal_id, project_id, verdict, rounds, duration_ms, tokens_input, tokens_output,
           total_cost, tool_error_count, thumbs_up, thumbs_down, policy_version,
           evolution_proposal_id, failure_kind, failure_signature, created_at, archived_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(goal_id) DO UPDATE SET
           verdict = excluded.verdict,
           rounds = excluded.rounds,
           duration_ms = excluded.duration_ms,
           tokens_input = excluded.tokens_input,
           tokens_output = excluded.tokens_output,
           total_cost = excluded.total_cost,
           tool_error_count = excluded.tool_error_count,
           thumbs_up = excluded.thumbs_up,
           thumbs_down = excluded.thumbs_down,
           failure_kind = excluded.failure_kind,
           failure_signature = excluded.failure_signature,
           archived_at = excluded.archived_at`,
      )
      .run(
        outcome.goal_id,
        outcome.project_id ?? null,
        outcome.verdict,
        outcome.rounds,
        outcome.duration_ms ?? null,
        outcome.tokens_input ?? null,
        outcome.tokens_output ?? null,
        outcome.total_cost ?? null,
        outcome.tool_error_count ?? null,
        outcome.thumbs_up ?? 0,
        outcome.thumbs_down ?? 0,
        outcome.policy_version,
        outcome.evolution_proposal_id ?? null,
        outcome.failure_kind ?? null,
        outcome.failure_signature ?? null,
        outcome.created_at,
        outcome.archived_at,
      );
  }

  getOutcome(goalId: string): any | null {
    return this.db.prepare('SELECT * FROM goal_outcomes WHERE goal_id = ?').get(goalId) ?? null;
  }

  listOutcomes(filters: { verdict?: string; project_id?: string; policy_version?: string; limit?: number } = {}): any[] {
    const conditions: string[] = [];
    const params: any[] = [];
    if (filters.verdict) { conditions.push('verdict = ?'); params.push(filters.verdict); }
    if (filters.project_id) { conditions.push('project_id = ?'); params.push(filters.project_id); }
    if (filters.policy_version) { conditions.push('policy_version = ?'); params.push(filters.policy_version); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    return this.db
      .prepare(`SELECT * FROM goal_outcomes ${where} ORDER BY archived_at DESC LIMIT ?`)
      .all(...params, limit);
  }

  // ── Goal sessions ───────────────────────────────────────────────────────

  upsertGoalSession(row: { goal_id: string; session_id: string; phase: string; loop: number; created_at: string }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO goal_sessions (goal_id, session_id, phase, loop, created_at)
         VALUES (?,?,?,?,?)`,
      )
      .run(row.goal_id, row.session_id, row.phase, row.loop, row.created_at);
  }

  listGoalSessions(goalId: string): any[] {
    return this.db
      .prepare('SELECT * FROM goal_sessions WHERE goal_id = ? ORDER BY created_at')
      .all(goalId);
  }

  listGoalSessionIds(): string[] {
    const rows = this.db
      .prepare('SELECT DISTINCT session_id FROM goal_sessions')
      .all() as { session_id: string }[];
    return rows.map((r) => r.session_id);
  }

  // ── Evolution proposals ─────────────────────────────────────────────────

  createEvolutionProposal(proposal: {
    id: string;
    requires: string;
    component_diffs: string;
    declared_prediction: string;
    rationale: string;
    status: string;
    validation_result?: string | null;
    created_at: string;
    updated_at: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO evolution_proposals
          (id, requires, component_diffs, declared_prediction, rationale, status, validation_result, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        proposal.id,
        proposal.requires,
        proposal.component_diffs,
        proposal.declared_prediction,
        proposal.rationale,
        proposal.status,
        proposal.validation_result ?? null,
        proposal.created_at,
        proposal.updated_at,
      );
  }

  getEvolutionProposal(id: string): any | null {
    return this.db.prepare('SELECT * FROM evolution_proposals WHERE id = ?').get(id) ?? null;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/goal-db.test.ts --no-coverage`
Expected: PASS (all tests green)

- [ ] **Step 6: Commit**

```bash
git add gateway/src/memory/gateway-db.ts tests/unit/gateway/goal-db.test.ts
git commit -m "feat(orchestration): add goal_outcomes, goal_sessions, evolution_proposals tables"
```

---

### Task 2: Policy Module — getActivePolicy()

**Files:**
- Create: `gateway/src/orchestration/policy.ts`
- Test: `tests/unit/gateway/policy.test.ts` (create new)

**Interfaces:**
- Consumes: `fs`, `path`, `config` (from `../config`)
- Produces: `getActivePolicy(): { version: string; proposalId: string | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/policy.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let tmpMafwDir: string;

beforeEach(() => {
  tmpMafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-policy-'));
  jest.resetModules();
  jest.mock('../../../gateway/src/config', () => ({
    config: { resolvePath: (...segs: string[]) => path.join(tmpMafwDir, ...segs) },
  }));
});

afterEach(() => {
  fs.rmSync(tmpMafwDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

test('returns builtin-v1 when active.json does not exist', () => {
  const { getActivePolicy } = require('../../../gateway/src/orchestration/policy');
  const result = getActivePolicy();
  expect(result.version).toBe('builtin-v1');
  expect(result.proposalId).toBeNull();
});

test('returns builtin-v1 when active.json is corrupt', () => {
  const orchDir = path.join(tmpMafwDir, 'orchestration');
  fs.mkdirSync(orchDir, { recursive: true });
  fs.writeFileSync(path.join(orchDir, 'active.json'), 'NOT JSON{{{');

  const { getActivePolicy } = require('../../../gateway/src/orchestration/policy');
  const result = getActivePolicy();
  expect(result.version).toBe('builtin-v1');
  expect(result.proposalId).toBeNull();
});

test('reads version and proposalId from valid active.json', () => {
  const orchDir = path.join(tmpMafwDir, 'orchestration');
  fs.mkdirSync(orchDir, { recursive: true });
  fs.writeFileSync(
    path.join(orchDir, 'active.json'),
    JSON.stringify({ version: 'v2-evolved', proposalId: 'prop-42' }),
  );

  const { getActivePolicy } = require('../../../gateway/src/orchestration/policy');
  const result = getActivePolicy();
  expect(result.version).toBe('v2-evolved');
  expect(result.proposalId).toBe('prop-42');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/policy.test.ts --no-coverage`
Expected: FAIL with `Cannot find module '../../../gateway/src/orchestration/policy'`

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/orchestration/policy.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export interface ActivePolicy {
  version: string;
  proposalId: string | null;
}

const FALLBACK: ActivePolicy = { version: 'builtin-v1', proposalId: null };

export function getActivePolicy(): ActivePolicy {
  try {
    const filePath = path.join(config.resolvePath('orchestration/active.json'));
    if (!fs.existsSync(filePath)) return FALLBACK;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!raw || typeof raw.version !== 'string') return FALLBACK;
    return { version: raw.version, proposalId: raw.proposalId ?? null };
  } catch {
    return FALLBACK;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/policy.test.ts --no-coverage`
Expected: PASS (3 tests green)

If the `config.resolvePath` doesn't accept a relative string, adjust to use `path.join(os.homedir(), '.mafw', 'orchestration', 'active.json')` directly. Check `config.ts` line 459 for the actual `resolvePath` signature.

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/policy.ts tests/unit/gateway/policy.test.ts
git commit -m "feat(orchestration): add policy module with active.json fallback"
```

---

### Task 3: Component Registry — evolvable components declaration

**Files:**
- Create: `gateway/src/orchestration/registry.ts`
- Test: `tests/unit/gateway/registry.test.ts` (create new)

**Interfaces:**
- Consumes: `fs` (for grep-based source validation)
- Produces: `OrchestrationComponent`, `REGISTRY`, `getRegistry()`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/registry.test.ts`:

```typescript
import { REGISTRY, getRegistry } from '../../../gateway/src/orchestration/registry';

test('all component IDs are unique', () => {
  const ids = REGISTRY.map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('each component has valid kind', () => {
  const validKinds = ['prompt', 'threshold', 'model_route', 'parameter'];
  for (const c of REGISTRY) {
    expect(validKinds).toContain(c.kind);
  }
});

test('each component declares evolvablePhase 2 or 3', () => {
  for (const c of REGISTRY) {
    expect([2, 3]).toContain(c.evolvablePhase);
  }
});

test('getRegistry returns a copy of the full array', () => {
  const result = getRegistry();
  expect(result).toEqual(REGISTRY);
  expect(result).not.toBe(REGISTRY);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/registry.test.ts --no-coverage`
Expected: FAIL with `Cannot find module '../../../gateway/src/orchestration/registry'`

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/orchestration/registry.ts`:

```typescript
export interface OrchestrationComponent {
  id: string;
  kind: 'prompt' | 'threshold' | 'model_route' | 'parameter';
  currentValueSource: string;
  evolvablePhase: 2 | 3;
}

export const REGISTRY: OrchestrationComponent[] = [
  {
    id: 'plan.prompt',
    kind: 'prompt',
    currentValueSource: 'core/skills/mafw-plan/entry.ts::buildPlanPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.prompt',
    kind: 'prompt',
    currentValueSource: 'core/skills/mafw-review/entry.ts::buildReviewPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.samematch_threshold',
    kind: 'threshold',
    currentValueSource: 'core/langgraph/nodes/review.node.ts:66 (>= 2)',
    evolvablePhase: 2,
  },
  {
    id: 'review.verdict_parse',
    kind: 'parameter',
    currentValueSource: 'core/langgraph/nodes/review.node.ts::parseReviewVerdict',
    evolvablePhase: 2,
  },
  {
    id: 'loop.max_rounds',
    kind: 'parameter',
    currentValueSource: 'config.ts::loop.maxRounds (default 3)',
    evolvablePhase: 2,
  },
  {
    id: 'loop.stuck_timeout',
    kind: 'parameter',
    currentValueSource: 'config.ts::timeouts.stuckLoopTimeout',
    evolvablePhase: 2,
  },
  {
    id: 'execute.degradation_l3',
    kind: 'threshold',
    currentValueSource: 'core/engine/degradation.ts::checkL3Oscillation',
    evolvablePhase: 2,
  },
];

export function getRegistry(): OrchestrationComponent[] {
  return [...REGISTRY];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/registry.test.ts --no-coverage`
Expected: PASS (4 tests green)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/registry.ts tests/unit/gateway/registry.test.ts
git commit -m "feat(orchestration): add component registry with initial 7 evolvable components"
```

---

### Task 4: Phase Orchestrator Hook — goal_sessions append

**Files:**
- Modify: `gateway/src/core/engine/phase-orchestrator.ts:53-67` (recordSession function)
- Test: `tests/unit/gateway/goal-sessions.test.ts` (create new)

**Interfaces:**
- Consumes: `GatewayDatabase.upsertGoalSession()` (from Task 1)
- Produces: `recordSession()` now also writes to `goal_sessions` table

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/goal-sessions.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { recordSession, startNextLoop } from '../../../gateway/src/core/engine/phase-orchestrator';
import { initState } from '../../../gateway/src/core/utils/state';

let tmpDir: string;
let db: GatewayDatabase;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-gs-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'requests'), { recursive: true });
  initState('001-auth', tmpDir);
  fs.writeFileSync(
    path.join(tmpDir, '.mafw', 'requests', '001-auth.json'),
    JSON.stringify({ maxLoops: 5 }),
  );
  db = new GatewayDatabase(':memory:');
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('recordSession appends to goal_sessions table', async () => {
  await recordSession('001-auth', 'plan', 'sess-1', tmpDir, db);
  await recordSession('001-auth', 'execute', 'sess-2', tmpDir, db);
  await recordSession('001-auth', 'review', 'sess-3', tmpDir, db);

  const sessions = db.listGoalSessions('001-auth');
  expect(sessions).toHaveLength(3);
  expect(sessions.map((s: any) => s.session_id).sort()).toEqual(['sess-1', 'sess-2', 'sess-3']);
});

test('recordSession persists across startNextLoop (sessions not cleared)', async () => {
  await recordSession('001-auth', 'plan', 'sess-1', tmpDir, db);
  await recordSession('001-auth', 'execute', 'sess-2', tmpDir, db);

  await startNextLoop('001-auth', tmpDir);

  await recordSession('001-auth', 'plan', 'sess-4', tmpDir, db);

  const sessions = db.listGoalSessions('001-auth');
  expect(sessions).toHaveLength(3);
});

test('recordSession is fail-open when db is null', async () => {
  const state = await recordSession('001-auth', 'plan', 'sess-1', tmpDir, null as any);
  expect(state.sessions.plan.id).toBe('sess-1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/goal-sessions.test.ts --no-coverage`
Expected: FAIL — `recordSession` does not accept a 5th parameter

- [ ] **Step 3: Modify recordSession to accept optional db and write goal_sessions**

In `gateway/src/core/engine/phase-orchestrator.ts`, modify the `recordSession` function (lines 53-67):

```typescript
export async function recordSession(
  goalId: string,
  phase: string,
  sessionId: string,
  projectDir: string = '.',
  db?: { upsertGoalSession: (row: any) => void } | null
): Promise<StateFile> {
  const state = await loadState(goalId, projectDir);
  const sessions = { ...state.sessions };
  sessions[phase] = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    active: true
  };

  try {
    db?.upsertGoalSession({
      goal_id: goalId,
      session_id: sessionId,
      phase,
      loop: state.loop,
      created_at: new Date().toISOString(),
    });
  } catch (err: any) {
    // fail-open: never block goal lifecycle
  }

  return updateState(goalId, { sessions }, projectDir);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/goal-sessions.test.ts --no-coverage`
Expected: PASS (3 tests green)

- [ ] **Step 5: Verify existing phase-orchestrator tests still pass**

Run: `npx jest tests/unit/engine/phase-orchestrator.test.ts --no-coverage`
Expected: PASS (existing tests unchanged, optional param is backward compatible)

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/engine/phase-orchestrator.ts tests/unit/gateway/goal-sessions.test.ts
git commit -m "feat(orchestration): recordSession appends goal_sessions for cross-loop cost tracking"
```

---

### Task 5: Trajectory Store — prune exemption for goal sessions

**Files:**
- Modify: `gateway/src/trajectory/trajectory-store.ts:196-200` (pruneOlderThan method)
- Test: `tests/unit/gateway/trajectory-prune.test.ts` (create new)

**Interfaces:**
- Consumes: `GatewayDatabase.listGoalSessionIds()` (from Task 1)
- Produces: `pruneOlderThan(days, exemptSessionIds?)` — new optional parameter

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/trajectory-prune.test.ts`:

```typescript
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';

let db: GatewayDatabase;
let store: TrajectoryStore;

beforeEach(() => {
  db = new GatewayDatabase(':memory:');
  store = new TrajectoryStore(db, 'proj-1');
});

afterEach(() => {
  db.close();
});

test('pruneOlderThan deletes old events', () => {
  const old = Math.floor(Date.now() / 1000) - 20 * 86400;
  (db as any).db
    .prepare('INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, tool_count, tokens, cost, finish, model, agent, user_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('proj-1', 's-old', 1, old * 1000, 0, '{}', 0, 'stop', 'test', 'test', 'hi', old);

  store.pruneOlderThan(14);

  const rows = (db as any).db.prepare('SELECT * FROM trajectory_turns WHERE session_id = ?').all('s-old');
  expect(rows).toHaveLength(0);
});

test('pruneOlderThan exempts goal-registered sessions', () => {
  const old = Math.floor(Date.now() / 1000) - 20 * 86400;

  (db as any).db
    .prepare('INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, tool_count, tokens, cost, finish, model, agent, user_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('proj-1', 's-goal', 1, old * 1000, 0, '{}', 0, 'stop', 'test', 'test', 'hi', old);
  (db as any).db
    .prepare('INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, tool_count, tokens, cost, finish, model, agent, user_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('proj-1', 's-normal', 1, old * 1000, 0, '{}', 0, 'stop', 'test', 'test', 'hi', old);

  db.upsertGoalSession({ goal_id: 'g1', session_id: 's-goal', phase: 'plan', loop: 1, created_at: '2026-08-01T00:00:00Z' });

  const exemptIds = db.listGoalSessionIds();
  store.pruneOlderThan(14, exemptIds);

  const goalRows = (db as any).db.prepare('SELECT * FROM trajectory_turns WHERE session_id = ?').all('s-goal');
  expect(goalRows).toHaveLength(1);

  const normalRows = (db as any).db.prepare('SELECT * FROM trajectory_turns WHERE session_id = ?').all('s-normal');
  expect(normalRows).toHaveLength(0);
});

test('pruneOlderThan with empty exempt list prunes everything', () => {
  const old = Math.floor(Date.now() / 1000) - 20 * 86400;
  (db as any).db
    .prepare('INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, tool_count, tokens, cost, finish, model, agent, user_text, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run('proj-1', 's1', 1, old * 1000, 0, '{}', 0, 'stop', 'test', 'test', 'hi', old);

  store.pruneOlderThan(14, []);

  const rows = (db as any).db.prepare('SELECT * FROM trajectory_turns').all();
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/trajectory-prune.test.ts --no-coverage`
Expected: FAIL — `pruneOlderThan` doesn't accept a second argument

- [ ] **Step 3: Modify pruneOlderThan to accept exemptSessionIds**

In `gateway/src/trajectory/trajectory-store.ts`, replace the `pruneOlderThan` method (lines 196-200):

```typescript
  pruneOlderThan(days: number, exemptSessionIds?: string[]): void {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

    if (exemptSessionIds && exemptSessionIds.length > 0) {
      const placeholders = exemptSessionIds.map(() => '?').join(',');
      this.rawDb
        .prepare(`DELETE FROM trajectory_events WHERE created_at < ? AND session_id NOT IN (${placeholders})`)
        .run(cutoff, ...exemptSessionIds);
      this.rawDb
        .prepare(`DELETE FROM trajectory_turns WHERE created_at < ? AND session_id NOT IN (${placeholders})`)
        .run(cutoff, ...exemptSessionIds);
    } else {
      this.rawDb.prepare('DELETE FROM trajectory_events WHERE created_at < ?').run(cutoff);
      this.rawDb.prepare('DELETE FROM trajectory_turns WHERE created_at < ?').run(cutoff);
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/trajectory-prune.test.ts --no-coverage`
Expected: PASS (3 tests green)

- [ ] **Step 5: Verify existing trajectory tests still pass**

Run: `npx jest tests/unit/gateway/trajectory-store.test.ts --no-coverage`
Expected: PASS (optional param is backward compatible)

- [ ] **Step 6: Commit**

```bash
git add gateway/src/trajectory/trajectory-store.ts tests/unit/gateway/trajectory-prune.test.ts
git commit -m "feat(trajectory): pruneOlderThan exempts goal-registered sessions from 14-day TTL"
```

---

### Task 6: Outcome Recorder — aggregation and failure signature

**Files:**
- Create: `gateway/src/orchestration/outcome-recorder.ts`
- Test: `tests/unit/gateway/outcome-recorder.test.ts` (create new)

**Interfaces:**
- Consumes: `GatewayDatabase` (from Task 1), `getActivePolicy` (from Task 2), `TrajectoryStore.getSessionTokenSummary` (existing), `loadRequest`/`loadState` (existing state.ts)
- Produces: `OutcomeRecorder` class with `recordOutcome(opts)` method; `generateFailureSignature(failureKind, firstErrorTool, errorSummary)` function

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/outcome-recorder.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../../gateway/src/memory/gateway-db';
import { OutcomeRecorder, generateFailureSignature } from '../../../gateway/src/orchestration/outcome-recorder';
import { TrajectoryStore } from '../../../gateway/src/trajectory/trajectory-store';

let tmpDir: string;
let db: GatewayDatabase;
let store: TrajectoryStore;
let recorder: OutcomeRecorder;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-outcome-'));
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'state'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'requests'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'feedback'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, '.mafw', 'user-feedback'), { recursive: true });
  db = new GatewayDatabase(':memory:');
  store = new TrajectoryStore(db, 'proj-1');
  recorder = new OutcomeRecorder(db, store, tmpDir);
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('recordOutcome', () => {
  test('aggregates basic outcome from state and request files', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.mafw', 'requests', 'g1.json'),
      JSON.stringify({ goalId: 'g1', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1', evolution_proposal_id: null }),
    );
    fs.writeFileSync(
      path.join(tmpDir, '.mafw', 'state', 'g1.json'),
      JSON.stringify({ goalId: 'g1', loop: 3, phase: 'ARCHIVED', nextAction: 'COMPLETED', sessions: {}, artifacts: {}, updatedAt: '2026-08-27T01:00:00Z' }),
    );

    recorder.recordOutcome({
      goalId: 'g1',
      projectId: 'proj-1',
      verdict: 'PASS',
      projectDir: tmpDir,
    });

    const row = db.getOutcome('g1');
    expect(row).not.toBeNull();
    expect(row.verdict).toBe('PASS');
    expect(row.rounds).toBe(3);
    expect(row.policy_version).toBe('builtin-v1');
    expect(row.duration_ms).toBeGreaterThan(0);
  });

  test('upsert is idempotent on re-archive', () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', 'g1.json'), JSON.stringify({ goalId: 'g1', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'state', 'g1.json'), JSON.stringify({ goalId: 'g1', loop: 2, phase: 'ARCHIVED', nextAction: 'COMPLETED', sessions: {}, artifacts: {}, updatedAt: '2026-08-27T01:00:00Z' }));

    recorder.recordOutcome({ goalId: 'g1', projectId: 'proj-1', verdict: 'PASS', projectDir: tmpDir });
    recorder.recordOutcome({ goalId: 'g1', projectId: 'proj-1', verdict: 'FAIL', projectDir: tmpDir });

    const row = db.getOutcome('g1');
    expect(row.verdict).toBe('FAIL');
  });

  test('cost fields are NULL when no trajectory data', () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', 'g1.json'), JSON.stringify({ goalId: 'g1', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'state', 'g1.json'), JSON.stringify({ goalId: 'g1', loop: 1, phase: 'ARCHIVED', nextAction: 'COMPLETED', sessions: {}, artifacts: {}, updatedAt: '2026-08-27T01:00:00Z' }));

    recorder.recordOutcome({ goalId: 'g1', projectId: 'proj-1', verdict: 'PASS', projectDir: tmpDir });

    const row = db.getOutcome('g1');
    expect(row.tokens_input).toBeNull();
    expect(row.total_cost).toBeNull();
  });

  test('aggregates thumbs from both feedback directories', () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', 'g1.json'), JSON.stringify({ goalId: 'g1', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'state', 'g1.json'), JSON.stringify({ goalId: 'g1', loop: 1, phase: 'ARCHIVED', nextAction: 'COMPLETED', sessions: {}, artifacts: {}, updatedAt: '2026-08-27T01:00:00Z' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'feedback', 'g1-1.json'), JSON.stringify({ goalId: 'g1', type: 'thumbs_up', targetId: 't1' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'user-feedback', 'g1-2.json'), JSON.stringify({ goalId: 'g1', type: 'thumbs_down', targetId: 't2' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'feedback', 'g1-3.json'), JSON.stringify({ goalId: 'g1', type: 'thumbs_up', targetId: 't3' }));

    recorder.recordOutcome({ goalId: 'g1', projectId: 'proj-1', verdict: 'PASS', projectDir: tmpDir });

    const row = db.getOutcome('g1');
    expect(row.thumbs_up).toBe(2);
    expect(row.thumbs_down).toBe(1);
  });

  test('is fail-open when state file is missing', () => {
    expect(() => {
      recorder.recordOutcome({ goalId: 'nonexistent', projectId: 'proj-1', verdict: 'PASS', projectDir: tmpDir });
    }).not.toThrow();
  });

  test('snapshots policy_version from request file, not getActivePolicy', () => {
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'requests', 'g1.json'), JSON.stringify({ goalId: 'g1', createdAt: '2026-08-27T00:00:00Z', policy_version: 'v2-custom', evolution_proposal_id: 'prop-99' }));
    fs.writeFileSync(path.join(tmpDir, '.mafw', 'state', 'g1.json'), JSON.stringify({ goalId: 'g1', loop: 1, phase: 'ARCHIVED', nextAction: 'COMPLETED', sessions: {}, artifacts: {}, updatedAt: '2026-08-27T01:00:00Z' }));

    recorder.recordOutcome({ goalId: 'g1', projectId: 'proj-1', verdict: 'PASS', projectDir: tmpDir });

    const row = db.getOutcome('g1');
    expect(row.policy_version).toBe('v2-custom');
    expect(row.evolution_proposal_id).toBe('prop-99');
  });
});

describe('generateFailureSignature', () => {
  test('generates deterministic signature', () => {
    const sig = generateFailureSignature('bad_plan', 'mafw_execute', 'File not found at src/main.ts');
    expect(sig).toBe('bad_plan:mafw_execute:File not found');
  });

  test('templates out numbers and paths', () => {
    const sig = generateFailureSignature('exec_error', 'bash', 'Error code 404 at /tmp/foo/bar line 42');
    expect(sig).not.toContain('404');
    expect(sig).not.toContain('/tmp/foo/bar');
    expect(sig).not.toContain('42');
  });

  test('handles missing tool name', () => {
    const sig = generateFailureSignature('user_cancel', null, '');
    expect(sig).toBe('user_cancel::');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/outcome-recorder.test.ts --no-coverage`
Expected: FAIL with `Cannot find module '../../../gateway/src/orchestration/outcome-recorder'`

- [ ] **Step 3: Write minimal implementation**

Create `gateway/src/orchestration/outcome-recorder.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { GatewayDatabase } from '../memory/gateway-db';
import { TrajectoryStore } from '../trajectory/trajectory-store';
import { getActivePolicy } from './policy';

export function generateFailureSignature(
  failureKind: string,
  firstErrorTool: string | null,
  errorSummary: string,
): string {
  const toolPart = firstErrorTool ?? '';
  const templated = (errorSummary || '')
    .replace(/0x[0-9a-fA-F]+/g, '<HEX>')
    .replace(/\b\d{1,3}(\.\d{1,3}){3}(:\d+)?\b/g, '<IP>')
    .replace(/\/[\w\-./]+/g, '<PATH>')
    .replace(/\b\d+\b/g, '<N>')
    .slice(0, 80);
  return `${failureKind}:${toolPart}:${templated}`;
}

export class OutcomeRecorder {
  constructor(
    private db: GatewayDatabase,
    private trajectoryStore: TrajectoryStore | null,
    private projectDir: string,
  ) {}

  recordOutcome(opts: {
    goalId: string;
    projectId: string | null;
    verdict: string;
    projectDir: string;
    failureKind?: string | null;
    lastError?: string | null;
    firstErrorTool?: string | null;
  }): void {
    try {
      const { goalId, projectId, verdict, projectDir } = opts;

      let state: any = null;
      let request: any = null;

      const statePath = path.join(projectDir, '.mafw', 'state', `${goalId}.json`);
      if (fs.existsSync(statePath)) {
        try { state = JSON.parse(fs.readFileSync(statePath, 'utf-8')); } catch { /* ignore */ }
      }

      const reqPath = path.join(projectDir, '.mafw', 'requests', `${goalId}.json`);
      if (fs.existsSync(reqPath)) {
        try { request = JSON.parse(fs.readFileSync(reqPath, 'utf-8')); } catch { /* ignore */ }
      }

      const rounds = state?.loop ?? 0;
      const createdAt = request?.createdAt;
      const durationMs = createdAt ? Date.now() - new Date(createdAt).getTime() : null;

      const policyVersion = request?.policy_version ?? getActivePolicy().version;
      const proposalId = request?.evolution_proposal_id ?? getActivePolicy().proposalId ?? null;

      let tokensInput: number | null = null;
      let tokensOutput: number | null = null;
      let totalCost: number | null = null;
      let toolErrorCount: number | null = null;

      if (this.trajectoryStore) {
        try {
          const sessionIds = this.db.listGoalSessions(goalId).map((s: any) => s.session_id);
          if (sessionIds.length > 0) {
            let aggInput = 0, aggOutput = 0, aggCost = 0, aggErrors = 0;
            for (const sid of sessionIds) {
              try {
                const summary = this.trajectoryStore.getSessionTokenSummary(sid);
                aggInput += summary.totalTokens.input;
                aggOutput += summary.totalTokens.output;
                aggCost += summary.totalCost;
              } catch { /* skip missing trajectory */ }
            }
            tokensInput = aggInput;
            tokensOutput = aggOutput;
            totalCost = aggCost;
            toolErrorCount = aggErrors;
          }
        } catch { /* fail-open */ }
      }

      const { thumbsUp, thumbsDown } = this.aggregateFeedback(goalId, projectDir);

      let failureKind = opts.failureKind ?? null;
      let failureSignature: string | null = null;
      if (failureKind) {
        failureSignature = generateFailureSignature(
          failureKind,
          opts.firstErrorTool ?? null,
          opts.lastError ?? '',
        );
      }

      this.db.upsertOutcome({
        goal_id: goalId,
        project_id: projectId,
        verdict,
        rounds,
        duration_ms: durationMs,
        tokens_input: tokensInput,
        tokens_output: tokensOutput,
        total_cost: totalCost,
        tool_error_count: toolErrorCount,
        thumbs_up: thumbsUp,
        thumbs_down: thumbsDown,
        policy_version: policyVersion,
        evolution_proposal_id: proposalId,
        failure_kind: failureKind,
        failure_signature: failureSignature,
        created_at: createdAt ?? new Date().toISOString(),
        archived_at: new Date().toISOString(),
      });
    } catch (err: any) {
      // fail-open: outcome recording must never break the archive flow
      console.error(`[OutcomeRecorder] fail-open: ${err.message}`);
    }
  }

  private aggregateFeedback(goalId: string, projectDir: string): { thumbsUp: number; thumbsDown: number } {
    let thumbsUp = 0;
    let thumbsDown = 0;
    const seen = new Set<string>();

    for (const dir of ['feedback', 'user-feedback']) {
      const dirPath = path.join(projectDir, '.mafw', dir);
      if (!fs.existsSync(dirPath)) continue;
      try {
        const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(dirPath, file), 'utf-8'));
            if (data.goalId !== goalId) continue;
            const key = data.feedbackId || `${file}:${data.type}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (data.type === 'thumbs_up') thumbsUp++;
            else if (data.type === 'thumbs_down') thumbsDown++;
          } catch { /* skip malformed */ }
        }
      } catch { /* skip unreadable dir */ }
    }

    return { thumbsUp, thumbsDown };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/outcome-recorder.test.ts --no-coverage`
Expected: PASS (all tests green)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/outcome-recorder.ts tests/unit/gateway/outcome-recorder.test.ts
git commit -m "feat(orchestration): add OutcomeRecorder with cost/feedback/failure-signature aggregation"
```

---

### Task 7: Index.ts Wiring — policy snapshot + recordOutcome calls + ABORT branch

**Files:**
- Modify: `gateway/src/index.ts` (multiple sections: onGoalCreated, archiveGoal, ABORT handlers, buildNodeOptions)
- Test: Extend existing `tests/unit/gateway/scheduler.test.ts`

**Interfaces:**
- Consumes: `OutcomeRecorder` (from Task 6), `getActivePolicy` (from Task 2), `GatewayDatabase` (existing)
- Produces: wired outcome recording in all three archive funnels

- [ ] **Step 1: Write the failing test**

Add tests to `tests/unit/gateway/scheduler.test.ts` (append after existing tests):

```typescript
describe('archiveGoal calls recordOutcome', () => {
  test('calls recordOutcome on successful archive', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const mafwDir = path.join(projectDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'requests', '001-auth.json'),
      JSON.stringify({ goalId: '001-auth', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }),
    );
    fs.writeFileSync(
      path.join(mafwDir, 'state', '001-auth.json'),
      JSON.stringify({
        version: '2', goalId: '001-auth', loop: 2, phase: 'REVIEWING_COMPLETE',
        lastPhase: 'REVIEWING', currentWave: 0, totalWaves: null,
        sessions: {}, nextAction: 'CHECK_VERDICT', artifacts: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    const scheduler = new MafwScheduler(tmpDir);
    (scheduler as any).registeredProjects.set(projectDir, { projectDir, mafwDir, registeredAt: new Date().toISOString() });
    (scheduler as any).activeGoals.set('001-auth', { goalId: '001-auth', loop: 2, phase: 'REVIEWING_COMPLETE', nextAction: 'CHECK_VERDICT', sessions: {} });

    let recordedArgs: any = null;
    (scheduler as any).outcomeRecorder = {
      recordOutcome: (opts: any) => { recordedArgs = opts; },
    };
    (scheduler as any).loadArchiveModule = async () => ({
      archiveWorktree: async () => { /* success */ },
    });

    await (scheduler as any).archiveGoal('001-auth');

    expect(recordedArgs).not.toBeNull();
    expect(recordedArgs.goalId).toBe('001-auth');
    expect(recordedArgs.verdict).toBe('PASS');
  });

  test('calls recordOutcome with FAIL verdict on archive error', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const mafwDir = path.join(projectDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'requests', '001-auth.json'),
      JSON.stringify({ goalId: '001-auth', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }),
    );
    fs.writeFileSync(
      path.join(mafwDir, 'state', '001-auth.json'),
      JSON.stringify({
        version: '2', goalId: '001-auth', loop: 1, phase: 'REVIEWING_COMPLETE',
        lastPhase: 'REVIEWING', currentWave: 0, totalWaves: null,
        sessions: {}, nextAction: 'CHECK_VERDICT', artifacts: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    const scheduler = new MafwScheduler(tmpDir);
    (scheduler as any).registeredProjects.set(projectDir, { projectDir, mafwDir, registeredAt: new Date().toISOString() });
    (scheduler as any).activeGoals.set('001-auth', { goalId: '001-auth', loop: 1, phase: 'REVIEWING_COMPLETE', nextAction: 'CHECK_VERDICT', sessions: {} });

    let recordedArgs: any = null;
    (scheduler as any).outcomeRecorder = {
      recordOutcome: (opts: any) => { recordedArgs = opts; },
    };
    (scheduler as any).loadArchiveModule = async () => ({
      archiveWorktree: async () => { throw new Error('boom'); },
    });

    await (scheduler as any).archiveGoal('001-auth');

    expect(recordedArgs).not.toBeNull();
    expect(recordedArgs.verdict).toBe('ERROR');
    expect(recordedArgs.failureKind).toBe('archive_error');
  });

  test('ABORT path calls recordOutcome with CANCELLED verdict', async () => {
    const projectDir = path.join(tmpDir, 'project');
    const mafwDir = path.join(projectDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
    fs.writeFileSync(
      path.join(mafwDir, 'requests', '001-auth.json'),
      JSON.stringify({ goalId: '001-auth', createdAt: '2026-08-27T00:00:00Z', policy_version: 'builtin-v1' }),
    );
    fs.writeFileSync(
      path.join(mafwDir, 'state', '001-auth.json'),
      JSON.stringify({
        version: '2', goalId: '001-auth', loop: 1, phase: 'EXECUTING',
        lastPhase: 'PLANNING', currentWave: 0, totalWaves: null,
        sessions: {}, nextAction: 'WAIT_PHASE_COMPLETE', artifacts: {},
        updatedAt: new Date().toISOString(),
      }),
    );

    const scheduler = new MafwScheduler(tmpDir);
    (scheduler as any).registeredProjects.set(projectDir, { projectDir, mafwDir, registeredAt: new Date().toISOString() });
    (scheduler as any).activeGoals.set('001-auth', { goalId: '001-auth', loop: 1, phase: 'EXECUTING', nextAction: 'WAIT_PHASE_COMPLETE', sessions: {} });

    let recordedArgs: any = null;
    (scheduler as any).outcomeRecorder = {
      recordOutcome: (opts: any) => { recordedArgs = opts; },
    };

    await (scheduler as any).abortGoal('001-auth');

    expect(recordedArgs).not.toBeNull();
    expect(recordedArgs.verdict).toBe('CANCELLED');
    expect(recordedArgs.failureKind).toBe('user_cancel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/scheduler.test.ts --no-coverage`
Expected: FAIL — `outcomeRecorder` not set, `abortGoal` doesn't exist

- [ ] **Step 3: Add outcomeRecorder field and initialize in MafwScheduler**

In `gateway/src/index.ts`, add after the `trajectoryCollector` declaration (around line 257):

```typescript
  private outcomeRecorder: import('./orchestration/outcome-recorder').OutcomeRecorder | null = null;
```

In the `start()` method, add initialization of `outcomeRecorder` **after** `trajectoryStore` is created (the `OutcomeRecorder` constructor accepts `TrajectoryStore | null`, but the real store must be ready before first use). Search for the line that creates `this.trajectoryStore = new TrajectoryStore(...)` and add immediately after:

```typescript
    this.outcomeRecorder = new OutcomeRecorder(this.getGatewayDb(), this.trajectoryStore, this.projectDir);
```

Add the import at the top of index.ts:

```typescript
import { OutcomeRecorder } from './orchestration/outcome-recorder';
```

- [ ] **Step 4: Modify archiveGoal to call recordOutcome**

In `gateway/src/index.ts`, modify `archiveGoal` (lines 4183-4218). After the successful archive block (after line 4217), add:

```typescript
    // Record outcome (fail-open)
    try {
      this.outcomeRecorder?.recordOutcome({
        goalId,
        projectId: projectDir ?? null,
        verdict: 'PASS',
        projectDir: projectDir ?? this.projectDir,
      });
    } catch (err: any) {
      log.warn(`[Scheduler] recordOutcome fail-open: ${err.message}`);
    }
```

In the catch block (archive failure, around lines 4200-4208), add before `return`:

```typescript
        try {
          this.outcomeRecorder?.recordOutcome({
            goalId,
            projectId: projectDir ?? null,
            verdict: 'ERROR',
            projectDir: projectDir ?? this.projectDir,
            failureKind: 'archive_error',
            lastError: err.message,
          });
        } catch (e: any) {
          log.warn(`[Scheduler] recordOutcome fail-open: ${e.message}`);
        }
```

For FAIL and MAX_RETRIES verdicts, the verdict comes from the LangGraph state. Modify `buildNodeOptions` (around lines 4563-4580) to pass the verdict to archiveGoal. Change the archive node handlers:

```typescript
      archiveSuccess: async (s: any) => {
        log.info(`[Scheduler] Goal ${s.goalId} PASSED`);
        syncToFile({ ...s, phase: 'ARCHIVED' });
        await this.archiveGoal(s.goalId, 'PASS');
        return {};
      },
      archiveFail: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} FAILED: ${s.lastError}`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId, 'FAIL', s.lastError);
        return {};
      },
      archiveMaxRetries: async (s: any) => {
        log.error(`[Scheduler] Goal ${s.goalId} max retries`);
        syncToFile({ ...s, phase: 'FAILED' });
        await this.archiveGoal(s.goalId, 'MAX_RETRIES');
        return {};
      },
```

Update `archiveGoal` signature to accept verdict:

```typescript
  private async archiveGoal(goalId: string, verdict: string = 'PASS', lastError?: string) {
```

And update the recordOutcome calls to use the passed verdict and error.

- [ ] **Step 5: Add abortGoal method and wire ABORT branches**

Add new method `abortGoal` to MafwScheduler:

```typescript
  private async abortGoal(goalId: string) {
    await this.destroyAllSessions(goalId);
    await this.patchState(goalId, { nextAction: 'FAILED', phase: 'ARCHIVED' });

    try {
      let projectDir: string | null = null;
      for (const [pDir, info] of this.registeredProjects) {
        if (fs.existsSync(path.join(info.mafwDir, 'state', `${goalId}.json`))) {
          projectDir = pDir;
          break;
        }
      }
      this.outcomeRecorder?.recordOutcome({
        goalId,
        projectId: projectDir,
        verdict: 'CANCELLED',
        projectDir: projectDir ?? this.projectDir,
        failureKind: 'user_cancel',
      });
    } catch (err: any) {
      log.warn(`[Scheduler] recordOutcome fail-open on ABORT: ${err.message}`);
    }
  }
```

Update both ABORT handlers to call `abortGoal`:

**HTTP control handler** (around line 2732):
```typescript
                case 'ABORT':
                  if (control.goalId) {
                    await this.abortGoal(control.goalId);
                  }
                  break;
```

**Control file handler** (around line 4260):
```typescript
          case 'ABORT':
            if (control.goalId) {
              await this.abortGoal(control.goalId);
            }
            break;
```

- [ ] **Step 6: Add policy snapshot to onGoalCreated**

In `onGoalCreated` (line 4601), add policy snapshot writing before graph invoke:

```typescript
  private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
    // Snapshot policy version into request file
    try {
      const { getActivePolicy } = await import('./orchestration/policy');
      const policy = getActivePolicy();
      const reqPath = path.join(projectDir, '.mafw', 'requests', `${goalId}.json`);
      if (fs.existsSync(reqPath)) {
        const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
        req.policy_version = policy.version;
        req.evolution_proposal_id = policy.proposalId;
        fs.writeFileSync(reqPath, JSON.stringify(req, null, 2), 'utf-8');
      }
    } catch (err: any) {
      log.warn(`[Scheduler] Policy snapshot fail-open: ${err.message}`);
    }

    const cp = new FileCheckpointer(mafwDir);
    // ... rest unchanged
```

- [ ] **Step 7: Run all scheduler tests to verify they pass**

Run: `npx jest tests/unit/gateway/scheduler.test.ts --no-coverage`
Expected: PASS (all existing + new tests green)

- [ ] **Step 8: Commit**

```bash
git add gateway/src/index.ts tests/unit/gateway/scheduler.test.ts
git commit -m "feat(orchestration): wire recordOutcome into archive success/fail/ABORT + policy snapshot on create"
```

---

### Task 8: HTTP API Route — GET /api/orchestration/outcomes

**Files:**
- Modify: `gateway/src/index.ts` (add route in startApiServer, after existing memory routes)
- Test: Create `tests/unit/gateway/outcomes-api.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase.listOutcomes()` (from Task 1)
- Produces: HTTP endpoint `GET /api/orchestration/outcomes`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/gateway/outcomes-api.test.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';

let tmpDir: string;
let server: http.Server;
let port: number;

function makeRequest(urlPath: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${urlPath}`, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode!, body: JSON.parse(data) });
      });
    }).on('error', reject);
  });
}
```

Note: Full API test requires spinning up the gateway HTTP server, which is complex. A simpler approach is to test the route handler directly. If the test infrastructure is too heavy, skip this test file and verify manually with `curl` after starting the gateway.

- [ ] **Step 2: Add the route in startApiServer**

In `gateway/src/index.ts`, find the API route handler section (after existing memory routes, before the SSE endpoint). Add:

```typescript
        // Orchestration outcomes
        if (req.url?.match(/^\/api\/orchestration\/outcomes(?:\?|$)/) && req.method === 'GET') {
          try {
            const url = new URL(req.url, `http://${req.headers.host}`);
            const filters: any = {};
            if (url.searchParams.get('verdict')) filters.verdict = url.searchParams.get('verdict');
            if (url.searchParams.get('project')) filters.project_id = url.searchParams.get('project');
            if (url.searchParams.get('policy')) filters.policy_version = url.searchParams.get('policy');
            if (url.searchParams.get('limit')) filters.limit = parseInt(url.searchParams.get('limit')!, 10);

            const outcomes = this.getGatewayDb().listOutcomes(filters);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ outcomes, count: outcomes.length }));
          } catch (err: any) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
          }
          return;
        }
```

- [ ] **Step 3: Manual verification**

Start the gateway and test:

```bash
# Start gateway
mafw daemon

# Query outcomes (may be empty initially)
curl -s http://localhost:3000/api/orchestration/outcomes | jq .

# Query with filters
curl -s "http://localhost:3000/api/orchestration/outcomes?verdict=PASS&limit=5" | jq .
```

Expected: 200 response with `{ outcomes: [], count: 0 }` (or populated if goals have been archived)

- [ ] **Step 4: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(orchestration): add GET /api/orchestration/outcomes endpoint"
```

---

### Task 9: AGENTS.md Documentation Update

**Files:**
- Modify: `AGENTS.md` (add orchestration section)

- [ ] **Step 1: Add orchestration section to AGENTS.md**

Add a new section after section 5.19 (or wherever appropriate):

```markdown
### 5.20 Goal Outcome Observability (RSI Phase 1)

Three new tables in `~/.mafw/memory/gateway.db` support recursive self-improvement:

| Table | Purpose |
|---|---|
| `goal_outcomes` | One row per archived goal: verdict, cost, feedback, policy version, failure signature |
| `goal_sessions` | Append-only: all sessions registered to a goal (survives `startNextLoop` clearing) |
| `evolution_proposals` | Phase 2+ data: proposed policy/structural changes with declared predictions |

**Write funnels (all fail-open):**
1. `archiveGoal` success → `recordOutcome(verdict='PASS'|'FAIL'|'MAX_RETRIES')`
2. `archiveGoal` failure → `recordOutcome(verdict='ERROR', failure_kind='archive_error')`
3. ABORT cancel → `abortGoal()` → `recordOutcome(verdict='CANCELLED', failure_kind='user_cancel')`
4. `recordSession()` → appends `goal_sessions` row

**Policy snapshot:** `policy_version` + `evolution_proposal_id` written to `.mafw/requests/{goalId}.json` at goal creation time (not archive time), preventing misattribution when policies change mid-flight.

**Prune exemption:** Sessions in `goal_sessions` are exempt from the 14-day trajectory TTL.

**Component registry:** `gateway/src/orchestration/registry.ts` declares evolvable components (Phase 1: read-only).

**HTTP endpoint:** `GET /api/orchestration/outcomes?verdict=&project=&policy=&limit=`
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add RSI Phase 1 orchestration observability section"
```

---

### Task 10: Full Test Suite Verification

**Files:**
- No code changes

- [ ] **Step 1: Run all new test files together**

Run:
```bash
npx jest tests/unit/gateway/goal-db.test.ts tests/unit/gateway/policy.test.ts tests/unit/gateway/registry.test.ts tests/unit/gateway/goal-sessions.test.ts tests/unit/gateway/trajectory-prune.test.ts tests/unit/gateway/outcome-recorder.test.ts tests/unit/gateway/scheduler.test.ts --no-coverage
```
Expected: All tests PASS

- [ ] **Step 2: Run the full gateway test suite**

Run:
```bash
npx jest --no-coverage
```
Expected: No regressions in existing tests

- [ ] **Step 3: Build verification**

Run:
```bash
npm run build
```
Expected: Build succeeds with no type errors

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix(orchestration): address test/build issues from Phase 1 integration"
```
