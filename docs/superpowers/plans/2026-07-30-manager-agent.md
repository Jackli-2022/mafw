# Manager Agent v7.0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a conversational Manager Agent on top of the LangGraph loop engine — user chats, Manager triggers goals, monitors progress via dual-path wake-up (event + cron), and handles mid-loop clarifications via interrupt-based HITL.

**Architecture:** Manager is a fourth Phase Agent (persistent session, pinned, tool-driven) sitting outside LangGraph. Loop gains interrupt() inside plan/review nodes routed through a new askUser micro-node. AutomationEngine extended with event triggers and manager:* action handlers. Dual-channel rendering (opencode plugin + Desktop widget) for user questions.

**Tech Stack:** TypeScript, @langchain/langgraph (StateGraph, interrupt, Annotation), AutomationEngine (cron + new event trigger), ChatSessionManager (SSE), Jest + ts-jest

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-30-manager-agent-design.md`
- Coverage threshold: 80% (jest.config.js)
- LoopState: reducer uses `(a, b) => b === undefined ? a : b` for clearable fields
- `interrupt()` return after resume IS the user's answer (not persisted in another channel)
- Question ledger: JSONL event-sourcing, append-only, fold for current state
- Manager session: exempt from trim/evict/archive via metadata flags
- Event trigger: perGoalCooldown 60s, stateVersion-based dedup
- System rules: auto-rebuild on Gateway start if missing, respect explicit `enabled: false`
- No filesystem mutation in Manager tools (only Gateway API + existing MCP infrastructure)

---

## Task 1: AutomationEngine handler registry refactor

**Files**
- Modify: `gateway/src/automation-engine.ts`
- Create: `tests/unit/automation-engine-actions.test.ts`

**Interfaces**
- Consumes: `MemoryActionType`, `AutomationRule`
- Produces: `ActionHandler` type, `actionRegistry` export

**Steps**

- [ ] 1. Add `ActionHandler` type and `actionRegistry` Map at module top (after imports):

```typescript
export type ActionHandler = (
  rule: AutomationRule,
  engine: AutomationEngine
) => Promise<void>;
export const actionRegistry: Map<string, ActionHandler> = new Map();
```

- [ ] 2. Replace `private async executeAction(actionType: MemoryActionType)` with:

```typescript
private async executeAction(actionType: string, rule: AutomationRule): Promise<void> {
  const handler = actionRegistry.get(actionType);
  if (!handler) {
    console.warn(`[AutomationEngine] No handler registered for action: ${actionType}`);
    return;
  }
  try {
    await handler(rule, this);
  } catch (err: any) {
    console.error(`[AutomationEngine] Action ${actionType} failed: ${err.message}`);
  }
}
```

- [ ] 3. Update `executeRule()` call sites — change `this.executeAction(rule.action.type)` to `this.executeAction(rule.action.type, rule)` (lines ~143 and ~392)

- [ ] 4. Update `validateRule()` line ~442 — change action type check from `['memory:distill', 'memory:decay', 'memory:review', 'memory:prune'].includes(rule.action.type)` to `actionRegistry.has(rule.action.type)`

- [ ] 5. Register 4 memory actions in constructor (at end of `constructor(mafwDir)`):

```typescript
actionRegistry.set('memory:distill', async (_rule, engine) => {
  console.log('[AutomationEngine] Starting memory distillation...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const result = await runDistillation(indexManager, engine['mafwDir']);
  console.log(`[AutomationEngine] Distillation complete: created ${result.created}, locked ${result.locked}`);
});
actionRegistry.set('memory:decay', async (_rule, engine) => {
  console.log('[AutomationEngine] Running energy decay...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const index = indexManager.getIndex();
  const energySystem = new EnergySystem();
  let decayed = 0;
  for (const entry of index.entries) {
    const salience = (entry as any).salience || 1.0;
    const daysSinceUpdate = entry.energy > 0 ? 1 : 0;
    const newEnergy = energySystem.calculateEnergy(entry.energy, { type: 'retrieved' }, daysSinceUpdate, salience, entry.id);
    const diff = entry.energy - newEnergy;
    if (diff > 0.005) { indexManager.updateEnergy(entry.id, -(diff)); decayed++; }
  }
  console.log(`[AutomationEngine] Energy decay applied to ${decayed} entries`);
});
actionRegistry.set('memory:review', async (_rule, engine) => {
  console.log('[AutomationEngine] Checking review queue...');
  const indexManager = new HarmonicIndexManager(engine['mafwDir']);
  const scheduler = new ReviewScheduler(indexManager, engine['mafwDir']);
  scheduler.tick();
  const queue = scheduler.getReviewQueue();
  console.log(`[AutomationEngine] Review queue: ${queue.length} items due`);
});
actionRegistry.set('memory:prune', async (_rule, engine) => {
  console.log('[AutomationEngine] Pruning cognitive graph...');
  const graph = new CognitiveGraphManager(engine['mafwDir']);
  const before = graph.getGraph().edges.length;
  graph.prune(0.1);
  const after = graph.getGraph().edges.length;
  const pruned = before - after;
  if (pruned > 0) {
    console.log(`[AutomationEngine] Pruned ${pruned} low-weight edges`);
  } else {
    console.log('[AutomationEngine] No edges to prune');
  }
});
```

- [ ] 6. Remove dead private methods: `runDistill()`, `runDecay()`, `runReview()`, `runPrune()` (these are now inline in registry)

- [ ] 7. Move `mafwDir` from `private` to `readonly mafwDir: string` so it's accessible from handlers

- [ ] 8. Write test `tests/unit/automation-engine-actions.test.ts`:

```typescript
import { AutomationEngine, actionRegistry, ActionHandler, AutomationRule } from '../../../src/automation-engine';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

describe('AutomationEngine actionRegistry', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-ae-test-'));
  });
  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('has 4 memory actions registered', () => {
    expect(actionRegistry.has('memory:distill')).toBe(true);
    expect(actionRegistry.has('memory:decay')).toBe(true);
    expect(actionRegistry.has('memory:review')).toBe(true);
    expect(actionRegistry.has('memory:prune')).toBe(true);
  });

  it('executes handler without error for memory:distill', async () => {
    const handler = actionRegistry.get('memory:distill')!;
    const engine = new AutomationEngine(tmpDir);
    // should not throw
    await handler({ id: 'test', enabled: true, trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' } }, engine);
  });

  it('validateRule accepts registered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'memory:distill' },
    });
    expect(result.valid).toBe(true);
  });

  it('validateRule rejects unregistered action types', () => {
    const engine = new AutomationEngine(tmpDir);
    const result = engine.validateRule({
      id: 'test', enabled: false,
      trigger: { type: 'cron', schedule: '0 0 * * *', timezone: 'UTC' },
      action: { type: 'manager:report_completed' },
    });
    // manager:* not yet registered — should fail validation
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unknown action type'))).toBe(true);
  });

  it('executeRule logs warning for unregistered action', async () => {
    const engine = new AutomationEngine(tmpDir);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    engine['rules'].set('bad', {
      id: 'bad', enabled: true,
      trigger: { type: 'cron', schedule: '* * * * *', timezone: 'UTC' },
      action: { type: 'nonexistent:action' },
    });
    await engine.executeRule('bad');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('No handler registered'));
    warnSpy.mockRestore();
  });
});
```

- [ ] 9. Run tests: `npx jest tests/unit/automation-engine-actions.test.ts --coverage`

---

## Task 2: Trigger union type + AutomationRule interface extension

**Files**
- Modify: `gateway/src/automation-engine.ts`

**Interfaces**
- Consumes: `AutomationRule`, `CronTrigger` (new), `EventTrigger` (new)
- Produces: `CronTrigger`, `EventTrigger`, extended `AutomationRule`

**Steps**

- [ ] 1. Add new interfaces after existing `MemoryActionType`:

```typescript
export interface CronTrigger {
  type: 'cron';
  schedule: string;
  timezone: string;
}

export interface EventTrigger {
  type: 'event';
  on: string[];
  perGoalCooldown: string;
}

export type Trigger = CronTrigger | EventTrigger;
```

- [ ] 2. Change `AutomationRule.trigger` from inline `{ type: 'cron'; schedule: string; timezone: string }` to `trigger: Trigger`

- [ ] 3. Update `validateRule()` — replace single cron check (line ~421) with:

```typescript
if (!rule.trigger || (rule.trigger.type !== 'cron' && rule.trigger.type !== 'event')) {
  errors.push('Trigger type must be "cron" or "event"');
}
if (rule.trigger.type === 'cron') {
  const ct = rule.trigger as CronTrigger;
  if (typeof ct.schedule !== 'string' || ct.schedule.trim() === '') {
    errors.push('Schedule must be a non-empty cron expression');
  } else {
    try {
      const job = new CronJob(ct.schedule, () => {}, null, false, ct.timezone || 'UTC');
      job.stop();
    } catch (e: any) {
      errors.push(`Invalid cron expression: ${e.message}`);
    }
  }
  if (ct.timezone && !Intl.supportedValuesOf?.('timeZone')?.includes(ct.timezone)) {
    try { new Intl.DateTimeFormat(undefined, { timeZone: ct.timezone }); } catch {
      errors.push(`Invalid timezone: ${ct.timezone}`);
    }
  }
}
if (rule.trigger.type === 'event') {
  const et = rule.trigger as EventTrigger;
  if (!Array.isArray(et.on) || et.on.length === 0) {
    errors.push('Event trigger must have a non-empty "on" array');
  }
  if (typeof et.perGoalCooldown !== 'string' || !/^\d+(s|m|h)$/.test(et.perGoalCooldown)) {
    errors.push('Event trigger perGoalCooldown must be a valid duration (e.g. "60s", "5m")');
  }
}
```

- [ ] 4. Update `start()` — add dispatch by trigger type:

```typescript
start(): void {
  for (const [id, rule] of this.rules) {
    if (rule.trigger.type === 'cron') {
      this.scheduleRule(id, rule);
    } else {
      this.scheduleEventRule(id, rule);
    }
  }
}
```

- [ ] 5. Add empty `scheduleEventRule()` stub:

```typescript
private scheduleEventRule(_id: string, _rule: AutomationRule): void {
  // Stub — will be implemented in Task 8
}
```

- [ ] 6. Update `getNextTriggers()` — guard for cron-only:

```typescript
getNextTriggers(rule: AutomationRule, count: number = 5): { next5: string[] } {
  if (rule.trigger.type !== 'cron') return { next5: [] };
  // ... existing cron logic unchanged ...
}
```

- [ ] 7. Update `scheduleRule()` to cast trigger:

```typescript
const cronTrigger = rule.trigger as CronTrigger;
const job = new CronJob(
  cronTrigger.schedule,
  () => this.executeRule(id, 'cron', this._ledger),
  null,
  true,
  cronTrigger.timezone,
);
```

- [ ] 8. Update `toggleRule()` — when re-enabling, dispatch by trigger type:

```typescript
if (enabled) {
  this.rules.set(id, rule);
  if (rule.trigger.type === 'cron') {
    this.scheduleRule(id, rule);
  } else {
    this.scheduleEventRule(id, rule);
  }
} else {
  this.rules.delete(id);
  const job = this.jobs.get(id);
  if (job) { job.stop(); this.jobs.delete(id); }
  // Unregister event listener (stub until Task 8):
  // this.unregisterEventRule(id);
}
```

- [ ] 9. Update existing test to not break — run: `npx jest tests/unit/automation-engine-actions.test.ts`

---

## Task 3: LoopState extension

**Files**
- Modify: `gateway/src/core/langgraph/loop-state.ts`

**Interfaces**
- Consumes: `Annotation` from `@langchain/langgraph`
- Produces: 4 new annotations: `draftPlan`, `pendingQuestion`, `userResponse`, `stateVersion`

**Steps**

- [ ] 1. Append after the `phase` field (line ~54), before closing `});`:

```typescript
  draftPlan: Annotation<any>({
    value: (a, b) => b ?? a,
    default: () => null,
  }),

  pendingQuestion: Annotation<{
    questionId: string;
    node: "plan" | "review";
    loop: number;
    questions: string[];
    askedAt: string;
  } | null>({
    value: (a, b) => b === undefined ? a : b,
    default: () => null,
  }),

  userResponse: Annotation<{
    questionId: string;
    answer: string;
    respondedAt: string;
  } | null>({
    value: (a, b) => b === undefined ? a : b,
    default: () => null,
  }),

  stateVersion: Annotation<number>({
    value: (a, b) => b ?? a ?? 0,
    default: () => 0,
  }),
```

- [ ] 2. Run TypeScript check: `npx tsc --noEmit` (from gateway dir)

---

## Task 4: Graph changes — add askUser node + conditional routing

**Files**
- Modify: `gateway/src/core/langgraph/graph.ts`
- Modify: `tests/unit/langgraph/graph.test.ts`

**Interfaces**
- Consumes: `LoopState`, `GraphOptions`
- Produces: `routeAfterPlan` export, updated graph with askUser node

**Steps**

- [ ] 1. Add `askUser` to `GraphOptions` interface:

```typescript
export interface GraphOptions {
  plan: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  askUser: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  execute: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  review: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveSuccess: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveFail: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveMaxRetries: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
}
```

- [ ] 2. Add `routeAfterPlan()` export function:

```typescript
export function routeAfterPlan(state: typeof LoopState.State): string {
  if (state.pendingQuestion) return "askUser";
  return "execute";
}
```

- [ ] 3. Update `routeAfterReview()` — add pendingQuestion check before FAIL → plan:

```typescript
export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.reviewVerdict === "ERROR" || state.lastError) return "archive_fail";
  if (state.reviewVerdict === "PASS") return "archive_success";
  if (state.round >= state.maxRounds) return "archive_max_retries";
  if (state.pendingQuestion) return "askUser";
  return "plan";
}
```

- [ ] 4. Update `buildExecutionGraph()` — add askUser node, change plan edge to conditional:

```typescript
export function buildExecutionGraph(options: GraphOptions) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan", options.plan, { retryPolicy: { maxAttempts: 2 } })
    .addNode("askUser", options.askUser)
    .addNode("execute", options.execute, { retryPolicy: { maxAttempts: 2 } })
    .addNode("review", options.review, { retryPolicy: { maxAttempts: 2 } })
    .addNode("archive_success", options.archiveSuccess)
    .addNode("archive_fail", options.archiveFail)
    .addNode("archive_max_retries", options.archiveMaxRetries)

    .addEdge("__start__", "plan")
    .addConditionalEdges("plan", routeAfterPlan, {
      askUser: "askUser",
      execute: "execute",
    })
    .addEdge("askUser", "plan")
    .addEdge("execute", "review")
    .addConditionalEdges("review", routeAfterReview, {
      plan: "plan",
      askUser: "askUser",
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

- [ ] 5. Update `tests/unit/langgraph/graph.test.ts` — add `routeAfterPlan` tests and pendingQuestion routing tests:

```typescript
import { routeAfterReview, routeAfterPlan } from '../../../src/langgraph/graph';

describe('routeAfterPlan', () => {
  it('routes to askUser when pendingQuestion is set', () => {
    expect(routeAfterPlan({ pendingQuestion: { questionId: 'q1', node: 'plan', loop: 1, questions: ['?'], askedAt: '' }, round: 1, maxRounds: 3, reviewVerdict: 'FAIL', lastError: null } as any)).toBe('askUser');
  });

  it('routes to execute when no pendingQuestion', () => {
    expect(routeAfterPlan({ pendingQuestion: null, round: 1, maxRounds: 3 } as any)).toBe('execute');
  });
});

describe('routeAfterReview', () => {
  // ... existing tests ...
  it('routes to askUser on FAIL with pendingQuestion', () => {
    const result = routeAfterReview({
      reviewVerdict: 'FAIL', round: 1, maxRounds: 3, lastError: null,
      pendingQuestion: { questionId: 'q2', node: 'review', loop: 1, questions: ['critical issue'], askedAt: '' },
    } as any);
    expect(result).toBe('askUser');
  });
});
```

- [ ] 6. Run tests: `npx jest tests/unit/langgraph/graph.test.ts`

---

## Task 5: Plan node HITL logic

**Files**
- Modify: `gateway/src/core/langgraph/nodes/plan.node.ts`

**Interfaces**
- Consumes: `LoopStateType`, `AgentServices`
- Produces: `draftPlan`, `pendingQuestion` in state return

**Steps**

- [ ] 1. Rewrite `plan.node.ts` to implement HITL logic inline (replacing `createAgentNode('plan')`):

```typescript
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

interface AgentServices {
  client: {
    session: {
      create(opts: { directory: string }): Promise<{ id: string }>;
      promptAsync(opts: { sessionID: string; message: string }): Promise<void>;
      delete(opts: { sessionID: string }): Promise<void>;
    };
  };
  syncToFile: (state: Partial<LoopStateType>) => void;
}

function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function finalizeWithAnswer(state: LoopStateType): Promise<Partial<LoopStateType>> {
  return {
    draftPlan: null,
    pendingQuestion: null,
    userResponse: null,
    round: state.round,
  };
}

export async function planNode(
  state: LoopStateType,
  services: AgentServices,
): Promise<Partial<LoopStateType>> {
  const { client, syncToFile } = services;
  const { goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'PLANNING' });

  if (state.draftPlan && state.userResponse) {
    const refined = await finalizeWithAnswer(state);
    syncToFile({ ...refined, phase: 'PLANNING_COMPLETE' });
    return { ...refined, draftPlan: null, pendingQuestion: null, userResponse: null };
  }

  const session = await client.session.create({ directory: projectDir! });
  const sessionId = session.id;
  await client.session.promptAsync({ sessionID: sessionId, message: `/skill mafw-plan ${goalId}` });

  const wavePlanPath = path.join(state.mafwDir!, 'waves.json');
  if (!fs.existsSync(wavePlanPath)) {
    return { lastError: 'waves.json not found after plan', reviewVerdict: 'ERROR' as const };
  }

  let wavesData: any;
  try {
    wavesData = JSON.parse(fs.readFileSync(wavePlanPath, 'utf-8'));
  } catch (err: any) {
    return { lastError: `Invalid waves.json: ${err.message}`, reviewVerdict: 'ERROR' as const };
  }

  const needsClarification = wavesData.status === 'need_clarification';
  const result: Partial<LoopStateType> = {
    wavePlanPath,
    round: state.round,
    draftPlan: needsClarification ? wavesData : null,
    pendingQuestion: needsClarification
      ? {
          questionId: generateQuestionId(),
          node: 'plan',
          loop: state.round,
          questions: wavesData.ambiguities || [],
          askedAt: new Date().toISOString(),
        }
      : null,
  };

  await client.session.delete({ sessionID: sessionId });
  syncToFile({ ...result, phase: 'PLANNING_COMPLETE' });

  return result;
}
```

- [ ] 2. Update re-export in `gateway/src/core/langgraph/index.ts` if needed (verify `planNode` export pattern matches the new signature)

- [ ] 3. Run TypeScript check: `npx tsc --noEmit` (from gateway dir)

---

## Task 6: Review node HITL logic + signature detector

**Files**
- Create: `gateway/src/core/langgraph/signature-detector.ts`
- Modify: `gateway/src/core/langgraph/nodes/review.node.ts`

**Interfaces**
- Consumes: review feedback strings
- Produces: `matchesSignature()` boolean

**Steps**

- [ ] 1. Create `signature-detector.ts`:

```typescript
export function matchesSignature(prevFeedback: string, currentFeedback: string): boolean {
  const normalize = (s: string) =>
    s.toLowerCase().trim().replace(/[\s\p{P}]+/gu, ' ').replace(/^\s+|\s+$/g, '');
  return normalize(prevFeedback) === normalize(currentFeedback);
}
```

- [ ] 2. Rewrite `review.node.ts`:

```typescript
import { LoopStateType } from '../loop-state';
import { matchesSignature } from '../signature-detector';
import * as path from 'path';
import * as fs from 'fs';

interface AgentServices {
  client: { /* same as plan */ };
  syncToFile: (state: Partial<LoopStateType>) => void;
}

function generateQuestionId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseReviewVerdict(content: string): { verdict: 'PASS' | 'FAIL' | 'ERROR'; feedback: string } {
  if (!content || content.trim().length === 0) {
    return { verdict: 'ERROR', feedback: 'Review response is empty' };
  }
  try {
    const data = JSON.parse(content);
    return { verdict: data.verdict === 'PASS' ? 'PASS' : 'FAIL', feedback: data.reason || data.feedback || JSON.stringify(data.metrics || {}) };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes('pass') || lower.includes('通过')) return { verdict: 'PASS', feedback: content.slice(0, 200) };
    return { verdict: 'FAIL', feedback: content.slice(0, 200) };
  }
}

export async function reviewNode(
  state: LoopStateType,
  services: AgentServices,
): Promise<Partial<LoopStateType>> {
  const { client, syncToFile } = services;
  const { goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'REVIEWING' });

  const session = await client.session.create({ directory: projectDir! });
  const sessionId = session.id;
  await client.session.promptAsync({ sessionID: sessionId, message: `/skill mafw-review ${goalId}` });

  const reviewPath = path.join(state.mafwDir!, 'reviews', `${state.goalId!}-loop${state.round}.md`);
  if (!fs.existsSync(reviewPath)) {
    return { lastError: 'review report not found', reviewVerdict: 'ERROR' as const };
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const verdict = parseReviewVerdict(content);

  const result: Partial<LoopStateType> = {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
    round: state.round,
    stateVersion: (state.stateVersion ?? 0) + 1,
  };

  if (verdict.verdict === 'FAIL' && state.round < state.maxRounds) {
    const prevFeedback = state.reviewFeedback;
    const sameSignature = prevFeedback && matchesSignature(prevFeedback, verdict.feedback);
    const sameSigCount = (state as any)._sameSigCount || 0;

    if (sameSignature && sameSigCount + 1 >= 2) {
      result.pendingQuestion = {
        questionId: generateQuestionId(),
        node: 'review',
        loop: state.round,
        questions: [`Review keeps failing with same issue: ${verdict.feedback}. Continue retrying?`],
        askedAt: new Date().toISOString(),
      };
      (result as any)._sameSigCount = sameSigCount + 1;
    } else {
      (result as any)._sameSigCount = sameSignature ? sameSigCount + 1 : 1;
    }
  }

  await client.session.delete({ sessionID: sessionId });
  syncToFile({ ...result, phase: 'REVIEWING_COMPLETE' });

  return result;
}

export { parseReviewVerdict };
```

- [ ] 3. Write test `tests/unit/signature-detector.test.ts`:

```typescript
import { matchesSignature } from '../../src/langgraph/signature-detector';

describe('matchesSignature', () => {
  it('returns true for identical feedback', () => {
    expect(matchesSignature('missing error handling', 'missing error handling')).toBe(true);
  });

  it('returns true after normalization (whitespace + punctuation)', () => {
    expect(matchesSignature('Missing error handling!', 'missing error handling...')).toBe(true);
  });

  it('returns false for different feedback', () => {
    expect(matchesSignature('missing error handling', 'incorrect algorithm choice')).toBe(false);
  });
});
```

- [ ] 4. Run tests: `npx jest tests/unit/signature-detector.test.ts`

---

## Task 7: Question ledger + respond API + boot reconcile

**Files**
- Create: `gateway/src/core/manager/question-ledger.ts`
- Modify: `gateway/src/index.ts`

**Interfaces**
- Consumes: JSONL file `.mafw/question-ledger.jsonl`
- Produces: `appendQuestionEvent()`, `getQuestionState()`, `listPendingQuestions()`

**Steps**

- [ ] 1. Create `question-ledger.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

export interface QuestionEvent {
  type: 'asked' | 'answered' | 'cancelled' | 'orphaned';
  questionId: string;
  goalId: string;
  node?: 'plan' | 'review';
  loop?: number;
  questions?: string[];
  askedAt?: string;
  answer?: string;
  answeredAt?: string;
  cancelledAt?: string;
  orphanedAt?: string;
  reason?: string;
}

export type QuestionState = 'pending' | 'answered' | 'cancelled' | 'orphaned';

export interface QuestionRecord {
  questionId: string;
  goalId: string;
  node: string;
  loop: number;
  questions: string[];
  askedAt: string;
  state: QuestionState;
  answer?: string;
  answeredAt?: string;
}

export class QuestionLedger {
  private ledgerPath: string;

  constructor(mafwDir: string) {
    this.ledgerPath = path.join(mafwDir, 'question-ledger.jsonl');
  }

  appendQuestionEvent(event: QuestionEvent): void {
    const dir = path.dirname(this.ledgerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(this.ledgerPath, JSON.stringify(event) + '\n', 'utf-8');
  }

  getQuestionState(questionId: string): QuestionState | null {
    if (!fs.existsSync(this.ledgerPath)) return null;
    const lines = fs.readFileSync(this.ledgerPath, 'utf-8').trim().split('\n');
    let lastEvent: QuestionEvent | null = null;
    for (const line of lines) {
      try {
        const evt: QuestionEvent = JSON.parse(line);
        if (evt.questionId === questionId) lastEvent = evt;
      } catch {}
    }
    if (!lastEvent) return null;
    switch (lastEvent.type) {
      case 'asked': return 'pending';
      case 'answered': return 'answered';
      case 'cancelled': return 'cancelled';
      case 'orphaned': return 'orphaned';
      default: return null;
    }
  }

  listPendingQuestions(): QuestionRecord[] {
    if (!fs.existsSync(this.ledgerPath)) return [];
    const events: QuestionEvent[] = [];
    const lines = fs.readFileSync(this.ledgerPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch {}
    }

    const lastByQid = new Map<string, QuestionEvent>();
    for (const evt of events) {
      lastByQid.set(evt.questionId, evt);
    }

    const pending: QuestionRecord[] = [];
    for (const evt of events) {
      if (evt.type === 'asked') {
        const last = lastByQid.get(evt.questionId);
        if (last && last.type === 'asked') {
          pending.push({
            questionId: evt.questionId,
            goalId: evt.goalId,
            node: evt.node || 'plan',
            loop: evt.loop || 0,
            questions: evt.questions || [],
            askedAt: evt.askedAt || '',
            state: 'pending',
          });
        }
      }
    }
    return pending;
  }

  bootReconcile(activeCheckpoints: Set<string>): void {
    const pending = this.listPendingQuestions();
    for (const q of pending) {
      if (!activeCheckpoints.has(q.goalId)) {
        this.appendQuestionEvent({
          type: 'orphaned',
          questionId: q.questionId,
          goalId: q.goalId,
          orphanedAt: new Date().toISOString(),
          reason: 'checkpoint not found during boot reconcile',
        });
      }
    }
  }
}
```

- [ ] 2. Add respond API endpoint in `gateway/src/index.ts` (in the HTTP handler, after the existing goal routes). Add the route handler:

```typescript
// POST /api/goals/{goalId}/questions/{questionId}/respond
const respondMatch = req.url?.match(/^\/api\/goals\/([^/]+)\/questions\/([^/]+)\/respond$/);
if (respondMatch && req.method === 'POST') {
  const goalId = respondMatch[1];
  const questionId = respondMatch[2];
  const body = await readBody(req);
  let data: any;
  try { data = JSON.parse(body); } catch {
    res.writeHead(400);
    res.end(JSON.stringify({ status: 'bad_request', error: 'Invalid JSON' }));
    return;
  }
  const ledger = new QuestionLedger(this.mafwDir);
  const state = ledger.getQuestionState(questionId);
  if (!state) {
    res.writeHead(404);
    res.end(JSON.stringify({ status: 'not_found' }));
    return;
  }
  if (state !== 'pending') {
    res.writeHead(409);
    res.end(JSON.stringify({ status: 'conflict', currentState: state }));
    return;
  }
  if (data.type === 'cancel') {
    ledger.appendQuestionEvent({
      type: 'cancelled', questionId, goalId, cancelledAt: new Date().toISOString(),
    });
    eventBus.emit('question_cancelled', { questionId, goalId });
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'accepted', action: 'cancelled' }));
    return;
  }
  // answer or redirect
  ledger.appendQuestionEvent({
    type: 'answered', questionId, goalId,
    answer: data.answer || '', answeredAt: new Date().toISOString(),
  });
  // Resume graph
  const found = this.findGoalStatePath(goalId);
  if (found) {
    const cp = new FileCheckpointer(found.info.mafwDir);
    const graph = buildExecutionGraph(this.buildNodeOptions(found.info.mafwDir));
    graph.checkpointer = cp;
    const { Command } = await import('@langchain/langgraph');
    await graph.invoke(new Command({ resume: { answer: data.answer || '' } }), {
      configurable: { thread_id: goalId },
    });
  }
  eventBus.emit('question_answered', { questionId, goalId, answer: data.answer });
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'accepted' }));
  return;
}
```

- [ ] 3. Add `QuestionLedger` import at top of `index.ts`:

```typescript
import { QuestionLedger } from './core/manager/question-ledger';
```

- [ ] 4. Add boot reconciliation in `start()` after `initServices()`:

```typescript
const ledger = new QuestionLedger(this.mafwDir);
const activeCheckpoints = new Set(Array.from(this.activeGoals.keys()));
ledger.bootReconcile(activeCheckpoints);
```

- [ ] 5. Run TypeScript check: `npx tsc --noEmit` (from gateway dir)

---

## Task 8: AutomationEngine event trigger support

**Files**
- Modify: `gateway/src/automation-engine.ts`

**Interfaces**
- Consumes: `EventTrigger`, `eventBus`
- Produces: `scheduleEventRule()`, `fireEventRule()`, `unregisterEventRule()`

**Steps**

- [ ] 1. Add fields to `AutomationEngine` class:

```typescript
private eventListeners: Map<string, Set<string>> = new Map();
private lastFireTimes: Map<string, number> = new Map();
private reportedPairs: Set<string> = new Set();
```

- [ ] 2. Add import at top:

```typescript
import { eventBus } from './event-bus';
```

- [ ] 3. Implement `scheduleEventRule()`:

```typescript
private scheduleEventRule(id: string, rule: AutomationRule): void {
  const et = rule.trigger as EventTrigger;
  for (const eventName of et.on) {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, new Set());
    }
    this.eventListeners.get(eventName)!.add(id);
  }
  console.log(`[AutomationEngine] Registered event rule ${id} for events: ${et.on.join(', ')}`);

  const handler = (_data: any) => {
    const goalId = _data?.goalId;
    if (goalId) this.fireEventRule(rule, goalId);
  };

  for (const eventName of et.on) {
    eventBus.on(eventName, handler);
  }
}
```

- [ ] 4. Implement `fireEventRule()`:

```typescript
private fireEventRule(rule: AutomationRule, goalId: string): void {
  const et = rule.trigger as EventTrigger;

  const cooldownMs = parseDuration(et.perGoalCooldown);
  const lastFire = this.lastFireTimes.get(`${rule.id}:${goalId}`);
  if (lastFire && Date.now() - lastFire < cooldownMs) return;

  const stateVersion = this.getStateVersion(goalId);
  const pairKey = `${goalId}:${stateVersion}`;
  if (this.reportedPairs.has(pairKey)) return;

  this.lastFireTimes.set(`${rule.id}:${goalId}`, Date.now());
  this.reportedPairs.add(pairKey);

  if (rule.action) {
    this.executeRule(rule.id, 'event', this._ledger);
  }
}

private getStateVersion(_goalId: string): number {
  const stateDir = path.join(this.mafwDir, 'state');
  const stateFile = path.join(stateDir, `${_goalId}.json`);
  if (fs.existsSync(stateFile)) {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      return s.stateVersion ?? 0;
    } catch { return 0; }
  }
  return 0;
}

function parseDuration(d: string): number {
  const num = parseInt(d);
  if (d.endsWith('s')) return num * 1000;
  if (d.endsWith('m')) return num * 60 * 1000;
  if (d.endsWith('h')) return num * 60 * 60 * 1000;
  return 60000;
}
```

- [ ] 5. Implement `unregisterEventRule()`:

```typescript
private unregisterEventRule(id: string): void {
  // EventBus doesn't have removeListener easily; for now we just remove from maps
  // Full implementation would store listener refs
  this.eventListeners.forEach((ids) => ids.delete(id));
  // Clean up lastFireTimes for this rule
  for (const key of this.lastFireTimes.keys()) {
    if (key.startsWith(`${id}:`)) this.lastFireTimes.delete(key);
  }
}
```

- [ ] 6. Update `toggleRule()` — call `unregisterEventRule(id)` when disabling event rules:

```typescript
} else {
  this.rules.delete(id);
  const job = this.jobs.get(id);
  if (job) { job.stop(); this.jobs.delete(id); }
  this.unregisterEventRule(id);
}
```

- [ ] 7. Run TypeScript check: `npx tsc --noEmit`

---

## Task 9: Manager action handlers (wake-up logic)

**Files**
- Create: `gateway/src/core/manager/wake-handlers.ts`
- Modify: `gateway/src/index.ts` (initServices or MafwScheduler)

**Interfaces**
- Consumes: `AutomationEngine`, `actionRegistry`, goal state files
- Produces: `wakeCompletedHandler`, `wakeFailedHandler`, `wakeQuestionHandler`

**Steps**

- [ ] 1. Create `wake-handlers.ts`:

```typescript
import { AutomationRule, AutomationEngine } from '../../automation-engine';
import * as fs from 'fs';
import * as path from 'path';

async function injectWakeMessage(engine: AutomationEngine, goalIds: string[], reason: string): Promise<void> {
  const mafwDir = engine['mafwDir'];
  const managerSessionFile = path.join(mafwDir, 'manager-session.json');
  if (!fs.existsSync(managerSessionFile)) {
    console.log('[WakeHandler] No manager session found — skipping wake injection');
    return;
  }
  const { sessionId } = JSON.parse(fs.readFileSync(managerSessionFile, 'utf-8'));

  const countCompleted = goalIds.filter(gid => {
    const sf = path.join(mafwDir, 'state', `${gid}.json`);
    if (!fs.existsSync(sf)) return false;
    const s = JSON.parse(fs.readFileSync(sf, 'utf-8'));
    return s.reviewVerdict === 'PASS' && !s.reportedAt;
  }).length;

  const countFailed = goalIds.length - countCompleted;
  const wakePrompt = `[MANAGER SYSTEM WAKE] Goals updated. Active: ${countCompleted} completed, ${countFailed} failed.\nUse mafw_get_goal_status for details. Do NOT fabricate results.`;

  console.log(`[WakeHandler] Injecting wake prompt into session ${sessionId}: ${reason}`);
  // Inject via SDK client — actual implementation depends on opencodeClient availability
  try {
    const { createOpencodeClient } = await import('@opencode-ai/sdk');
    const client = createOpencodeClient({ baseUrl: process.env.MAFW_SERVE_URL || 'http://127.0.0.1:4096' });
    await client.session.promptAsync({ sessionID: sessionId, message: wakePrompt });
  } catch (err: any) {
    console.warn(`[WakeHandler] Failed to inject wake prompt: ${err.message}`);
  }
}

export async function wakeCompletedHandler(rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'];
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return;
  const completedGoalIds: string[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if (s.reviewVerdict === 'PASS' && !s.reportedAt) {
        completedGoalIds.push(s.goalId || file.replace('.json', ''));
      }
    } catch {}
  }
  if (completedGoalIds.length > 0) {
    await injectWakeMessage(engine, completedGoalIds, 'report_completed');
  }
}

export async function wakeFailedHandler(rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'];
  const stateDir = path.join(mafwDir, 'state');
  if (!fs.existsSync(stateDir)) return;
  const failedGoalIds: string[] = [];
  for (const file of fs.readdirSync(stateDir).filter(f => f.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(stateDir, file), 'utf-8'));
      if ((s.reviewVerdict === 'FAIL' || s.reviewVerdict === 'ERROR') && !s.reportedAt) {
        failedGoalIds.push(s.goalId || file.replace('.json', ''));
      }
    } catch {}
  }
  if (failedGoalIds.length > 0) {
    await injectWakeMessage(engine, failedGoalIds, 'report_failed');
  }
}

export async function wakeQuestionHandler(_rule: AutomationRule, engine: AutomationEngine): Promise<void> {
  const mafwDir = engine['mafwDir'];
  const ledgerPath = path.join(mafwDir, 'question-ledger.jsonl');
  if (!fs.existsSync(ledgerPath)) return;
  const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
  const pendingQids = new Set<string>();
  for (const line of lines) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === 'asked') pendingQids.add(evt.questionId);
      if (evt.type === 'answered' || evt.type === 'cancelled' || evt.type === 'orphaned') {
        pendingQids.delete(evt.questionId);
      }
    } catch {}
  }
  if (pendingQids.size > 0) {
    const goalIds: string[] = [];
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'asked' && pendingQids.has(evt.questionId)) {
          if (!goalIds.includes(evt.goalId)) goalIds.push(evt.goalId);
        }
      } catch {}
    }
    await injectWakeMessage(engine, goalIds, 'report_question');
  }
}
```

- [ ] 2. Register handlers in `initServices()` in `gateway/src/index.ts`:

```typescript
import { wakeCompletedHandler, wakeFailedHandler, wakeQuestionHandler } from './core/manager/wake-handlers';

// In initServices(), after this.automationEngine = new AutomationEngine(mafwDir):
actionRegistry.set('manager:report_completed', wakeCompletedHandler);
actionRegistry.set('manager:report_failed', wakeFailedHandler);
actionRegistry.set('manager:report_question', wakeQuestionHandler);
```

- [ ] 3. Run TypeScript check: `npx tsc --noEmit`

---

## Task 10: System rules protection + config

**Files**
- Modify: `gateway/src/index.ts`
- Modify: `gateway/src/config.ts`

**Interfaces**
- Consumes: automation rule JSON templates
- Produces: `ensureManagerRules()`, config `manager` section

**Steps**

- [ ] 1. Add to `gateway/src/config.ts` — to `GatewayConfig` interface and `defaults()`:

In the `GatewayConfig` interface, add:
```typescript
manager: {
  wakeCooldownMs: number;
  reportIntervalMin: number;
};
```

In `defaults()`:
```typescript
manager: {
  wakeCooldownMs: parseInt(process.env.MAFW_MANAGER_WAKE_COOLDOWN || '') || 60000,
  reportIntervalMin: parseInt(process.env.MAFW_MANAGER_REPORT_INTERVAL || '') || 5,
},
```

Add `get manager()` accessor in `Config` class:
```typescript
get manager() { return this.data.manager; }
```

- [ ] 2. Add template constants + `ensureManagerRules()` in `gateway/src/index.ts`:

```typescript
const MANAGER_RULE_TEMPLATES: Record<string, any> = {
  'manager-report-completed': {
    id: 'manager-report-completed',
    enabled: true,
    trigger: { type: 'cron', schedule: '*/5 * * * *', timezone: 'UTC' },
    action: { type: 'manager:report_completed' },
  },
  'manager-report-failed': {
    id: 'manager-report-failed',
    enabled: true,
    trigger: { type: 'event', on: ['goal.failed'], perGoalCooldown: '60s' },
    action: { type: 'manager:report_failed' },
  },
  'manager-report-question': {
    id: 'manager-report-question',
    enabled: false,
    trigger: { type: 'event', on: ['goal.awaiting_user'], perGoalCooldown: '60s' },
    action: { type: 'manager:report_question' },
  },
};

function ensureManagerRules(mafwDir: string): void {
  const autoDir = path.join(mafwDir, 'automations');
  if (!fs.existsSync(autoDir)) fs.mkdirSync(autoDir, { recursive: true });
  for (const [id, template] of Object.entries(MANAGER_RULE_TEMPLATES)) {
    const rulePath = path.join(autoDir, `${id}.json`);
    if (!fs.existsSync(rulePath)) {
      fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8');
      console.log(`[Scheduler] Created system rule: ${id}`);
    } else {
      try {
        const existing = JSON.parse(fs.readFileSync(rulePath, 'utf-8'));
        if (existing.enabled !== template.enabled) {
          console.log(`[Scheduler] Rule ${id} exists with user override (enabled: ${existing.enabled}) — keeping user value`);
        }
      } catch { /* corrupt file — overwrite */ fs.writeFileSync(rulePath, JSON.stringify(template, null, 2), 'utf-8'); }
    }
  }
}
```

- [ ] 3. Call `ensureManagerRules()` in `start()` after `initServices()`:

```typescript
ensureManagerRules(this.mafwDir);
```

- [ ] 4. Run TypeScript check: `npx tsc --noEmit`

---

## Task 11: Manager tools (MCP handlers)

**Files**
- Create: `gateway/src/mcp/handlers/manager-set-goal.ts`
- Create: `gateway/src/mcp/handlers/manager-get-goal-status.ts`
- Create: `gateway/src/mcp/handlers/manager-list-goals.ts`
- Create: `gateway/src/mcp/handlers/manager-answer-question.ts`
- Create: `gateway/src/mcp/handlers/manager-get-evidence.ts`
- Create: `gateway/src/mcp/handlers/manager-cancel-goal.ts`
- Create: `gateway/src/mcp/handlers/manager-list-pending-questions.ts`
- Modify: `gateway/src/mcp/tool-registry.ts`

**Interfaces**
- Consumes: `ToolHandler` type, `Services`
- Produces: 7 tool handler exports

**Steps**

- [ ] 1. Create `manager-set-goal.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';
import { eventBus } from '../../event-bus';

const projectDir = process.env.MAFW_PROJECT_DIR || process.cwd();

export const handleManagerSetGoal: ToolHandler = async (args, _services) => {
  try {
    const goalId = args.goalId as string;
    const title = args.title as string;
    const charter = args.charter as string;
    const source = (args.source as string) || 'manager';
    const metrics = (args.metrics as Record<string, any>) || {};
    const boundaries = (args.boundaries as string[]) || [];
    const priority = (args.priority as string) || 'medium';
    const maxLoops = (args.maxLoops as number) || 5;

    const mafwDir = path.join(projectDir, '.mafw');
    const goalsDir = path.join(mafwDir, 'goals');
    const requestsDir = path.join(mafwDir, 'requests');
    fs.mkdirSync(goalsDir, { recursive: true });
    fs.mkdirSync(requestsDir, { recursive: true });

    const charterPath = path.join(goalsDir, `${goalId}.md`);
    if (fs.existsSync(charterPath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Goal ${goalId} already exists` }) }], isError: true };
    }

    fs.writeFileSync(charterPath, charter, 'utf-8');

    const request = {
      version: '2', goalId, title, state: 'draft',
      createdAt: new Date().toISOString(), confirmedAt: new Date().toISOString(),
      source, projectDir, mafwDir, goalCharter: charterPath,
      metrics, boundaries, priority, maxLoops, parallel: false,
    };
    fs.writeFileSync(path.join(requestsDir, `${goalId}.json`), JSON.stringify(request, null, 2), 'utf-8');

    eventBus.emit('goal_created', { type: 'goal_created', goalId, projectDir });

    return { content: [{ type: 'text', text: JSON.stringify({ success: true, goalId, message: `Goal ${goalId} created. Verification pending.` }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 2. Create `manager-get-goal-status.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerGetGoalStatus: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const mafwDir = path.join(process.env.MAFW_PROJECT_DIR || process.cwd(), '.mafw');
    const statePath = path.join(mafwDir, 'state', `${goalId}.json`);
    if (!fs.existsSync(statePath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Goal ${goalId} not found` }) }], isError: true };
    }
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return { content: [{ type: 'text', text: JSON.stringify({
      success: true, goalId,
      phase: state.phase, round: state.round, verdict: state.reviewVerdict,
      lastError: state.lastError, updatedAt: state.updatedAt,
    }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 3. Create `manager-list-goals.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerListGoals: ToolHandler = async () => {
  try {
    const mafwDir = path.join(process.env.MAFW_PROJECT_DIR || process.cwd(), '.mafw');
    const stateDir = path.join(mafwDir, 'state');
    if (!fs.existsSync(stateDir)) return { content: [{ type: 'text', text: JSON.stringify({ success: true, goals: [] }) }] };
    const goals = fs.readdirSync(stateDir).filter(f => f.endsWith('.json')).map(f => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(stateDir, f), 'utf-8'));
        return { goalId: s.goalId || f.replace('.json', ''), phase: s.phase, round: s.round, verdict: s.reviewVerdict, updatedAt: s.updatedAt };
      } catch { return null; }
    }).filter(Boolean);
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, goals }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 4. Create `manager-answer-question.ts`:

```typescript
import { ToolHandler } from '../../types';
import * as http from 'http';

export const handleManagerAnswerQuestion: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const questionId = args.questionId as string;
    const answer = args.answer as string;
    const action = (args.action as string) || 'answer';

    const body = JSON.stringify({ type: action, answer: answer || '' });
    const result = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: 3000,
        path: `/api/goals/${goalId}/questions/${questionId}/respond`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      });
      req.on('error', reject);
      req.write(body); req.end();
    });
    return { content: [{ type: 'text', text: result }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 5. Create `manager-get-evidence.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerGetEvidence: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const mafwDir = path.join(process.env.MAFW_PROJECT_DIR || process.cwd(), '.mafw');
    const reviewsDir = path.join(mafwDir, 'reviews');
    const files = fs.existsSync(reviewsDir)
      ? fs.readdirSync(reviewsDir).filter(f => f.startsWith(goalId)).sort().reverse()
      : [];
    if (files.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, goalId, evidence: null, message: 'No review reports found' }) }] };
    }
    const latest = fs.readFileSync(path.join(reviewsDir, files[0]), 'utf-8');
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, goalId, file: files[0], content: latest.slice(0, 2000) }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 6. Create `manager-cancel-goal.ts`:

```typescript
import { ToolHandler } from '../../types';
import * as http from 'http';

export const handleManagerCancelGoal: ToolHandler = async (args) => {
  try {
    const goalId = args.goalId as string;
    const body = JSON.stringify({ action: 'ABORT', goalId });
    const result = await new Promise<string>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: 3000, path: '/control', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
      req.on('error', reject);
      req.write(body); req.end();
    });
    return { content: [{ type: 'text', text: result }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 7. Create `manager-list-pending-questions.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { ToolHandler } from '../../types';

export const handleManagerListPendingQuestions: ToolHandler = async () => {
  try {
    const mafwDir = path.join(process.env.MAFW_PROJECT_DIR || process.cwd(), '.mafw');
    const ledgerPath = path.join(mafwDir, 'question-ledger.jsonl');
    if (!fs.existsSync(ledgerPath)) {
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, questions: [] }) }] };
    }
    const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n');
    const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const lastByQid = new Map<string, any>();
    for (const e of events) lastByQid.set(e.questionId, e);
    const askedEvents = events.filter((e: any) => e.type === 'asked');
    const pending = askedEvents.filter((e: any) => {
      const last = lastByQid.get(e.questionId);
      return last && last.type === 'asked';
    }).map((e: any) => ({ questionId: e.questionId, goalId: e.goalId, node: e.node, loop: e.loop, questions: e.questions, askedAt: e.askedAt }));
    return { content: [{ type: 'text', text: JSON.stringify({ success: true, questions: pending }) }] };
  } catch (err: any) {
    return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }], isError: true };
  }
};
```

- [ ] 8. Register all 7 tools in `tool-registry.ts` — add definitions to `DEFINITIONS` array and handlers to `createToolRegistry()`:

Add definitions:
```typescript
{
  name: "mafw_set_goal",
  description: "Create a new MAFW goal (Manager tool — must confirm with user first)",
  inputSchema: {
    type: "object",
    properties: {
      goalId: { type: "string", description: "Unique goal identifier" },
      title: { type: "string", description: "Human-readable goal title" },
      charter: { type: "string", description: "Goal charter in markdown" },
      source: { type: "string", description: "Source", default: "manager" },
      boundaries: { type: "array", items: { type: "string" } },
      priority: { type: "string", enum: ["low", "medium", "high", "critical"], default: "medium" },
      maxLoops: { type: "number", default: 5 },
    },
    required: ["goalId", "title", "charter"],
  },
},
{
  name: "mafw_get_goal_status",
  description: "Get goal state/progress/verdict from checkpoint",
  inputSchema: {
    type: "object",
    properties: {
      goalId: { type: "string", description: "Goal identifier" },
    },
    required: ["goalId"],
  },
},
{
  name: "mafw_list_goals",
  description: "List all active goals with their phase and verdict",
  inputSchema: { type: "object", properties: {} },
},
{
  name: "mafw_answer_question",
  description: "Answer a pending loop question on behalf of the user",
  inputSchema: {
    type: "object",
    properties: {
      goalId: { type: "string" },
      questionId: { type: "string" },
      answer: { type: "string" },
      action: { type: "string", enum: ["answer", "cancel", "redirect"], default: "answer" },
    },
    required: ["goalId", "questionId", "answer"],
  },
},
{
  name: "mafw_get_evidence",
  description: "Read review report / evidence for a goal",
  inputSchema: {
    type: "object",
    properties: {
      goalId: { type: "string" },
    },
    required: ["goalId"],
  },
},
{
  name: "mafw_cancel_goal",
  description: "Cancel a goal (requires user confirmation)",
  inputSchema: {
    type: "object",
    properties: {
      goalId: { type: "string" },
    },
    required: ["goalId"],
  },
},
{
  name: "mafw_list_pending_questions",
  description: "List all currently pending loop questions",
  inputSchema: { type: "object", properties: {} },
},
```

Register handlers:
```typescript
import { handleManagerSetGoal } from "./handlers/manager-set-goal";
import { handleManagerGetGoalStatus } from "./handlers/manager-get-goal-status";
import { handleManagerListGoals } from "./handlers/manager-list-goals";
import { handleManagerAnswerQuestion } from "./handlers/manager-answer-question";
import { handleManagerGetEvidence } from "./handlers/manager-get-evidence";
import { handleManagerCancelGoal } from "./handlers/manager-cancel-goal";
import { handleManagerListPendingQuestions } from "./handlers/manager-list-pending-questions";

// In createToolRegistry() handlers:
mafw_set_goal: handleManagerSetGoal,
mafw_get_goal_status: handleManagerGetGoalStatus,
mafw_list_goals: handleManagerListGoals,
mafw_answer_question: handleManagerAnswerQuestion,
mafw_get_evidence: handleManagerGetEvidence,
mafw_cancel_goal: handleManagerCancelGoal,
mafw_list_pending_questions: handleManagerListPendingQuestions,
```

- [ ] 9. Run TypeScript check: `npx tsc --noEmit`

---

## Task 12: Manager identity config

**Files**
- Create: `gateway/src/skills/manager-identity.yaml`

**Interfaces**
- Consumes: YAML file format
- Produces: identity string to inject as system message

**Steps**

- [ ] 1. Create `gateway/src/skills/manager-identity.yaml`:

```yaml
[MAFW MANAGER IDENTITY]
Role: 你是用户的项目员工。你接收任务、澄清需求、启动 goal、跟进进度、汇报结果。
Constraints:
  - 你不写任何代码，实现工作必须通过 mafw_set_goal 委派
  - goal 状态只能从工具查询获得，不许凭记忆回答进度
  - 用户没有问进度时，不主动汇报中间态，只在完成/失败/被阻塞时发言
  - 不确定是否为任务时先澄清，创建 goal 前必须复述确认
```

- [ ] 2. Ensure the `gateway/src/skills/` directory exists: `New-Item -ItemType Directory -Force -Path "gateway/src/skills"`

---

## Task 13: Manager session bootstrap

**Files**
- Modify: `gateway/src/index.ts`

**Interfaces**
- Consumes: `openCodeClient.session.create()`
- Produces: manager session with pinned/exempt metadata

**Steps**

- [ ] 1. Add `ensureManagerSession()` function in `gateway/src/index.ts`:

```typescript
async function ensureManagerSession(projectDir: string, mafwDir: string, opencodeClient: any): Promise<string> {
  const managerFile = path.join(mafwDir, 'manager-session.json');
  if (fs.existsSync(managerFile)) {
    try {
      const { sessionId } = JSON.parse(fs.readFileSync(managerFile, 'utf-8'));
      console.log(`[Scheduler] Manager session already exists: ${sessionId}`);
      return sessionId;
    } catch { /* fall through to create */ }
  }

  const identityPath = path.join(__dirname, 'skills', 'manager-identity.yaml');
  let identityMessage = '';
  if (fs.existsSync(identityPath)) {
    identityMessage = fs.readFileSync(identityPath, 'utf-8');
  }

  const session = await opencodeClient.session.create({
    directory: projectDir,
    metadata: {
      mafw: {
        role: 'manager',
        pinned: true,
        exemptFromTrim: true,
        exemptFromEvict: true,
        exemptFromArchive: true,
      },
    },
  });

  const sessionId = session.id;

  fs.writeFileSync(managerFile, JSON.stringify({ sessionId, createdAt: new Date().toISOString() }, null, 2), 'utf-8');
  console.log(`[Scheduler] Manager session created: ${sessionId}`);

  // Inject identity as initial system message
  try {
    await opencodeClient.session.promptAsync({
      sessionID: sessionId,
      message: identityMessage,
    });
  } catch (err: any) {
    console.warn(`[Scheduler] Manager identity injection failed: ${err.message} (non-fatal)`);
  }

  return sessionId;
}
```

- [ ] 2. Call `ensureManagerSession()` in `/register` handler (after `this.registeredProjects.set(...)` and before sending response):

```typescript
// After this.persistConfig() call, add:
if (this.opencodeClient) {
  try {
    await ensureManagerSession(projectDir, mafwDir, this.opencodeClient);
  } catch (err: any) {
    console.warn(`[Scheduler] Manager session bootstrap failed: ${err.message} (non-fatal)`);
  }
}
```

- [ ] 3. Run TypeScript check: `npx tsc --noEmit`

---

## Task 14: Desktop — Question widget + respond submission

**Files**
- Create: `mafw-desktop/src/components/QuestionWidget.tsx`
- Modify: existing SSE event hook (locate via grep)

**Interfaces**
- Consumes: SSE `user_question` events, `POST /api/goals/{goalId}/questions/{questionId}/respond`
- Produces: QuestionWidget SolidJS component

**Steps**

- [ ] 1. Locate the existing SSE hook/component used for EventSource in desktop:

```bash
rg -l "EventSource\|user_question\|onmessage" mafw-desktop/src/
```

- [ ] 2. Create `mafw-desktop/src/components/QuestionWidget.tsx`:

```tsx
import { createSignal, Show } from 'solid-js';
import { ButtonV2, TextInputV2, LoaderV2 } from '@opencode-ai/ui/v2';

interface QuestionData {
  type: 'user_question';
  goalId: string;
  questionId: string;
  node: string;
  loop: number;
  questions: string[];
}

export function QuestionWidget(props: { question: QuestionData; onDismiss: () => void }) {
  const [answer, setAnswer] = createSignal('');
  const [submitting, setSubmitting] = createSignal(false);
  const [result, setResult] = createSignal<string | null>(null);

  const submit = async (action: 'answer' | 'cancel') => {
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/goals/${props.question.goalId}/questions/${props.question.questionId}/respond`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: action, answer: answer() }),
        },
      );
      const data = await res.json();
      setResult(data.status);
      if (data.status === 'accepted') setTimeout(() => props.onDismiss(), 1500);
    } catch {
      setResult('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="mafw-question-widget">
      <h3>Loop Interrupt — {props.question.node} (round {props.question.loop})</h3>
      <ul>
        {props.question.questions.map((q, i) => <li>{q}</li>)}
      </ul>
      <Show when={!result()}>
        <TextInputV2 value={answer()} onInput={e => setAnswer(e.target.value)} placeholder="Your answer..." />
        <div style="display:flex;gap:8px;margin-top:8px;">
          <ButtonV2 variant="contrast" onClick={() => submit('answer')} disabled={submitting()}>
            {submitting() ? <LoaderV2 /> : 'Answer'}
          </ButtonV2>
          <ButtonV2 variant="outline" onClick={() => submit('cancel')} disabled={submitting()}>
            Cancel
          </ButtonV2>
        </div>
      </Show>
      <Show when={result()}>
        <p>Status: {result()}</p>
      </Show>
    </div>
  );
}
```

- [ ] 3. In the component that handles SSE events (likely `Dashboard.tsx` or a hook file), add `user_question` handling:

```typescript
// In SSE event handler:
if (data.type === 'user_question') {
  setActiveQuestion(data);
}

// Add state:
const [activeQuestion, setActiveQuestion] = createSignal<QuestionData | null>(null);

// In JSX, conditionally render:
<Show when={activeQuestion()}>
  <QuestionWidget question={activeQuestion()!} onDismiss={() => setActiveQuestion(null)} />
</Show>
```

- [ ] 4. Run `npm run build` in `mafw-desktop/`

---

## Task 15: Desktop — Manager pin UI + handoff card + compression divider

**Files**
- Modify: existing Desktop rail component (locate via glob)
- Modify: existing Desktop conversation/message component
- Create: `mafw-desktop/src/components/HandoffCard.tsx`

**Interfaces**
- Consumes: session metadata, compression events, session rotate events
- Produces: UI components

**Steps**

- [ ] 1. Locate Rail and conversation components:

```bash
rg -l "mafw.*role\|Session.*pin\|Rail" mafw-desktop/src/
```

- [ ] 2. In the Rail session list, add Manager pin logic:

```tsx
// Filter sessions with mafw.role === 'manager'
const managerSessions = () => sessions().filter(s => s.metadata?.mafw?.role === 'manager');

// Render Manager sessions at top with dedicated icon:
<For each={managerSessions()}>
  {(session) => (
    <SessionItem session={session} icon="manager" pinned={true} />
  )}
</For>
```

- [ ] 3. Create `mafw-desktop/src/components/HandoffCard.tsx`:

```tsx
import { For } from 'solid-js';

interface HandoffData {
  handoverAt: string;
  activeGoals: Array<{ goalId: string; title: string }>;
  pendingQuestions: Array<{ questionId: string; goalId: string }>;
  previousSessionId: string;
}

export function HandoffCard(props: { data: HandoffData }) {
  return (
    <div class="mafw-handoff-card">
      <h3>Session Handoff — {new Date(props.data.handoverAt).toLocaleString()}</h3>
      <p><strong>Active Goals:</strong> {props.data.activeGoals.length}</p>
      <p><strong>Pending Questions:</strong> {props.data.pendingQuestions.length}</p>
      <details>
        <summary>Previous session ID: {props.data.previousSessionId}</summary>
      </details>
    </div>
  );
}
```

- [ ] 4. In conversation view, detect compression events in message stream and render divider:

```tsx
// In message rendering loop:
{message.isCompressionMarker && (
  <div class="mafw-compression-divider">
    <span>已压缩 · 查看摘要</span>
  </div>
)}
```

- [ ] 5. On session rotate, detect first message as handoff and render `HandoffCard`:

```tsx
// In conversation initialization:
{isFirstMessageInNewSession() && handoffData() && (
  <HandoffCard data={handoffData()!} />
)}
```

- [ ] 6. Run `npm run build` in `mafw-desktop/`

---

## Task dependencies

```
Task 1 (handler refactor)
  └─ Task 9 (manager:wake handlers) — depends on actionRegistry
  └─ Task 2 (trigger union) — independent, refactors same file

Task 2 (trigger union)
  └─ Task 8 (event trigger support) — depends on EventTrigger interface

Task 3 (LoopState)
  └─ Task 4 (graph) — depends on new annotations
  └─ Task 5 (plan node) — depends on new annotations
  └─ Task 6 (review node) — depends on new annotations

Task 4 (graph)
  └─ Task 5 (plan node) — askUser node needed in graph

Task 5, Task 6 (plan/review HITL) — independent of each other

Task 7 (question ledger) — independent
  └─ Task 8 (event trigger) — emits events consumed by ledger

Task 8 (event trigger) — independent after Task 2
  └─ Task 9 (wake handlers) — independent of event trigger (uses cron too)

Task 10 (system rules) — independent
Task 11 (manager tools) — independent
Task 12 (manager identity) — independent
Task 13 (manager session) — independent
Task 14 (Desktop widget) — depends on Task 7 (respond API)
Task 15 (Desktop UI) — independent

Recommended execution order:
1 → 2 → 3 → 4 → 5,6 (parallel) → 7 → 8 → 9 → 10,11,12,13 (parallel) → 14 → 15
```
