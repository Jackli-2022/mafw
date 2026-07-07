# LangGraph 深度集成 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 Gateway 从"全能调度器"降级为"轻量级事件路由器 + 文件同步器"，利用 LangGraph 的 interrupt、retryPolicy、StateGraph 替换手写的 WAIT_PHASE_COMPLETE、startSessionMonitor、dispatchSession。

**Architecture:** 文件持久化 Checkpointer → 节点内 createSession + interrupt → Gateway 仅 graph.resume + syncFromCheckpoint。state.json 仍为 Dashboard 只读视图。

**Tech Stack:** TypeScript, @langchain/langgraph v1.4.7

## Global Constraints

- `state.json` 仍是 Dashboard 唯一数据源 — 每次节点完成后 `syncFromCheckpoint` 写入
- `interrupt()` 后必须 `syncToFile({ phase: 'WAITING' })` 以便 Dashboard 显示等待状态
- 文件 Checkpointer 存 `.opencode/mafw/checkpoints/{goalId}/`，与 state.json 同级
- 不新增 npm 依赖
- 所有 506 个现有测试必须保持通过

---

### Task 1: 文件 Checkpointer

**Files:**
- Create: `src/langgraph/checkpointer.ts`
- Test: `tests/unit/langgraph/checkpointer.test.ts`

**Interfaces:**
- Produces: `class FileCheckpointer extends BaseCheckpointSaver`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/langgraph/checkpointer.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileCheckpointer } from '../../../src/langgraph/checkpointer';

describe('FileCheckpointer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves a checkpoint', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const config = { configurable: { thread_id: 'goal-1' } };
    const checkpoint = {
      thread_id: 'goal-1',
      node_id: 'plan',
      ts: new Date().toISOString(),
      state: { round: 1, phase: 'PLANNING' },
    };
    const metadata = { step: 1, retries: 0 };

    await cp.put(config, checkpoint as any, metadata as any);
    const retrieved = await cp.get(config);
    expect(retrieved).toBeDefined();
    expect((retrieved as any).state.round).toBe(1);
  });

  it('returns undefined for nonexistent thread', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const result = await cp.get({ configurable: { thread_id: 'nonexistent' } });
    expect(result).toBeUndefined();
  });

  it('lists checkpoints for a thread', async () => {
    const cp = new FileCheckpointer(tmpDir);
    const config = { configurable: { thread_id: 'goal-2' } };
    await cp.put(config, { thread_id: 'goal-2', node_id: 'plan', ts: '1', state: {} } as any, { step: 1 } as any);
    await cp.put(config, { thread_id: 'goal-2', node_id: 'execute', ts: '2', state: {} } as any, { step: 2 } as any);

    const results: any[] = [];
    for await (const c of cp.list(config)) {
      results.push(c);
    }
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/langgraph/checkpointer.test.ts --no-coverage
```
Expected: FAIL (module not found)

- [ ] **Step 3: Create checkpointer.ts**

```typescript
// src/langgraph/checkpointer.ts
import * as fs from 'fs';
import * as path from 'path';
import { BaseCheckpointSaver } from '@langchain/langgraph';

interface CheckpointData {
  thread_id: string;
  node_id: string;
  ts: string;
  state: Record<string, any>;
}

interface MetadataData {
  step: number;
  retries: number;
  lastError?: string;
}

export class FileCheckpointer extends BaseCheckpointSaver {
  private baseDir: string;

  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
  }

  private threadDir(threadId: string): string {
    return path.join(this.baseDir, 'checkpoints', threadId);
  }

  private stepPath(threadId: string, step: number): string {
    return path.join(this.threadDir(threadId), `step_${String(step).padStart(7, '0')}.json`);
  }

  private metadataPath(threadId: string): string {
    return path.join(this.threadDir(threadId), 'metadata.json');
  }

  private nextStep(threadId: string): number {
    const dir = this.threadDir(threadId);
    if (!fs.existsSync(dir)) return 1;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return 1;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    return maxStep + 1;
  }

  async get(config: { configurable: { thread_id: string } }): Promise<any | undefined> {
    const { thread_id } = config.configurable;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) return undefined;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return undefined;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    const stepPath = this.stepPath(thread_id, maxStep);
    return JSON.parse(fs.readFileSync(stepPath, 'utf-8'));
  }

  async put(
    config: { configurable: { thread_id: string } },
    checkpoint: any,
    metadata: Record<string, any>,
  ): Promise<void> {
    const { thread_id } = config.configurable;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const step = metadata.step ?? this.nextStep(thread_id);
    const data: CheckpointData = {
      thread_id,
      node_id: checkpoint.node_id,
      ts: checkpoint.ts || new Date().toISOString(),
      state: checkpoint.state || {},
    };
    fs.writeFileSync(this.stepPath(thread_id, step), JSON.stringify(data, null, 2), 'utf-8');
    fs.writeFileSync(
      this.metadataPath(thread_id),
      JSON.stringify({ step, retries: metadata.retries ?? 0, lastError: metadata.lastError }, null, 2),
      'utf-8',
    );
  }

  async *list(config: { configurable: { thread_id: string } }, limit?: number): AsyncGenerator<any> {
    const { thread_id } = config.configurable;
    const dir = this.threadDir(thread_id);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_')).sort();
    const toRead = limit ? files.slice(-limit) : files;
    for (const f of toRead) {
      yield JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
    }
  }

  async getCurrentState(threadId: string): Promise<{ round: number; phase: string; verdict: string; lastError?: string } | null> {
    const metaPath = this.metadataPath(threadId);
    const dir = this.threadDir(threadId);
    if (!fs.existsSync(dir) || !fs.existsSync(metaPath)) return null;
    const meta: MetadataData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    const files = fs.readdirSync(dir).filter(f => f.startsWith('step_'));
    if (files.length === 0) return null;
    const maxStep = Math.max(...files.map(f => parseInt(f.replace('step_', '').replace('.json', ''), 10)));
    const cp: CheckpointData = JSON.parse(fs.readFileSync(this.stepPath(thread_id, maxStep), 'utf-8'));
    return {
      round: cp.state.round || 1,
      phase: cp.state.phase || 'UNKNOWN',
      verdict: cp.state.reviewVerdict || 'FAIL',
      lastError: meta.lastError,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/langgraph/checkpointer.test.ts --no-coverage
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/langgraph/checkpointer.ts tests/unit/langgraph/checkpointer.test.ts
git commit -m "feat(langgraph): add FileCheckpointer for persistent checkpoints"
```

---

### Task 2: 重构 LangGraph 节点（interrupt + createSession）

**Files:**
- Modify: `src/langgraph/graph.ts`
- Modify: `src/langgraph/nodes/plan.node.ts`
- Modify: `src/langgraph/nodes/execute.node.ts`
- Modify: `src/langgraph/nodes/review.node.ts`
- Modify: `src/langgraph/nodes/sync.node.ts`
- Create: `src/langgraph/nodes/archive.node.ts` (extract from sync.node.ts)
- Modify: `src/langgraph/index.ts` (export new types)

**Consumes:** FileCheckpointer from Task 1, `routeAfterReview` from existing graph.ts

- [ ] **Step 1: Refactor plan.node.ts — add interrupt + sync**

```typescript
// src/langgraph/nodes/plan.node.ts
import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface AgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function planNode(
  state: LoopStateType,
  options: AgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'PLANNING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-plan ${goalId}`);

  // 挂起 — Gateway 收到事件后 resume
  interrupt('awaiting_plan');

  // 恢复后检查输出
  const wavesPath = path.join(mafwDir, 'waves.json');
  if (!fs.existsSync(wavesPath)) {
    return { lastError: 'waves.json not found after plan', reviewVerdict: 'ERROR' };
  }
  try {
    JSON.parse(fs.readFileSync(wavesPath, 'utf-8'));
  } catch (err: any) {
    return { lastError: `Invalid waves.json: ${err.message}`, reviewVerdict: 'ERROR' };
  }

  await destroySession(sessionId);

  syncToFile({ round: state.round, wavePlanPath: wavesPath, phase: 'PLANNING_COMPLETE' });

  return { wavePlanPath: wavesPath, round: state.round };
}
```

- [ ] **Step 2: Refactor execute.node.ts — same pattern**

```typescript
// src/langgraph/nodes/execute.node.ts
import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import * as path from 'path';
import * as fs from 'fs';

export interface ExecuteAgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function executeNode(
  state: LoopStateType,
  options: ExecuteAgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'EXECUTING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-execute ${goalId}`);

  interrupt('awaiting_execution');

  const receiptsDir = path.join(mafwDir, 'receipts', goalId);
  const receiptPath = path.join(receiptsDir, 'loop-receipt.json');
  if (!fs.existsSync(receiptPath)) {
    return { lastError: 'receipts not found after execute', reviewVerdict: 'ERROR' };
  }

  await destroySession(sessionId);

  syncToFile({ receiptPath, phase: 'EXECUTING_COMPLETE' });

  return { receiptPath };
}
```

- [ ] **Step 3: Refactor review.node.ts — same pattern**

```typescript
// src/langgraph/nodes/review.node.ts
import { interrupt } from "@langchain/langgraph";
import { LoopStateType } from '../loop-state';
import { parseReviewVerdict } from './review.node';
import * as path from 'path';
import * as fs from 'fs';

export interface ReviewAgentOptions {
  createSession: (projectDir: string) => Promise<string>;
  sendPrompt: (sessionId: string, message: string) => Promise<void>;
  destroySession: (sessionId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function reviewNode(
  state: LoopStateType,
  options: ReviewAgentOptions
): Promise<Partial<LoopStateType>> {
  const { createSession, sendPrompt, destroySession, syncToFile } = options;
  const { mafwDir, goalId, projectDir } = state;

  syncToFile({ ...state, phase: 'REVIEWING' });

  const sessionId = await createSession(projectDir);
  await sendPrompt(sessionId, `/skill mafw-review ${goalId}`);

  interrupt('awaiting_review');

  const reviewPath = path.join(mafwDir, 'reviews', `${goalId}-loop${state.round}.md`);
  if (!fs.existsSync(reviewPath)) {
    return { lastError: 'review report not found', reviewVerdict: 'ERROR' };
  }

  const content = fs.readFileSync(reviewPath, 'utf-8');
  const verdict = parseReviewVerdict(content);

  await destroySession(sessionId);

  syncToFile({
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
    phase: 'REVIEWING_COMPLETE',
  });

  return {
    reviewVerdict: verdict.verdict,
    reviewReportPath: reviewPath,
    reviewFeedback: verdict.feedback,
  };
}
```

- [ ] **Step 4: Create archive.node.ts**

```typescript
// src/langgraph/nodes/archive.node.ts
import { LoopStateType } from '../loop-state';

export interface ArchiveOptions {
  archiveGoal: (goalId: string) => Promise<void>;
  syncToFile: (state: Partial<LoopStateType>) => void;
}

export async function archiveSuccessNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.log(`[LangGraph] Goal ${state.goalId} PASSED after ${state.round} round(s)`);
  syncToFile({ ...state, phase: 'ARCHIVED' });
  await archiveGoal(state.goalId);
  return {};
}

export async function archiveFailNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.error(`[LangGraph] Goal ${state.goalId} FAILED: ${state.lastError}`);
  syncToFile({ ...state, phase: 'FAILED' });
  await archiveGoal(state.goalId);
  return {};
}

export async function archiveMaxRetriesNode(state: LoopStateType, options: ArchiveOptions): Promise<Partial<LoopStateType>> {
  const { archiveGoal, syncToFile } = options;
  console.error(`[LangGraph] Goal ${state.goalId} max retries (${state.maxRounds}) reached`);
  syncToFile({ ...state, phase: 'FAILED' });
  await archiveGoal(state.goalId);
  return {};
}
```

- [ ] **Step 5: Refactor graph.ts — StateGraph with retryPolicy**

```typescript
// src/langgraph/graph.ts
import { StateGraph, END } from "@langchain/langgraph";
import { LoopState } from "./loop-state";
import { planNode, AgentOptions } from './nodes/plan.node';
import { executeNode, ExecuteAgentOptions } from './nodes/execute.node';
import { reviewNode, ReviewAgentOptions } from './nodes/review.node';
import { archiveSuccessNode, archiveFailNode, archiveMaxRetriesNode, ArchiveOptions } from './nodes/archive.node';

export function routeAfterReview(state: typeof LoopState.State): string {
  if (state.reviewVerdict === "ERROR" || state.lastError) return "archive_fail";
  if (state.reviewVerdict === "PASS") return "archive_success";
  if (state.round >= state.maxRounds) return "archive_max_retries";
  return "plan";
}

export interface GraphOptions {
  plan: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  execute: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  review: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveSuccess: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveFail: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
  archiveMaxRetries: (state: typeof LoopState.State) => Promise<Partial<typeof LoopState.State>>;
}

export function buildExecutionGraph(options: GraphOptions) {
  const workflow = new StateGraph(LoopState)
    .addNode("plan", options.plan, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("execute", options.execute, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("review", options.review, {
      retryPolicy: { maxAttempts: 2 },
    })
    .addNode("archive_success", options.archiveSuccess)
    .addNode("archive_fail", options.archiveFail)
    .addNode("archive_max_retries", options.archiveMaxRetries)

    .addEdge("__start__", "plan")
    .addEdge("plan", "execute")
    .addEdge("execute", "review")
    .addConditionalEdges("review", routeAfterReview, {
      plan: "plan",
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

- [ ] **Step 6: Update index.ts exports**

```typescript
// src/langgraph/index.ts
export { LoopState } from './loop-state';
export type { LoopStateType } from './loop-state';
export { routeAfterReview, buildExecutionGraph } from './graph';
export { planNode } from './nodes/plan.node';
export { executeNode } from './nodes/execute.node';
export { reviewNode, parseReviewVerdict } from './nodes/review.node';
export { archiveSuccessNode, archiveFailNode, archiveMaxRetriesNode } from './nodes/archive.node';
export { FileCheckpointer } from './checkpointer';
```

- [ ] **Step 7: Run tests**

```bash
npx jest tests/unit/langgraph/ --no-coverage
```
Expected: all tests pass (update test imports if needed)

- [ ] **Step 8: Commit**

```bash
git add src/langgraph/
git commit -m "feat(langgraph): refactor nodes with interrupt, StateGraph with retryPolicy"
```

---

### Task 3: 重构 Gateway — onEvent resume + syncFromCheckpoint

**Files:**
- Modify: `gateway/src/index.ts`

**Consumes:** `buildExecutionGraph`, `FileCheckpointer` from Tasks 1-2

- [ ] **Step 1: Rewrite Gateway — remove old dispatch, add onEvent + resume**

```typescript
// gateway/src/index.ts — 关键变更

import { buildExecutionGraph, FileCheckpointer, LoopStateType } from '../../src/langgraph';
import { Command } from '@langchain/langgraph';

// ── Graph 工厂 ──

private buildNodeOptions(mafwDir: string) {
  const syncToFile = (state: Partial<LoopStateType>) => {
    syncToDashboard(state as any);
  };
  return {
    plan: async (s: any) => planNode(s, {
      createSession: this.createSession.bind(this),
      sendPrompt: this.sendPrompt.bind(this),
      destroySession: this.destroySession.bind(this),
      syncToFile: (st: any) => {
        syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir });
      },
    }),
    execute: async (s: any) => executeNode(s, {
      createSession: this.createSession.bind(this),
      sendPrompt: this.sendPrompt.bind(this),
      destroySession: this.destroySession.bind(this),
      syncToFile: (st: any) => {
        syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir });
      },
    }),
    review: async (s: any) => reviewNode(s, {
      createSession: this.createSession.bind(this),
      sendPrompt: this.sendPrompt.bind(this),
      destroySession: this.destroySession.bind(this),
      syncToFile: (st: any) => {
        syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir });
      },
    }),
    archiveSuccess: async (s: any) => archiveSuccessNode(s, {
      archiveGoal: this.archiveGoal.bind(this),
      syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
    }),
    archiveFail: async (s: any) => archiveFailNode(s, {
      archiveGoal: this.archiveGoal.bind(this),
      syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
    }),
    archiveMaxRetries: async (s: any) => archiveMaxRetriesNode(s, {
      archiveGoal: this.archiveGoal.bind(this),
      syncToFile: (st: any) => syncToFile({ ...s, ...st, projectDir: s.projectDir, mafwDir }),
    }),
  };
}

// ── 事件入口 ──

private async onEvent(goalId: string) {
  const found = this.findGoalStatePath(goalId);
  if (!found) return;
  const { info } = found;
  const cp = new FileCheckpointer(info.mafwDir);
  const current = cp.getCurrentState(goalId);
  if (!current) return; // 没有 checkpoint，忽略

  const graph = buildExecutionGraph(this.buildNodeOptions(info.mafwDir));
  await graph.resume(null, Command.RESUME({}), {
    configurable: { thread_id: goalId },
    checkpointer: cp,
  });
  await this.syncFromCheckpoint(goalId, cp);
}

private async onGoalCreated(goalId: string, projectDir: string, mafwDir: string) {
  const cp = new FileCheckpointer(mafwDir);
  const graph = buildExecutionGraph(this.buildNodeOptions(mafwDir));
  const initialState: any = {
    goalId, projectDir, mafwDir,
    round: 1, maxRounds: 3,
    wavePlanPath: null,
    receiptPath: null,
    reviewVerdict: 'FAIL' as const,
    reviewReportPath: null,
    reviewFeedback: '',
    lastError: null,
  };
  await graph.invoke(initialState, {
    configurable: { thread_id: goalId },
    checkpointer: cp,
  });
}

private async syncFromCheckpoint(goalId: string, cp: FileCheckpointer) {
  const current = await cp.getCurrentState(goalId);
  if (!current) return;
  syncToDashboard({
    goalId, round: current.round,
    phase: current.phase,
    reviewVerdict: current.verdict,
    lastError: current.lastError || null,
  } as any);
}
```

- [ ] **Step 2: Restore `handleValidate` to call onGoalCreated**

```typescript
private async handleValidate(goalId: string, data?: { projectDir?: string }): Promise<any> {
  // ... 创建 state.json 等（同现有逻辑）...

  setImmediate(() => this.onGoalCreated(goalId, projectDir, mafwDir));

  return { success: true, goalId, nextAction: 'GRAPH_INVOKED' };
}
```

- [ ] **Step 3: Modify POST /api/events to call onEvent**

```typescript
if (event.goalId && this.activeGoals.has(event.goalId)) {
  setImmediate(() => this.onEvent(event.goalId));
}
```

- [ ] **Step 4: Remove old methods**

Remove:
- `advanceStateMachines()`
- `advanceSingleGoal()`
- `dispatchSession()`
- `routeNextStep()`
- `convertToLangGraphState()`
- `createPhaseSession()` (replaced by node internals)
- `startSessionMonitor()`
- `WAIT_PHASE_COMPLETE` references

Keep:
- `createSession()`, `sendPrompt()`, `destroySession()` (used by nodes)
- `patchState()`, `archiveGoal()` (used by nodes)
- `syncToDashboard()` (Dashboard compat)
- `recoverState()` (startup recovery)
- `startBackupPolling()` (reduced to just discoverNewGoals + resumeStaleThreads)
- HTTP API endpoints

- [ ] **Step 5: Verify Gateway compiles**

```bash
cd gateway && npx tsc --noEmit
```
Expected: 0 errors

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```
Expected: 61 suites, 506 tests passing

- [ ] **Step 7: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(langgraph): Gateway onEvent resume, remove dispatchSession/startSessionMonitor"
```

---

### Task 4: resumeStaleThreads 兜底

**Files:**
- Modify: `gateway/src/index.ts`

- [ ] **Step 1: Add resumeStaleThreads to backupPolling**

```typescript
private async resumeStaleThreads() {
  for (const [, info] of this.registeredProjects) {
    const checkpointsDir = path.join(info.mafwDir, 'checkpoints');
    if (!fs.existsSync(checkpointsDir)) continue;
    const threads = fs.readdirSync(checkpointsDir);
    for (const threadId of threads) {
      // 如果 activeGoals 中没有这个 goal，但 checkpoint 存在 → 恢复
      if (!this.activeGoals.has(threadId)) {
        const cp = new FileCheckpointer(info.mafwDir);
        const state = await cp.getCurrentState(threadId);
        if (state && state.phase !== 'ARCHIVED' && state.phase !== 'FAILED') {
          console.log(`[Scheduler] Resuming stale thread ${threadId}`);
          await this.onEvent(threadId);
        }
      }
    }
  }
}

// 在 startBackupPolling 的 poll 函数末尾调用
private startBackupPolling() {
  const poll = async () => {
    if (!this.running) return;
    try {
      await this.discoverNewGoals();
      await this.resumeStaleThreads();
    } catch (err: any) {
      console.error('[Scheduler] Backup poll error:', err.message);
    }
    setTimeout(poll, 30000);
  };
  setTimeout(poll, 30000);
}
```

- [ ] **Step 2: Compile + test**

```bash
cd gateway && npx tsc --noEmit
npx jest --no-coverage
```

- [ ] **Step 3: Commit**

```bash
git add gateway/src/index.ts
git commit -m "feat(langgraph): add resumeStaleThreads for crash recovery"
```

---

### 改动总结

| 文件 | 操作 |
|------|------|
| `src/langgraph/checkpointer.ts` | **新增** — 文件持久化 Checkpointer |
| `src/langgraph/nodes/plan.node.ts` | **修改** — 添加 interrupt + createSession |
| `src/langgraph/nodes/execute.node.ts` | **修改** — 添加 interrupt + createSession |
| `src/langgraph/nodes/review.node.ts` | **修改** — 添加 interrupt + createSession |
| `src/langgraph/nodes/archive.node.ts` | **新增** — 从 sync.node 提取 archive 节点 |
| `src/langgraph/graph.ts` | **修改** — StateGraph + retryPolicy |
| `src/langgraph/index.ts` | **修改** — 更新 exports |
| `gateway/src/index.ts` | **修改** — onEvent/graph.resume，删除 ~300 行旧调度代码 |
| `tests/unit/langgraph/checkpointer.test.ts` | **新增** |
