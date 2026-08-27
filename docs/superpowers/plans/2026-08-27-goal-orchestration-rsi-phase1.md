# Goal 缂栨帓 RSI 鈥?Phase 1 瀹炵幇璁″垝

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 涓?gateway 鐨?Goal 缂栨帓寤虹珛瑙傛祴灞傦細姣忎釜 goal 褰掓。鏃惰惤涓€琛岀粨鏋勫寲 outcome锛屾墦閫氭垚鏈?鍙嶉鑱氬悎锛屽煁鍏ョ瓥鐣ョ増鏈挬瀛愪笌缁勪欢娉ㄥ唽琛ㄣ€?
**Architecture:** 鍦?GatewayDatabase 鏂板涓夊紶琛紙goal_outcomes銆乬oal_sessions銆乪volution_proposals锛夛紝鍦ㄤ笁涓?session 鍒涘缓鐐癸紙plan/execute/review 鑺傜偣锛夎拷鍔?goal_sessions 璁板綍锛屽湪褰掓。鑺傜偣鑱氬悎 trajectory + feedback 鍐欏叆 outcome锛屽湪 goal 鍒涘缓鏃跺揩鐓х瓥鐣ョ増鏈€傛墍鏈夊啓鍏?fail-open锛屼笉褰卞搷涓绘祦绋嬨€?
**Tech Stack:** TypeScript, better-sqlite3, Jest (ts-jest), Node.js

## Global Constraints

- 鎵€鏈?outcome 鍐欏叆 fail-open锛氬紓甯稿彧璁版棩蹇楋紝缁濅笉褰卞搷褰掓。涓绘祦绋?- API 璺敱姝ｅ垯閬靛惊 `(?:\?|$)` 妯″紡锛圓GENTS.md 搂6.5锛?- 鎻愪氦鏃跺彧 `git add` 鏈换鍔℃秹鍙婄殑鍏蜂綋鏂囦欢锛堜粨搴撴湁骞惰 agent 浼氳瘽锛岀洰褰曠骇 add 浼氭贩鍏ヤ粬浜烘敼鍔級
- upsert 骞傜瓑锛歡oal_id 涓婚敭锛岄噸澶嶅綊妗ｆ洿鏂拌€岄潪鎶ラ敊
- 涓夊紶琛ㄥ湪 GatewayDatabase 鏋勯€犲嚱鏁扮殑 CREATE TABLE IF NOT EXISTS 鍧椾腑鍒涘缓

---

### Task 1: GatewayDatabase 涓夎〃 + CRUD

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`
- Test: `tests/unit/gateway/goal-outcomes.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `GoalOutcome` interface, `upsertGoalOutcome`, `listGoalOutcomes`, `addGoalSession`, `listGoalSessions`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gateway/goal-outcomes.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../gateway/src/memory/gateway-db';

describe('Goal outcomes', () => {
  let db: GatewayDatabase;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-outcomes-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('upsertGoalOutcome inserts and updates', () => {
    const outcome = {
      goal_id: 'g1',
      project_id: 'proj1',
      verdict: 'PASS',
      rounds: 2,
      duration_ms: 5000,
      tokens_input: 1000,
      tokens_output: 500,
      total_cost: 0.01,
      tool_error_count: 0,
      thumbs_up: 1,
      thumbs_down: 0,
      policy_version: 'builtin-v1',
      evolution_proposal_id: null,
      failure_kind: null,
      failure_signature: null,
      created_at: '2026-08-27T00:00:00Z',
      archived_at: '2026-08-27T01:00:00Z',
    };
    db.upsertGoalOutcome(outcome);
    const rows = db.listGoalOutcomes({});
    expect(rows).toHaveLength(1);
    expect(rows[0].goal_id).toBe('g1');
    expect(rows[0].verdict).toBe('PASS');

    // Upsert updates
    db.upsertGoalOutcome({ ...outcome, verdict: 'FAIL', rounds: 3 });
    const rows2 = db.listGoalOutcomes({});
    expect(rows2).toHaveLength(1);
    expect(rows2[0].verdict).toBe('FAIL');
    expect(rows2[0].rounds).toBe(3);
  });

  test('listGoalOutcomes filters by policy and verdict', () => {
    db.upsertGoalOutcome({
      goal_id: 'g1', project_id: 'p1', verdict: 'PASS', rounds: 1,
      duration_ms: null, tokens_input: null, tokens_output: null, total_cost: null,
      tool_error_count: null, thumbs_up: 0, thumbs_down: 0,
      policy_version: 'v1', evolution_proposal_id: null,
      failure_kind: null, failure_signature: null, created_at: null, archived_at: '2026-08-27T00:00:00Z',
    });
    db.upsertGoalOutcome({
      goal_id: 'g2', project_id: 'p1', verdict: 'FAIL', rounds: 2,
      duration_ms: null, tokens_input: null, tokens_output: null, total_cost: null,
      tool_error_count: null, thumbs_up: 0, thumbs_down: 0,
      policy_version: 'v2', evolution_proposal_id: null,
      failure_kind: 'exec_error', failure_signature: null, created_at: null, archived_at: '2026-08-27T00:00:00Z',
    });
    expect(db.listGoalOutcomes({ policy: 'v1' })).toHaveLength(1);
    expect(db.listGoalOutcomes({ verdict: 'FAIL' })).toHaveLength(1);
    expect(db.listGoalOutcomes({ project: 'p1' })).toHaveLength(2);
  });

  test('addGoalSession and listGoalSessions', () => {
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    db.addGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'execute', loop: 1 });
    const sessions = db.listGoalSessions('g1');
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.session_id).sort()).toEqual(['s1', 's2']);

    // Duplicate insert ignored
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    expect(db.listGoalSessions('g1')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/goal-outcomes.test.ts`
Expected: FAIL with "db.upsertGoalOutcome is not a function"

- [ ] **Step 3: Implement the tables and methods**

In `gateway/src/memory/gateway-db.ts`, add to the constructor's `this.db.exec(...)` block (after the existing tables):

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
  policy_version TEXT NOT NULL DEFAULT 'builtin-v1',
  evolution_proposal_id TEXT,
  failure_kind TEXT,
  failure_signature TEXT,
  created_at TEXT,
  archived_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_goal_outcomes_policy ON goal_outcomes(policy_version, verdict);
CREATE INDEX IF NOT EXISTS idx_goal_outcomes_project ON goal_outcomes(project_id, policy_version);

CREATE TABLE IF NOT EXISTS goal_sessions (
  goal_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  loop INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  PRIMARY KEY (goal_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_goal_sessions_session ON goal_sessions(session_id);

CREATE TABLE IF NOT EXISTS evolution_proposals (
  id TEXT PRIMARY KEY,
  requires TEXT NOT NULL DEFAULT 'policy',
  component_diffs TEXT NOT NULL,
  declared_prediction TEXT,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'proposed',
  validation_result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add interfaces and methods after the existing methods:

```typescript
export interface GoalOutcome {
  goal_id: string;
  project_id: string | null;
  verdict: string;
  rounds: number;
  duration_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  total_cost: number | null;
  tool_error_count: number | null;
  thumbs_up: number;
  thumbs_down: number;
  policy_version: string;
  evolution_proposal_id: string | null;
  failure_kind: string | null;
  failure_signature: string | null;
  created_at: string | null;
  archived_at: string;
}

upsertGoalOutcome(o: GoalOutcome): void {
  this.db.prepare(`
    INSERT INTO goal_outcomes (goal_id, project_id, verdict, rounds, duration_ms,
      tokens_input, tokens_output, total_cost, tool_error_count, thumbs_up, thumbs_down,
      policy_version, evolution_proposal_id, failure_kind, failure_signature, created_at, archived_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(goal_id) DO UPDATE SET
      verdict=excluded.verdict, rounds=excluded.rounds, duration_ms=excluded.duration_ms,
      tokens_input=excluded.tokens_input, tokens_output=excluded.tokens_output, total_cost=excluded.total_cost,
      tool_error_count=excluded.tool_error_count, thumbs_up=excluded.thumbs_up, thumbs_down=excluded.thumbs_down,
      policy_version=excluded.policy_version, evolution_proposal_id=excluded.evolution_proposal_id,
      failure_kind=excluded.failure_kind, failure_signature=excluded.failure_signature,
      created_at=excluded.created_at, archived_at=excluded.archived_at
  `).run(
    o.goal_id, o.project_id, o.verdict, o.rounds, o.duration_ms,
    o.tokens_input, o.tokens_output, o.total_cost, o.tool_error_count,
    o.thumbs_up, o.thumbs_down, o.policy_version, o.evolution_proposal_id,
    o.failure_kind, o.failure_signature, o.created_at, o.archived_at
  );
}

listGoalOutcomes(filter?: { policy?: string; verdict?: string; project?: string; limit?: number }): GoalOutcome[] {
  const conditions: string[] = [];
  const params: any[] = [];
  if (filter?.policy) { conditions.push('policy_version = ?'); params.push(filter.policy); }
  if (filter?.verdict) { conditions.push('verdict = ?'); params.push(filter.verdict); }
  if (filter?.project) { conditions.push('project_id = ?'); params.push(filter.project); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter?.limit ?? 100;
  return this.db.prepare(`SELECT * FROM goal_outcomes ${where} ORDER BY archived_at DESC LIMIT ?`).all(...params, limit) as GoalOutcome[];
}

addGoalSession(s: { goal_id: string; session_id: string; phase: string; loop: number }): void {
  this.db.prepare(`
    INSERT OR IGNORE INTO goal_sessions (goal_id, session_id, phase, loop, created_at)
    VALUES (?,?,?,?,datetime('now'))
  `).run(s.goal_id, s.session_id, s.phase, s.loop);
}

listGoalSessions(goalId: string): Array<{ session_id: string; phase: string; loop: number }> {
  return this.db.prepare('SELECT session_id, phase, loop FROM goal_sessions WHERE goal_id = ?').all(goalId) as any[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/goal-outcomes.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts tests/unit/gateway/goal-outcomes.test.ts
git commit -m "feat(gateway): add goal_outcomes, goal_sessions, evolution_proposals tables"
```

---

### Task 2: orchestration/policy.ts

**Files:**
- Create: `gateway/src/orchestration/policy.ts`
- Test: `tests/unit/gateway/orchestration-policy.test.ts`

**Interfaces:**
- Consumes: `config.resolvePath()`
- Produces: `getActivePolicy(): { version: string; proposalId: string | null }`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gateway/orchestration-policy.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getActivePolicy, BUILTIN_POLICY } from '../../gateway/src/orchestration/policy';

describe('getActivePolicy', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns builtin when active.json missing', () => {
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });

  test('returns builtin when active.json malformed', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'orchestration', 'active.json'), 'not json', 'utf-8');
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });

  test('reads version and proposalId from active.json', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'orchestration', 'active.json'),
      JSON.stringify({ version: 'v2', proposalId: 'prop1' }),
      'utf-8'
    );
    expect(getActivePolicy(tmpDir)).toEqual({ version: 'v2', proposalId: 'prop1' });
  });

  test('returns builtin when version is empty string', () => {
    fs.mkdirSync(path.join(tmpDir, 'orchestration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'orchestration', 'active.json'),
      JSON.stringify({ version: '' }),
      'utf-8'
    );
    expect(getActivePolicy(tmpDir)).toEqual(BUILTIN_POLICY);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/orchestration-policy.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement policy.ts**

```typescript
// gateway/src/orchestration/policy.ts
import * as fs from 'fs';
import * as path from 'path';

export interface ActivePolicy {
  version: string;
  proposalId: string | null;
}

export const BUILTIN_POLICY: ActivePolicy = { version: 'builtin-v1', proposalId: null };

export function getActivePolicy(mafwDir: string): ActivePolicy {
  try {
    const p = path.join(mafwDir, 'orchestration', 'active.json');
    if (!fs.existsSync(p)) return { ...BUILTIN_POLICY };
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (typeof data?.version !== 'string' || !data.version) return { ...BUILTIN_POLICY };
    return {
      version: data.version,
      proposalId: typeof data.proposalId === 'string' ? data.proposalId : null,
    };
  } catch {
    return { ...BUILTIN_POLICY };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/orchestration-policy.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/policy.ts tests/unit/gateway/orchestration-policy.test.ts
git commit -m "feat(gateway): add orchestration/policy.ts getActivePolicy"
```

---

### Task 3: orchestration/registry.ts

**Files:**
- Create: `gateway/src/orchestration/registry.ts`
- Test: `tests/unit/gateway/orchestration-registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ORCHESTRATION_REGISTRY` array, `OrchestrationComponent` interface

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gateway/orchestration-registry.test.ts
import { ORCHESTRATION_REGISTRY } from '../../gateway/src/orchestration/registry';
import * as fs from 'fs';
import * as path from 'path';

describe('ORCHESTRATION_REGISTRY', () => {
  test('all ids are unique', () => {
    const ids = ORCHESTRATION_REGISTRY.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('each currentValueSource file exists', () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    for (const comp of ORCHESTRATION_REGISTRY) {
      const filePart = comp.currentValueSource.split(':')[0];
      const fullPath = path.join(repoRoot, filePart);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/orchestration-registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement registry.ts**

```typescript
// gateway/src/orchestration/registry.ts
export interface OrchestrationComponent {
  id: string;
  kind: 'prompt' | 'threshold' | 'model_route' | 'parameter';
  currentValueSource: string;
  evolvablePhase: 2 | 3;
}

export const ORCHESTRATION_REGISTRY: OrchestrationComponent[] = [
  {
    id: 'plan.prompt',
    kind: 'prompt',
    currentValueSource: 'gateway/src/core/skills/mafw-plan/entry.ts:buildPlanPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.prompt',
    kind: 'prompt',
    currentValueSource: 'gateway/src/core/skills/mafw-review/entry.ts:buildReviewPrompt',
    evolvablePhase: 2,
  },
  {
    id: 'review.samematch_threshold',
    kind: 'threshold',
    currentValueSource: 'gateway/src/core/langgraph/nodes/review.node.ts',
    evolvablePhase: 2,
  },
  {
    id: 'loop.max_rounds',
    kind: 'parameter',
    currentValueSource: 'gateway/src/config.ts:loop.maxRounds',
    evolvablePhase: 2,
  },
  {
    id: 'loop.stuck_timeout',
    kind: 'parameter',
    currentValueSource: 'gateway/src/config.ts:timeouts.stuckLoopTimeout',
    evolvablePhase: 2,
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/orchestration-registry.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/registry.ts tests/unit/gateway/orchestration-registry.test.ts
git commit -m "feat(gateway): add orchestration/registry.ts component registry"
```

---

### Task 4: trajectory-store prune 璞佸厤

**Files:**
- Modify: `gateway/src/trajectory/trajectory-store.ts:196-200`
- Test: `tests/unit/gateway/trajectory-prune-exemption.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase.addGoalSession`
- Produces: modified `pruneOlderThan` that exempts goal sessions

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gateway/trajectory-prune-exemption.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../gateway/src/memory/gateway-db';
import { TrajectoryStore } from '../../gateway/src/trajectory/trajectory-store';

describe('TrajectoryStore prune exemption', () => {
  let db: GatewayDatabase;
  let store: TrajectoryStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-prune-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    store = new TrajectoryStore(db, 'proj1');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('prune deletes old turns but exempts goal sessions', () => {
    const oldMs = Date.now() - 20 * 86400 * 1000; // 20 days ago
    store.upsertTurn({
      projectID: 'proj1', sessionID: 's1', turnID: 1,
      turnStartMs: oldMs, turnEndMs: oldMs, durationMs: 100,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001, finish: 'stop', model: 'm', provider: 'p', agent: 'a', userText: 'hi',
    });
    store.upsertTurn({
      projectID: 'proj1', sessionID: 's2', turnID: 1,
      turnStartMs: oldMs, turnEndMs: oldMs, durationMs: 100,
      toolCount: 0, toolErrorCount: 0, reasoningCount: 0, agentSwitchCount: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      cost: 0.001, finish: 'stop', model: 'm', provider: 'p', agent: 'a', userText: 'hi',
    });

    // Register s2 as a goal session
    db.addGoalSession({ goal_id: 'g1', session_id: 's2', phase: 'plan', loop: 1 });

    store.pruneOlderThan(14);

    const summary1 = store.getSessionTokenSummary('s1');
    expect(summary1.turnCount).toBe(0); // pruned
    const summary2 = store.getSessionTokenSummary('s2');
    expect(summary2.turnCount).toBe(1); // exempted
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/trajectory-prune-exemption.test.ts`
Expected: FAIL (both sessions pruned)

- [ ] **Step 3: Modify pruneOlderThan**

In `gateway/src/trajectory/trajectory-store.ts`, replace lines 196-200:

```typescript
pruneOlderThan(days: number): void {
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  this.rawDb.prepare(`
    DELETE FROM trajectory_events WHERE created_at < ?
    AND session_id NOT IN (SELECT session_id FROM goal_sessions)
  `).run(cutoff);
  this.rawDb.prepare(`
    DELETE FROM trajectory_turns WHERE created_at < ?
    AND session_id NOT IN (SELECT session_id FROM goal_sessions)
  `).run(cutoff);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/trajectory-prune-exemption.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/trajectory/trajectory-store.ts tests/unit/gateway/trajectory-prune-exemption.test.ts
git commit -m "feat(gateway): trajectory prune exempts goal sessions"
```

---

### Task 5: outcome-recorder.ts

**Files:**
- Create: `gateway/src/orchestration/outcome-recorder.ts`
- Test: `tests/unit/gateway/outcome-recorder.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`, `getActivePolicy`
- Produces: `recordGoalOutcome`, `inferFailureKind`, `buildFailureSignature`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/gateway/outcome-recorder.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GatewayDatabase } from '../../gateway/src/memory/gateway-db';
import { recordGoalOutcome, inferFailureKind, buildFailureSignature } from '../../gateway/src/orchestration/outcome-recorder';

describe('outcome-recorder', () => {
  let db: GatewayDatabase;
  let tmpDir: string;
  let mafwDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-rec-'));
    db = new GatewayDatabase(path.join(tmpDir, 'test.db'));
    projectDir = tmpDir;
    mafwDir = path.join(tmpDir, '.mafw');
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(mafwDir, 'requests'), { recursive: true });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('inferFailureKind returns correct kinds', () => {
    expect(inferFailureKind({ verdict: 'PASS', lastError: null })).toBeNull();
    expect(inferFailureKind({ verdict: 'CANCELLED', lastError: null })).toBe('user_cancel');
    expect(inferFailureKind({ verdict: 'MAX_RETRIES', lastError: null })).toBe('max_retries');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'waves.json not found' })).toBe('bad_plan');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'archive_failed' })).toBe('archive_error');
    expect(inferFailureKind({ verdict: 'FAIL', lastError: 'some other error' })).toBe('exec_error');
  });

  test('buildFailureSignature normalizes text', () => {
    const sig = buildFailureSignature('exec_error', 'Error at /path/to/file.ts:123 with id abc12345');
    expect(sig).toBe('exec_error:Error at N with id #');
  });

  test('recordGoalOutcome aggregates trajectory and feedback', () => {
    // Setup: state file, request file, trajectory, feedback
    fs.writeFileSync(
      path.join(mafwDir, 'state', 'g1.json'),
      JSON.stringify({ policySnapshot: { version: 'v1', proposalId: null } }),
      'utf-8'
    );
    fs.writeFileSync(
      path.join(mafwDir, 'requests', 'g1.json'),
      JSON.stringify({ createdAt: '2026-08-27T00:00:00Z' }),
      'utf-8'
    );
    db.addGoalSession({ goal_id: 'g1', session_id: 's1', phase: 'plan', loop: 1 });
    // Insert trajectory turn
    const rawDb = (db as any).db;
    rawDb.prepare(`
      INSERT INTO trajectory_turns (project_id, session_id, turn_id, turn_start_ms, turn_end_ms, duration_ms,
        tool_count, tool_error_count, reasoning_count, agent_switch_count, tokens, cost, finish, model, provider, agent, user_text)
      VALUES ('proj1', 's1', 1, 0, 100, 100, 0, 2, 0, 0, '{"input":100,"output":50,"reasoning":0,"cache":{"read":0,"write":0}}', 0.01, 'stop', 'm', 'p', 'a', 'hi')
    `).run();

    // Insert feedback
    fs.mkdirSync(path.join(projectDir, '.mafw', 'feedback'), { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, '.mafw', 'feedback', 't1-123.json'),
      JSON.stringify({ goalId: 'g1', type: 'thumbs_up' }),
      'utf-8'
    );

    recordGoalOutcome(db, {
      goalId: 'g1',
      verdict: 'PASS',
      rounds: 2,
      projectDir,
      mafwDir,
      projectId: 'proj1',
    });

    const outcomes = db.listGoalOutcomes({});
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].verdict).toBe('PASS');
    expect(outcomes[0].policy_version).toBe('v1');
    expect(outcomes[0].tokens_input).toBe(100);
    expect(outcomes[0].total_cost).toBe(0.01);
    expect(outcomes[0].tool_error_count).toBe(2);
    expect(outcomes[0].thumbs_up).toBe(1);
  });

  test('recordGoalOutcome fail-open on error', () => {
    // No state file, no request file 鈥?should not throw
    expect(() => {
      recordGoalOutcome(db, {
        goalId: 'g1',
        verdict: 'PASS',
        rounds: 1,
        projectDir,
        mafwDir,
        projectId: 'proj1',
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/gateway/outcome-recorder.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement outcome-recorder.ts**

```typescript
// gateway/src/orchestration/outcome-recorder.ts
import * as fs from 'fs';
import * as path from 'path';
import { GatewayDatabase, GoalOutcome } from '../memory/gateway-db';
import { getActivePolicy } from './policy';
import { log } from '../core/utils/logger';

export type GoalVerdict = 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';

export interface OutcomeInput {
  goalId: string;
  verdict: GoalVerdict;
  rounds: number;
  lastError?: string | null;
  reviewFeedback?: string | null;
  projectDir: string;
  mafwDir: string;
  projectId: string;
}

const EMPTY_TOKENS = { input: 0, output: 0 };

export function inferFailureKind(input: { verdict: string; lastError?: string | null }): string | null {
  if (input.verdict === 'PASS') return null;
  if (input.verdict === 'CANCELLED') return 'user_cancel';
  if (input.verdict === 'MAX_RETRIES') return 'max_retries';
  const err = (input.lastError || '').toLowerCase();
  if (err.includes('archive')) return 'archive_error';
  if (err.includes('waves.json') || err.includes('plan')) return 'bad_plan';
  if (err.includes('review report')) return 'review_false_fail';
  return 'exec_error';
}

export function buildFailureSignature(kind: string | null, text?: string | null): string | null {
  if (!kind) return null;
  const norm = (text || '')
    .replace(/[0-9a-f]{8,}/gi, '#')
    .replace(/\d+/g, 'N')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return norm ? `${kind}:${norm}` : kind;
}

function aggregateTrajectory(db: GatewayDatabase, sessionIds: string[]) {
  if (sessionIds.length === 0) return null;
  const rawDb = (db as any).db;
  const placeholders = sessionIds.map(() => '?').join(',');
  const rows = rawDb.prepare(
    `SELECT tokens, cost, tool_error_count FROM trajectory_turns WHERE session_id IN (${placeholders})`
  ).all(...sessionIds) as any[];
  if (rows.length === 0) return null;
  let input = 0, output = 0, cost = 0, toolErrors = 0;
  for (const r of rows) {
    const t = r.tokens ? JSON.parse(r.tokens) : EMPTY_TOKENS;
    input += t.input || 0;
    output += t.output || 0;
    cost += r.cost || 0;
    toolErrors += r.tool_error_count || 0;
  }
  return { tokens_input: input, tokens_output: output, total_cost: cost, tool_error_count: toolErrors };
}

function aggregateFeedback(projectDir: string, goalId: string): { thumbs_up: number; thumbs_down: number } {
  let up = 0, down = 0;
  const dirs = ['.mafw/feedback', '.mafw/user-feedback'];
  const seen = new Set<string>();
  for (const d of dirs) {
    const dir = path.join(projectDir, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        if (data.goalId !== goalId) continue;
        const key = data.feedbackId || f;
        if (seen.has(key)) continue;
        seen.add(key);
        if (data.type === 'thumbs_up') up++;
        if (data.type === 'thumbs_down') down++;
      } catch { /* skip malformed */ }
    }
  }
  return { thumbs_up: up, thumbs_down: down };
}

function readRequestSnapshot(mafwDir: string, goalId: string): { createdAt?: string } {
  try {
    const p = path.join(mafwDir, 'requests', `${goalId}.json`);
    if (!fs.existsSync(p)) return {};
    const req = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return { createdAt: req.createdAt };
  } catch { return {}; }
}

function readStateFile(mafwDir: string, goalId: string): any {
  try {
    const p = path.join(mafwDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch { return null; }
}

export function recordGoalOutcome(db: GatewayDatabase, input: OutcomeInput): void {
  try {
    const state = readStateFile(input.mafwDir, input.goalId);
    const snapshot = state?.policySnapshot ?? null;
    const policy = snapshot ?? getActivePolicy(input.mafwDir);
    const req = readRequestSnapshot(input.mafwDir, input.goalId);
    const createdAt = req.createdAt ?? null;
    const durationMs = createdAt ? Date.now() - new Date(createdAt).getTime() : null;
    const sessions = db.listGoalSessions(input.goalId);
    const traj = aggregateTrajectory(db, sessions.map(s => s.session_id));
    const fb = aggregateFeedback(input.projectDir, input.goalId);
    const kind = inferFailureKind(input);
    db.upsertGoalOutcome({
      goal_id: input.goalId,
      project_id: input.projectId,
      verdict: input.verdict,
      rounds: input.rounds,
      duration_ms: durationMs,
      tokens_input: traj?.tokens_input ?? null,
      tokens_output: traj?.tokens_output ?? null,
      total_cost: traj?.total_cost ?? null,
      tool_error_count: traj?.tool_error_count ?? null,
      thumbs_up: fb.thumbs_up,
      thumbs_down: fb.thumbs_down,
      policy_version: policy.version,
      evolution_proposal_id: policy.proposalId,
      failure_kind: kind,
      failure_signature: buildFailureSignature(kind, input.lastError ?? input.reviewFeedback),
      created_at: createdAt,
      archived_at: new Date().toISOString(),
    });
  } catch (err: any) {
    log.warn(`[Outcome] recordGoalOutcome failed (non-fatal): ${err.message}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/gateway/outcome-recorder.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add gateway/src/orchestration/outcome-recorder.ts tests/unit/gateway/outcome-recorder.test.ts
git commit -m "feat(gateway): add orchestration/outcome-recorder.ts"
```

---

### Task 6: goal_sessions 鎺ョ嚎

**Files:**
- Modify: `gateway/src/core/langgraph/nodes/plan.node.ts:38-42`
- Modify: `gateway/src/core/langgraph/nodes/review.node.ts:44-48`
- Modify: `gateway/src/core/langchain/node-runner.ts:103-107`
- Modify: `gateway/src/index.ts:4525-4562` (buildNodeOptions)

**Interfaces:**
- Consumes: `AgentServices` interface
- Produces: `onSessionCreated` callback wired into 3 session-creation sites

- [ ] **Step 1: Add onSessionCreated to AgentServices interfaces**

In `gateway/src/core/langchain/node-runner.ts`, add to `AgentServices` interface (line 6-15):

```typescript
export interface AgentServices {
  client: {
    session: {
      create(opts: { directory: string }): Promise<{ id: string }>;
      promptAsync(opts: { sessionID: string; parts: Array<{ type: string; text: string }> }): Promise<void>;
      delete(opts: { sessionID: string }): Promise<void>;
    };
  };
  syncToFile: (state: Partial<LoopStateType>) => void;
  onSessionCreated?: (info: { goalId: string; sessionId: string; phase: string; loop: number }) => void;
}
```

In `gateway/src/core/langgraph/nodes/review.node.ts`, add the same field to its `AgentServices` interface (line 6-15).

In `gateway/src/core/langgraph/nodes/plan.node.ts`, it imports `AgentServices` from `../../langchain/node-runner`, so no change needed there.

- [ ] **Step 2: Call onSessionCreated after session.create in node-runner.ts**

In `gateway/src/core/langchain/node-runner.ts`, after line 104 (`const sessionId = session.id;`), add:

```typescript
options.onSessionCreated?.({ goalId: goalId!, sessionId, phase: type, loop: state.round });
```

- [ ] **Step 3: Call onSessionCreated in plan.node.ts**

In `gateway/src/core/langgraph/nodes/plan.node.ts`, after line 39 (`const sessionId = session.id;`), add:

```typescript
services.onSessionCreated?.({ goalId: goalId!, sessionId, phase: 'plan', loop: state.round });
```

- [ ] **Step 4: Call onSessionCreated in review.node.ts**

In `gateway/src/core/langgraph/nodes/review.node.ts`, after line 45 (`const sessionId = session.id;`), add:

```typescript
services.onSessionCreated?.({ goalId: goalId!, sessionId, phase: 'review', loop: state.round });
```

- [ ] **Step 5: Wire onSessionCreated in buildNodeOptions**

In `gateway/src/index.ts`, in `buildNodeOptions` (line 4525), add `onSessionCreated` to the client object passed to plan/execute/review nodes. Modify the `client` creation at line 4538:

```typescript
const client = this.createInProcessClient();
const onSessionCreated = (info: { goalId: string; sessionId: string; phase: string; loop: number }) => {
  try {
    this.getGatewayDb().addGoalSession({
      goal_id: info.goalId,
      session_id: info.sessionId,
      phase: info.phase,
      loop: info.loop,
    });
  } catch { /* fail-open */ }
};
```

Then pass `onSessionCreated` to each node call (lines 4540, 4555, 4559):

```typescript
plan: async (s: any) => planNode(s, {
  client,
  syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
  onSessionCreated,
}),
```

Same for `execute` and `review`.

- [ ] **Step 6: Run full test suite**

Run: `npx jest tests/unit/gateway/`
Expected: All existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add gateway/src/core/langgraph/nodes/plan.node.ts gateway/src/core/langgraph/nodes/review.node.ts gateway/src/core/langchain/node-runner.ts gateway/src/index.ts
git commit -m "feat(gateway): wire onSessionCreated callback for goal_sessions"
```

---

### Task 7: 绛栫暐蹇収

**Files:**
- Modify: `gateway/src/core/utils/state.ts:22-36` (StateFile interface)
- Modify: `gateway/src/index.ts:4601-4615` (onGoalCreated)

**Interfaces:**
- Consumes: `getActivePolicy`
- Produces: `StateFile.policySnapshot` field

- [ ] **Step 1: Add policySnapshot to StateFile**

In `gateway/src/core/utils/state.ts`, add to `StateFile` interface (line 22-36):

```typescript
export interface StateFile {
  version: string;
  goalId: string;
  loop: number;
  phase: string | null;
  lastPhase: string | null;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, SessionInfo>;
  nextAction: string;
  artifacts: Record<string, string>;
  metrics?: Record<string, number>;
  error?: string;
  updatedAt: string;
  policySnapshot?: { version: string; proposalId: string | null };
}
```

- [ ] **Step 2: Patch policySnapshot in onGoalCreated**

In `gateway/src/index.ts`, in `onGoalCreated` (line 4601), before `graph.invoke`, add:

```typescript
try {
  await this.patchState(goalId, { policySnapshot: getActivePolicy(config.resolvePath()) } as any);
} catch { /* non-fatal */ }
```

Add import at top of index.ts:

```typescript
import { getActivePolicy } from './orchestration/policy';
```

- [ ] **Step 3: Run full test suite**

Run: `npx jest tests/unit/gateway/`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add gateway/src/core/utils/state.ts gateway/src/index.ts
git commit -m "feat(gateway): add policySnapshot to StateFile and patch in onGoalCreated"
```

---

### Task 8: archiveGoal outcome 璁板綍 + ABORT 鎺ョ嚎

**Files:**
- Modify: `gateway/src/index.ts:4183-4218` (archiveGoal)
- Modify: `gateway/src/index.ts:4563-4580` (archive lambdas)
- Modify: `gateway/src/index.ts:2732-2737` (HTTP ABORT)
- Modify: `gateway/src/index.ts:4260-4265` (control file ABORT)

**Interfaces:**
- Consumes: `recordGoalOutcome`
- Produces: outcome recorded on archive and abort

- [ ] **Step 1: Modify archiveGoal signature and add outcome recording**

In `gateway/src/index.ts`, change `archiveGoal` signature (line 4183):

```typescript
private async archiveGoal(goalId: string, outcome?: {
  verdict: 'PASS' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED';
  rounds: number;
  lastError?: string | null;
  reviewFeedback?: string | null;
}) {
```

After the successful `patchState` at line 4212-4215, add:

```typescript
if (outcome && projectDir) {
  const { recordGoalOutcome } = await import('./orchestration/outcome-recorder');
  recordGoalOutcome(this.getGatewayDb(), {
    goalId,
    verdict: outcome.verdict,
    rounds: outcome.rounds,
    lastError: outcome.lastError,
    reviewFeedback: outcome.reviewFeedback,
    projectDir,
    mafwDir: path.join(projectDir, '.mafw'),
    projectId: projectDir,
  });
}
```

In the catch branch (line 4200-4208), after `patchState`, add:

```typescript
if (outcome) {
  const { recordGoalOutcome } = await import('./orchestration/outcome-recorder');
  recordGoalOutcome(this.getGatewayDb(), {
    goalId,
    verdict: outcome.verdict,
    rounds: outcome.rounds,
    lastError: `archive_failed: ${err.message}`,
    reviewFeedback: outcome.reviewFeedback,
    projectDir: projectDir!,
    mafwDir: path.join(projectDir!, '.mafw'),
    projectId: projectDir!,
  });
}
```

- [ ] **Step 2: Update archive lambdas to pass outcome**

In `gateway/src/index.ts`, modify the three archive lambdas (lines 4563-4580):

```typescript
archiveSuccess: async (s: any) => {
  log.info(`[Scheduler] Goal ${s.goalId} PASSED`);
  syncToFile({ ...s, phase: 'ARCHIVED' });
  await this.archiveGoal(s.goalId, { verdict: 'PASS', rounds: s.round, reviewFeedback: s.reviewFeedback });
  return {};
},
archiveFail: async (s: any) => {
  log.error(`[Scheduler] Goal ${s.goalId} FAILED: ${s.lastError}`);
  syncToFile({ ...s, phase: 'FAILED' });
  await this.archiveGoal(s.goalId, { verdict: 'FAIL', rounds: s.round, lastError: s.lastError, reviewFeedback: s.reviewFeedback });
  return {};
},
archiveMaxRetries: async (s: any) => {
  log.error(`[Scheduler] Goal ${s.goalId} max retries`);
  syncToFile({ ...s, phase: 'FAILED' });
  await this.archiveGoal(s.goalId, { verdict: 'MAX_RETRIES', rounds: s.round, lastError: s.lastError });
  return {};
},
```

- [ ] **Step 3: Wire ABORT paths**

In `gateway/src/index.ts`, at line 2732 (HTTP ABORT), change:

```typescript
case 'ABORT':
  if (control.goalId) {
    await this.destroyAllSessions(control.goalId);
    await this.patchState(control.goalId, { nextAction: 'FAILED' });
    const state = this.activeGoals.get(control.goalId);
    await this.archiveGoal(control.goalId, {
      verdict: 'CANCELLED',
      rounds: state?.loop ?? 0,
    });
  }
  break;
```

At line 4260 (control file ABORT), make the same change.

- [ ] **Step 4: Run full test suite**

Run: `npx jest tests/unit/gateway/`
Expected: All existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): record outcome on archive and abort"
```

---

### Task 9: API 璺敱

**Files:**
- Modify: `gateway/src/index.ts` (API server section)

**Interfaces:**
- Consumes: `GatewayDatabase.listGoalOutcomes`
- Produces: `GET /api/orchestration/outcomes` endpoint

- [ ] **Step 1: Add API route**

In `gateway/src/index.ts`, in the API server section (near other `/api/` routes), add:

```typescript
if (req.url?.match(/^\/api\/orchestration\/outcomes(?:\?|$)/) && req.method === 'GET') {
  const u = new URL(req.url, 'http://localhost');
  const rows = this.getGatewayDb().listGoalOutcomes({
    policy: u.searchParams.get('policy') || undefined,
    verdict: u.searchParams.get('verdict') || undefined,
    project: u.searchParams.get('project') || undefined,
    limit: parseInt(u.searchParams.get('limit') || '100', 10),
  });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ outcomes: rows }));
  return;
}
```

- [ ] **Step 2: Run full test suite**

Run: `npx jest tests/unit/gateway/`
Expected: All existing tests still pass

- [ ] **Step 3: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(gateway): add GET /api/orchestration/outcomes endpoint"
```

---

### Task 10: AGENTS.md 鏇存柊

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add orchestration section to AGENTS.md**

In `AGENTS.md`, add a new section (e.g., after 搂5.19):

```markdown
### 5.20 Goal 缂栨帓 RSI 鈥?Phase 1 瑙傛祴灞?
**鏁版嵁妯″瀷**锛坓ateway.db锛夛細
- `goal_outcomes`锛氭瘡涓?goal 褰掓。鏃跺啓涓€琛岋紙verdict銆佽疆鏁般€佹垚鏈€乼humbs銆乸olicy_version銆乫ailure_kind/signature锛?- `goal_sessions`锛歡oal 鐢熷懡鍛ㄦ湡鍐呮墍鏈?session 鐨勮拷鍔犳槧灏勶紙璞佸厤 trajectory 14 澶?prune锛?- `evolution_proposals`锛氭紨鍖栨彁璁〃锛圥hase 2 浣跨敤锛孭hase 1 浠呭缓琛級

**鍐欏叆鐐?*锛?- 涓変釜 session 鍒涘缓鑺傜偣锛坧lan/execute/review锛夎皟鐢?`onSessionCreated` 杩藉姞 goal_sessions
- archiveGoal 鎴愬姛鍚庤皟鐢?`recordGoalOutcome` 鑱氬悎 trajectory + feedback 鍐欏叆 outcome
- ABORT锛圚TTP + control file锛夎皟鐢?archiveGoal(verdict='CANCELLED')
- onGoalCreated 鍐?`policySnapshot` 鍒?state.json

**鏌ヨ**锛?- `GET /api/orchestration/outcomes?policy=&verdict=&project=&limit=`

**缁勪欢娉ㄥ唽琛?*锛?- `gateway/src/orchestration/registry.ts` 澹版槑鍙紨鍖栫粍浠讹紙Phase 1 鍙锛?- `gateway/src/orchestration/policy.ts` 璇?`~/.mafw/orchestration/active.json` 鍥為€€ builtin-v1

**璁捐鍘熷垯**锛?- 鎵€鏈夊啓鍏?fail-open锛屼笉褰卞搷涓绘祦绋?- upsert 骞傜瓑锛岄噸澶嶅綊妗ｆ洿鏂?- trajectory prune 璞佸厤宸茬櫥璁?session
```

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: add goal orchestration RSI phase-1 section to AGENTS.md"
```

---

## Self-Review Checklist

- [ ] Spec coverage: all 11 sections of the spec have corresponding tasks
- [ ] Placeholder scan: no "TBD", "TODO", or "implement later"
- [ ] Type consistency: `GoalOutcome` interface matches `upsertGoalOutcome` parameters; `OutcomeInput` matches `recordGoalOutcome` parameters
- [ ] File paths: all paths are exact and verified
- [ ] Test commands: all use `npx jest tests/unit/gateway/<file>.test.ts` from repo root
- [ ] Commit commands: all use specific file paths (no directory-level add)
