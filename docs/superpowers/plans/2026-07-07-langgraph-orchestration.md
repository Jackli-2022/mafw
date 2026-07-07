# LangGraph Orchestration Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MAFW's custom state machine (`loop-state-machine.ts` + `phase-orchestrator.ts`) with LangGraph, keeping OpenCode Sessions as isolated agent boundaries.

**Architecture:** LangGraph serves as a "process orchestrator" — it only decides "what happens next" (Plan → Execute → Review → conditional route back or finish). Each LangGraph node creates an independent OpenCode Session via the SDK, preserving context isolation. State stores only file paths and verdict metadata, never LLM payloads.

**Tech Stack:** TypeScript, @langchain/langgraph ^1.4.7, @langchain/core ^1.1.48, @langchain/langgraph-checkpoint-sqlite, zod ^3.25.32

## Global Constraints

- OpenCode Session isolation must be preserved — one Session per agent execution
- LangGraph State must NOT contain prompts, messages, or tool_calls — only file paths + verdict
- File writes must use atomic `.tmp → rename` pattern to prevent partial reads
- Dashboard reads `state.json` — `syncToDashboard()` must be called after each node
- Existing `src/skills/mafw-*/entry.ts` files must NOT be modified
- Gateway `package.json` in `gateway/` directory — root `package.json` for plugin code
- Test coverage threshold: 80% (jest config)

---

### Task 1: Add dependencies + create directory skeleton

**Files:**
- Modify: `package.json`
- Create: `src/langgraph/` (directory)
- Create: `src/langgraph/nodes/` (directory)
- Test: none

- [ ] **Step 1: Create directories**

```bash
mkdir -p src/langgraph/nodes
mkdir -p tests/unit/langgraph
```

- [ ] **Step 2: Add dependencies to package.json**

Insert after the last existing dependency:

```json
    "@langchain/core": "^1.1.48",
    "@langchain/langgraph": "^1.4.7",
    "@langchain/langgraph-checkpoint-sqlite": "^1.1.3",
    "zod": "^3.25.32",
```

- [ ] **Step 3: Install**

```bash
npm install
```

- [ ] **Step 4: Verify install**

```bash
npm ls @langchain/langgraph @langchain/core @langchain/langgraph-checkpoint-sqlite zod
```

Expected: all packages listed without errors.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @langchain/langgraph and related dependencies"
```

---

### Task 2: Define LangGraph State

**Files:**
- Create: `src/langgraph/loop-state.ts`
- Test: none (pure type definition)

- [ ] **Step 1: Create loop-state.ts**

```typescript
import { Annotation } from "@langchain/langgraph";

export const LoopState = Annotation.Root({
  // ── 输入（Gateway 注入，只读） ──
  goalId: Annotation<string>,
  projectDir: Annotation<string>,
  mafwDir: Annotation<string>,

  // ── 循环控制 ──
  round: Annotation<number>({
    reducer: (a?: number, b?: number) => (b ?? a ?? 0),
    default: () => 1,
  }),
  maxRounds: Annotation<number>({ default: () => 3 }),

  // ── Plan 产出 ──
  wavePlanPath: Annotation<string | null>({
    default: () => null,
  }),

  // ── Execute 产出 ──
  receiptPath: Annotation<string | null>({
    default: () => null,
  }),

  // ── Review 产出 ──
  reviewVerdict: Annotation<"PASS" | "FAIL" | "ERROR">({
    default: () => "FAIL" as const,
  }),
  reviewReportPath: Annotation<string | null>({
    default: () => null,
  }),
  reviewFeedback: Annotation<string>({
    default: () => "",
  }),

  // ── 异常 ──
  lastError: Annotation<string | null>({
    default: () => null,
  }),
});

export type LoopStateType = typeof LoopState.State;
```

- [ ] **Step 2: Commit**

```bash
git add src/langgraph/loop-state.ts
git commit -m "feat(langgraph): define LoopState with Annotation.Root"
```

---

### Task 3: Create session utils + tests

**Files:**
- Create: `src/langgraph/nodes/session.utils.ts`
- Create: `tests/unit/langgraph/session.utils.test.ts`

- [ ] **Step 1: Create session.utils.ts**

```typescript
import * as fs from 'fs';

/**
 * Polling wait for file to appear (atomic rename gate).
 * Plan writes waves.json.tmp → rename → Execute reads waves.json.
 */
export async function waitForFile(
  filePath: string,
  timeoutMs: number = 5 * 60 * 1000,
  pollInterval: number = 500
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (fs.existsSync(filePath)) {
        fs.accessSync(filePath, fs.constants.R_OK);
        return true;
      }
    } catch {
      // file locked or being written, retry
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  return false;
}

export interface SessionClient {
  create: (opts: { directory: string; metadata?: Record<string, unknown> }) => Promise<{ id: string; createdAt?: string }>;
  promptAsync: (opts: { sessionID: string; message: string }) => Promise<unknown>;
  delete: (opts: { sessionID: string }) => Promise<unknown>;
}

/**
 * Create an OpenCode Session → send prompt → return session ID.
 * Caller checks file existence to determine completion.
 */
export async function createAndPromptSession(
  client: SessionClient,
  projectDir: string,
  skillCommand: string,
  goalId: string,
): Promise<string> {
  const session = await client.create({
    directory: projectDir,
    metadata: { mafw: true, goalId, skill: skillCommand },
  });
  await client.promptAsync({
    sessionID: session.id,
    message: `${skillCommand} ${goalId}`,
  });
  return session.id;
}

/**
 * Destroy a session, ignoring 404 errors.
 */
export async function destroySession(
  client: SessionClient,
  sessionId: string
): Promise<void> {
  try {
    await client.delete({ sessionID: sessionId });
  } catch {
    // session may have been destroyed already
  }
}
```

- [ ] **Step 2: Create session.utils.test.ts**

```typescript
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { waitForFile } from '../../../src/langgraph/nodes/session.utils';

describe('waitForFile', () => {
  it('resolves when file appears within timeout', async () => {
    const tmp = path.join(os.tmpdir(), `test-waitforfile-${Date.now()}`);
    setTimeout(() => fs.writeFileSync(tmp, 'ok'), 50);
    const result = await waitForFile(tmp, 1000);
    expect(result).toBe(true);
    fs.unlinkSync(tmp);
  });

  it('returns false when file does not appear within timeout', async () => {
    const result = await waitForFile('/nonexistent-file-XXXX.json', 100);
    expect(result).toBe(false);
  });

  it('handles empty file path gracefully', async () => {
    await expect(waitForFile('', 10)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx jest tests/unit/langgraph/session.utils.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/langgraph/nodes/session.utils.ts tests/unit/langgraph/session.utils.test.ts
git commit -m "feat(langgraph): add session utils with file wait gate"
```

---

### Task 4: Create Plan Node

**Files:**
- Create: `src/langgraph/nodes/plan.node.ts`
- Test: none (requires running OpenCode SDK context)

- [ ] **Step 1: Create plan.node.ts**

```typescript
import { LoopStateType } from '../loop-state';
import { createAndPromptSession, destroySession, waitForFile, SessionClient } from './session.utils';
import * as path from 'path';
import * as fs from 'fs';

export interface PlanNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
}

/**
 * LangGraph Node: creates a Plan OpenCode Session, waits for waves.json.
 */
export async function planNode(
  state: LoopStateType,
  options: PlanNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 5 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-plan',
    goalId,
  );

  const wavesPath = path.join(mafwDir, 'waves.json');
  const found = await waitForFile(wavesPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Plan session ${sessionId} timed out waiting for waves.json`,
      reviewVerdict: 'ERROR',
    };
  }

  try {
    const content = fs.readFileSync(wavesPath, 'utf-8');
    JSON.parse(content);
  } catch (err: any) {
    return {
      lastError: `Plan output waves.json is invalid: ${err.message}`,
      reviewVerdict: 'ERROR',
    };
  }

  return {
    wavePlanPath: wavesPath,
    round: state.round,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/langgraph/nodes/plan.node.ts
git commit -m "feat(langgraph): add plan node"
```

---

### Task 5: Create Execute Node

**Files:**
- Create: `src/langgraph/nodes/execute.node.ts`
- Test: none

- [ ] **Step 1: Create execute.node.ts**

```typescript
import { LoopStateType } from '../loop-state';
import { createAndPromptSession, destroySession, waitForFile, SessionClient } from './session.utils';
import * as path from 'path';

export interface ExecuteNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
}

/**
 * LangGraph Node: creates an Execute OpenCode Session, waits for receipts.
 */
export async function executeNode(
  state: LoopStateType,
  options: ExecuteNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 10 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-execute',
    goalId,
  );

  const receiptsDir = path.join(mafwDir, 'receipts', goalId);
  const receiptPath = path.join(receiptsDir, 'loop-receipt.json');
  const found = await waitForFile(receiptPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Execute session ${sessionId} timed out waiting for receipts`,
      reviewVerdict: 'ERROR',
    };
  }

  return { receiptPath };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/langgraph/nodes/execute.node.ts
git commit -m "feat(langgraph): add execute node"
```

---

### Task 6: Create Review Node + tests

**Files:**
- Create: `src/langgraph/nodes/review.node.ts`
- Create: `tests/unit/langgraph/review.node.test.ts`

- [ ] **Step 1: Create review.node.ts**

```typescript
import { LoopStateType } from '../loop-state';
import { createAndPromptSession, destroySession, waitForFile, SessionClient } from './session.utils';
import * as path from 'path';
import * as fs from 'fs';

export interface ReviewNodeOptions {
  client: SessionClient;
  sessionTimeoutMs?: number;
}

export interface VerdictResult {
  verdict: 'PASS' | 'FAIL' | 'ERROR';
  feedback: string;
}

/**
 * Parse review content string into structured verdict.
 * Supports JSON format and keyword fallback.
 */
export function parseReviewVerdict(content: string): VerdictResult {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }

  try {
    const data = JSON.parse(content);
    return {
      verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL',
      feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}),
    };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) {
      return { verdict: 'PASS', feedback: content.slice(0, 200) };
    }
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

/**
 * LangGraph Node: creates a Review OpenCode Session, parses verdict.
 */
export async function reviewNode(
  state: LoopStateType,
  options: ReviewNodeOptions
): Promise<Partial<LoopStateType>> {
  const { client, sessionTimeoutMs = 5 * 60 * 1000 } = options;
  const { mafwDir, goalId } = state;

  const sessionId = await createAndPromptSession(
    client,
    state.projectDir,
    '/skill mafw-review',
    goalId,
  );

  const reviewPath = path.join(mafwDir, 'reviews', `${goalId}-loop${state.round}.md`);
  const found = await waitForFile(reviewPath, sessionTimeoutMs);

  await destroySession(client, sessionId);

  if (!found) {
    return {
      lastError: `Review session ${sessionId} timed out waiting for review report`,
      reviewVerdict: 'ERROR',
    };
  }

  let content: string;
  try {
    content = fs.readFileSync(reviewPath, 'utf-8');
  } catch (err: any) {
    return {
      lastError: `Cannot read review report at ${reviewPath}: ${err.message}`,
      reviewVerdict: 'ERROR',
    };
  }

  const verdict = parseReviewVerdict(content);

  return {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
  };
}
```

- [ ] **Step 2: Create review.node.test.ts**

```typescript
import { parseReviewVerdict } from '../../../src/langgraph/nodes/review.node';

describe('parseReviewVerdict', () => {
  it('parses PASS verdict from JSON', () => {
    const result = parseReviewVerdict('{"verdict":"PASS","reason":"All tests pass","metrics":{"coverage":90}}');
    expect(result.verdict).toBe('PASS');
    expect(result.feedback).toContain('All tests pass');
  });

  it('parses FAIL verdict from JSON', () => {
    const result = parseReviewVerdict('{"verdict":"FAIL","reason":"Coverage below 80%","metrics":{"coverage":65}}');
    expect(result.verdict).toBe('FAIL');
  });

  it('falls back to keyword matching when JSON is malformed', () => {
    const result = parseReviewVerdict('PASS: everything looks good');
    expect(result.verdict).toBe('PASS');
  });

  it('returns ERROR on empty content', () => {
    const result = parseReviewVerdict('');
    expect(result.verdict).toBe('ERROR');
  });

  it('returns FAIL on unrecognized content', () => {
    const result = parseReviewVerdict('some ambiguous text');
    expect(result.verdict).toBe('FAIL');
  });
});
```

- [ ] **Step 3: Run test to verify it passes**

```bash
npx jest tests/unit/langgraph/review.node.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/langgraph/nodes/review.node.ts tests/unit/langgraph/review.node.test.ts
git commit -m "feat(langgraph): add review node with verdict parsing"
```

---

### Task 7: Create Sync Node

**Files:**
- Create: `src/langgraph/nodes/sync.node.ts`
- Test: none

- [ ] **Step 1: Create sync.node.ts**

```typescript
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Sync current LangGraph state to state.json for Dashboard compatibility.
 * Called after every node to keep the Dashboard's polling loop working.
 */
export function syncToDashboard(state: LoopStateType): void {
  const statePath = path.join(state.mafwDir, 'state', `${state.goalId}.json`);
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const phaseMap: Record<string, string> = {
    plan_node: 'PLANNING',
    execute_node: 'EXECUTING',
    review_node: 'REVIEWING',
    archive_success: 'ARCHIVED',
    archive_fail: 'FAILED',
    archive_max_retries: 'FAILED',
  };

  const nextAction = state.reviewVerdict === 'PASS' ? 'COMPLETED'
    : state.lastError ? 'FAILED'
    : 'WAIT_PHASE_COMPLETE';

  const dashboardState = {
    version: '2',
    goalId: state.goalId,
    loop: state.round,
    phase: phaseMap[nextAction] || 'PLANNING',
    nextAction,
    artifacts: {
      wavePlan: state.wavePlanPath,
      receipt: state.receiptPath,
      review: state.reviewReportPath,
    },
    error: state.lastError || null,
    reviewFeedback: state.reviewFeedback,
    updatedAt: new Date().toISOString(),
  };

  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(dashboardState, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);
}

/**
 * LangGraph Node: sync and return empty state (no state mutations).
 */
export async function syncNode(
  state: LoopStateType,
): Promise<Partial<LoopStateType>> {
  syncToDashboard(state);
  return {};
}
```

- [ ] **Step 2: Commit**

```bash
git add src/langgraph/nodes/sync.node.ts
git commit -m "feat(langgraph): add sync node for Dashboard compatibility"
```

---

### Task 8: Build LangGraph graph + routing + tests

**Files:**
- Create: `src/langgraph/graph.ts`
- Create: `tests/unit/langgraph/graph.test.ts`

- [ ] **Step 1: Create graph.test.ts**

```typescript
import { routeAfterReview } from '../../../src/langgraph/graph';

describe('routeAfterReview', () => {
  it('routes to archive_success on PASS', () => {
    const result = routeAfterReview({
      reviewVerdict: 'PASS',
      round: 1,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('archive_success');
  });

  it('routes to archive_fail on ERROR', () => {
    const result = routeAfterReview({
      reviewVerdict: 'ERROR',
      round: 1,
      maxRounds: 3,
      lastError: 'timeout',
    } as any);
    expect(result).toBe('archive_fail');
  });

  it('routes back to plan_node on FAIL when rounds remain', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 1,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('plan_node');
  });

  it('routes to archive_max_retries on FAIL when maxRounds reached', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 3,
      maxRounds: 3,
      lastError: null,
    } as any);
    expect(result).toBe('archive_max_retries');
  });

  it('routes to archive_fail when both ERROR and maxRounds', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL',
      round: 5,
      maxRounds: 3,
      lastError: 'something broke',
    } as any);
    expect(result).toBe('archive_fail');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/langgraph/graph.test.ts --no-coverage
```

Expected: FAIL (module not found)

- [ ] **Step 3: Create graph.ts**

```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { LoopState } from "./loop-state";

/**
 * Conditional edge router after review/sync node.
 * Determines whether to loop back to plan, or terminate.
 */
export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.reviewVerdict === "ERROR" || state.lastError) {
    return "archive_fail";
  }
  if (state.reviewVerdict === "PASS") {
    return "archive_success";
  }
  if (state.round >= state.maxRounds) {
    return "archive_max_retries";
  }
  return "plan_node";
}

export interface GraphNodes {
  planNode: any;
  executeNode: any;
  reviewNode: any;
  syncNode: any;
  archiveSuccess: any;
  archiveFail: any;
  archiveMaxRetries: any;
}

/**
 * Build the compiled LangGraph for the Plan→Execute→Review loop.
 */
export function buildLoopGraph(nodes: GraphNodes) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan_node", nodes.planNode)
    .addNode("execute_node", nodes.executeNode)
    .addNode("review_node", nodes.reviewNode)
    .addNode("sync_node", nodes.syncNode)
    .addNode("archive_success", nodes.archiveSuccess)
    .addNode("archive_fail", nodes.archiveFail)
    .addNode("archive_max_retries", nodes.archiveMaxRetries)

    .addEdge("__start__", "plan_node")
    .addEdge("plan_node", "execute_node")
    .addEdge("execute_node", "review_node")
    .addEdge("review_node", "sync_node")

    .addConditionalEdges("sync_node", routeAfterReview, {
      plan_node: "plan_node",
      archive_success: "archive_success",
      archive_fail: "archive_fail",
      archive_max_retries: "archive_max_retries",
    })

    .addEdge("archive_success", END)
    .addEdge("archive_fail", END)
    .addEdge("archive_max_retries", END);

  return workflow.compile();
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/langgraph/graph.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/langgraph/graph.ts tests/unit/langgraph/graph.test.ts
git commit -m "feat(langgraph): add StateGraph with conditional routing"
```

---

### Task 9: Barrel export

**Files:**
- Create: `src/langgraph/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
export { LoopState } from './loop-state';
export type { LoopStateType } from './loop-state';
export { buildLoopGraph, routeAfterReview } from './graph';
export { planNode } from './nodes/plan.node';
export { executeNode } from './nodes/execute.node';
export { reviewNode, parseReviewVerdict } from './nodes/review.node';
export { syncNode, syncToDashboard } from './nodes/sync.node';
export { createAndPromptSession, waitForFile, destroySession } from './nodes/session.utils';
export type { SessionClient } from './nodes/session.utils';
```

- [ ] **Step 2: Commit**

```bash
git add src/langgraph/index.ts
git commit -m "feat(langgraph): add barrel export"
```

---

### Task 10: Modify Gateway scheduler

**Files:**
- Modify: `gateway/src/index.ts`

- [ ] **Step 1: Add LangGraph imports to Gateway**

At the top of `gateway/src/index.ts`, add:

```typescript
import { buildLoopGraph, LoopState, syncToDashboard,
  planNode, executeNode, reviewNode, syncNode,
  createAndPromptSession, waitForFile, destroySession } from '../../src/langgraph';
import { MemorySaver } from '@langchain/langgraph-checkpoint-sqlite';
```

- [ ] **Step 2: Add `runLoopGraph` method to MafwScheduler**

```typescript
private async runLoopGraph(goalId: string, projectDir: string, mafwDir: string) {
  const checkpointer = new MemorySaver();

  // Resolve maxRounds from request file
  let maxRounds = 3;
  try {
    const reqPath = path.join(mafwDir, 'requests', `${goalId}.json`);
    if (fs.existsSync(reqPath)) {
      const req = JSON.parse(fs.readFileSync(reqPath, 'utf-8'));
      maxRounds = req.maxLoops || 3;
    }
  } catch { /* use default */ }

  const graph = buildLoopGraph({
    planNode: async (s: any) => {
      const result = await planNode(s, { client: this.opencodeClient });
      await this.loopSync(s, result, projectDir, mafwDir);
      return result;
    },
    executeNode: async (s: any) => {
      const result = await executeNode(s, { client: this.opencodeClient });
      await this.loopSync(s, result, projectDir, mafwDir);
      return result;
    },
    reviewNode: async (s: any) => {
      const result = await reviewNode(s, { client: this.opencodeClient });
      await this.loopSync(s, result, projectDir, mafwDir);
      return result;
    },
    syncNode: async (s: any) => {
      syncToDashboard({ ...s, projectDir, mafwDir });
      return {};
    },
    archiveSuccess: async (s: any) => {
      console.log(`[Scheduler] Goal ${goalId} PASSED after ${s.round} round(s)`);
      syncToDashboard({ ...s, projectDir, mafwDir });
      return {};
    },
    archiveFail: async (s: any) => {
      console.error(`[Scheduler] Goal ${goalId} FAILED: ${s.lastError}`);
      syncToDashboard({ ...s, projectDir, mafwDir });
      return {};
    },
    archiveMaxRetries: async (s: any) => {
      console.error(`[Scheduler] Goal ${goalId} max retries (${s.maxRounds}) reached`);
      syncToDashboard({ ...s, projectDir, mafwDir });
      return {};
    },
  });

  const initialState = {
    goalId,
    projectDir,
    mafwDir,
    round: 1,
    maxRounds,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
  };

  const config = {
    configurable: { thread_id: goalId },
    checkpointer,
  };

  const finalState = await graph.invoke(initialState, config);
  console.log(`[Scheduler] Goal ${goalId} loop complete:`, finalState.reviewVerdict);
}

private async loopSync(
  current: any,
  result: any,
  projectDir: string,
  mafwDir: string
): Promise<void> {
  const merged = { ...current, ...result, projectDir, mafwDir };
  syncToDashboard(merged);
  this.broadcast({
    type: 'loop_transition',
    timestamp: new Date().toISOString(),
    goalId: current.goalId,
    loopNum: current.round,
    data: { phase: result.lastError ? 'FAILED' : current.reviewVerdict }
  });
}
```

- [ ] **Step 3: Modify `handleValidate()` to call `runLoopGraph`**

Replace the `createPhaseSession` call near the end of `handleValidate`:

```typescript
// Instead of:
// await this.createPhaseSession(goalId, 'plan', '/skill mafw-plan');

// Use:
setImmediate(() => {
  this.runLoopGraph(goalId, projectDir, mafwDir).catch(err => {
    console.error(`[Scheduler] Loop graph failed for ${goalId}:`, err);
  });
});
```

The `setImmediate` prevents the graph from blocking the HTTP response.

- [ ] **Step 4: Remove or gate old orchestration methods**

Comment out `advanceStateMachines()` and add a deprecation log. Remove `createPhaseSession()`, `startSessionMonitor()`, `checkHeartbeats()`, `phaseToCreateAction()` — they are no longer used.

Keep `destroySession()`, `patchState()`, `archiveGoal()` for Dashboard manual control compatibility.

- [ ] **Step 5: Verify Gateway compiles**

```bash
cd gateway
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(langgraph): modify Gateway to use graph.invoke instead of manual state machine"
```

---

### Task 11: Delete old state machine files

**Files:**
- Delete: `src/engine/loop-state-machine.ts`
- Delete: `src/engine/phase-orchestrator.ts` (or simplify if referenced by skills)

- [ ] **Step 1: Check references**

```bash
rg "loop-state-machine" --type ts
rg "phase-orchestrator" --type ts
rg "LoopStateMachine" --type ts
```

If `transitionPhase` is still referenced by `src/skills/mafw-*/entry.ts`, keep `phase-orchestrator.ts` but simplify it.

- [ ] **Step 2: If skill entries reference transitionPhase, simplify it**

Replace `phase-orchestrator.ts` with:

```typescript
import * as fs from 'fs';
import * as path from 'path';

/**
 * Simplified transitionPhase — no state machine logic.
 * Only writes state.json for Dashboard visibility.
 * LangGraph handles all orchestration decisions.
 */
export async function transitionPhase(
  goalId: string,
  params: { from: string; to: string; nextAction?: string; artifacts?: any; error?: string },
  projectDir: string
): Promise<void> {
  const statePath = path.join(projectDir, '.opencode/mafw/state', `${goalId}.json`);
  if (!fs.existsSync(statePath)) return;

  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
  state.phase = params.to;
  if (params.nextAction) state.nextAction = params.nextAction;
  if (params.artifacts) state.artifacts = { ...state.artifacts, ...params.artifacts };
  if (params.error) state.error = params.error;
  state.updatedAt = new Date().toISOString();

  const tmpPath = `${statePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  fs.renameSync(tmpPath, statePath);
}
```

Delete `loop-state-machine.ts` entirely.

- [ ] **Step 3: Commit**

```bash
git add src/engine/loop-state-machine.ts --delete
git add src/engine/phase-orchestrator.ts  # simplified version
git commit -m "refactor(langgraph): remove custom state machine, replaced by LangGraph"
```

---

### Task 12: Type check + lint + full test suite

- [ ] **Step 1: TypeScript compile check**

```bash
npx tsc --noEmit
```

Expected: 0 errors

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass (≥80% coverage)

- [ ] **Step 3: Fix any issues**

If tests fail, fix them. If coverage drops below 80%, add tests.

- [ ] **Step 4: Final commit with any fixes**

```bash
git add -A
git commit -m "chore: fix type and test issues after LangGraph integration"
```
