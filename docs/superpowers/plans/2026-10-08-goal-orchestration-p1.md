# Goal 编排 P1：启用 + 节点驱动器重写 + Trace 地基 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 goal 编排端到端跑通（plan→execute→review→archive + askUser 中断恢复），用 state 文件 + 事件驱动的 NodeDriver 替换 langgraph 执行壳，并落节点级 trace（goal_node_runs 表 + goal_node 事件 + timeline/retry API）。

**Architecture:** NodeDriver（`gateway/src/core/goal/`）每 goal 一个状态机实例：`advance` 读 state v3 → 路由纯函数定下一节点 → 创建会话（绑 IdentityRegistry 身份）→ `void promptAsync` 发渲染后 prompt → 注册 per-session 完成监听；`handleOpencodeEvent` 的 idle/error 分支分发到驱动器；产物文件 + session.idle 双门判定节点完成。langgraph 图/checkpointer/interrupt 退役（路由纯函数搬走保留）。

**Tech Stack:** TypeScript (gateway CJS), jest + ts-jest, better-sqlite3 (gateway.db), @opencode-ai/sdk (session/promptAsync/abort)。

**Spec:** `docs/superpowers/specs/2026-10-08-goal-orchestration-p1-design.md`（决策 D1-D6 为本计划依据；关键调研 `docs/research/2026-10-08-node-driver-survey.md`）。

## Global Constraints

- TDD：每个任务先写失败测试再实现；测试命令 `cd gateway && npx jest tests/unit/<file> --runInBand`（全量 `npm test`）
- 所有 state 写入原子（`.tmp` + `fs.renameSync`，先例 `core/utils/state.ts:92-95`）
- `phase_transition` 事件 payload 形状不变：`{type, goalId, phase, loop, projectDir}`（milestone-push 零迁移）
- `onSessionCreated` 回调签名不变：`(info: {goalId, sessionId, phase, loop}) => void`（BudgetGuard + goal_sessions 落库照旧）
- 顶层 SSE 广播必须**扁平无 `data` 键**（wire 契约，AGENTS.md §5.6）
- 驱动器所有回调 try/catch，异常落 state.lastError 走 archive_fail 路由，绝不崩 gateway
- `promptAsync` 调用**不 await**（`void promise.catch(...)`）——pi 的 promptAsync 在 idle 会话阻塞到回合结束（pi-session.ts:117-120），await 会卡死 advance
- 每 task 一次 commit（repo 风格 `feat(goal): ...`）；只 add task 列出的文件（仓库有并行 agent 会话）
- 交付时报告新增测试数与全量通过数；版本 bump + AGENTS.md 更新在 Task 13

## 文件结构（分解决策锁定）

```
gateway/src/core/goal/           # 新模块（不塞 index.ts）
  routing.ts                     # 路由纯函数（从 langgraph/graph.ts 搬走）
  state-v3.ts                    # GoalStateV3 + 原子读写 + round/loop 双读
  node-run-store.ts              # NodeRunRow 类型再导出（表在 gateway-db.ts）
  node-prompts.ts                # 节点 prompt 模板渲染（替换 /skill 裸文本）
  driver.ts                      # NodeDriver 状态机
  starter.ts                     # resolveGoalDir 目录解析纯函数
  recovery.ts                    # 崩溃恢复 + watchdog 扫描
gateway/src/routes/
  goal-timeline.ts               # GET /api/goals/:id/timeline
  goal-node-retry.ts             # POST /api/goals/:id/nodes/:runId/retry
gateway/tests/unit/helpers/
  goal-driver-harness.ts         # 共享测试基建（Task 6 建，Tasks 7/8/11 复用）
修改：
  gateway/src/memory/gateway-db.ts        # goal_node_runs DDL + 4 方法
  gateway/src/runtime/identity-registry.ts # mafw-plan/execute/review 三身份
  gateway/src/mcp/handlers/manager-set-goal.ts / create-goal.ts  # projectDir
  gateway/src/index.ts                    # 接线（锚点见 Task 9）
  packages/gateway-sdk/src/client.ts      # goals.timeline / goals.retryNode
```

---

### Task 1: 路由纯函数移植（core/goal/routing.ts）

**Files:**
- Create: `gateway/src/core/goal/routing.ts`
- Test: `gateway/tests/unit/goal-routing.test.ts`

**Interfaces:**
- Consumes: 无（纯函数）
- Produces: `type GoalNodeName`、`routeAfterPlan(s)`、`routeAfterReview(s)`、`routeNext(stage, s)`；入参 `RouteState = {lastError, reviewVerdict, round, maxRounds, pendingQuestion}`（GoalStateV3 子集）——Task 6/7/11 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-routing.test.ts
import { routeAfterPlan, routeAfterReview, routeNext } from '../../src/core/goal/routing';

const base = {
  lastError: null as string | null,
  reviewVerdict: null as 'PASS' | 'FAIL' | 'ERROR' | null,
  round: 1,
  maxRounds: 3,
  pendingQuestion: null as any,
};

describe('routeAfterPlan', () => {
  it('pendingQuestion → askUser', () => {
    expect(routeAfterPlan({ ...base, pendingQuestion: { questionId: 'q1' } })).toBe('askUser');
  });
  it('无 pendingQuestion → execute', () => {
    expect(routeAfterPlan(base)).toBe('execute');
  });
});

describe('routeAfterReview（语义逐字移植 graph.ts:4-10）', () => {
  it('lastError → archive_fail（最高优先）', () => {
    expect(routeAfterReview({ ...base, lastError: 'x', reviewVerdict: 'PASS' })).toBe('archive_fail');
  });
  it('PASS → archive_success（先于 maxRounds）', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'PASS', round: 9 })).toBe('archive_success');
  });
  it('round>=maxRounds → archive_max_retries', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 3, maxRounds: 3 })).toBe('archive_max_retries');
  });
  it('FAIL round<max 且 pendingQuestion → askUser', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 1, pendingQuestion: { questionId: 'q1' } })).toBe('askUser');
  });
  it('否则 → plan', () => {
    expect(routeAfterReview({ ...base, reviewVerdict: 'FAIL', round: 1 })).toBe('plan');
  });
});

describe('routeNext', () => {
  it('stage 决定入口', () => {
    expect(routeNext('after_plan', base)).toBe('execute');
    expect(routeNext('after_execute', base)).toBe('review');
    expect(routeNext('after_review', { ...base, reviewVerdict: 'PASS' })).toBe('archive_success');
    expect(routeNext('start', base)).toBe('plan');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-routing.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../src/core/goal/routing'`

- [ ] **Step 3: 实现（从 graph.ts 逐字移植，不引 langgraph）**

```typescript
// gateway/src/core/goal/routing.ts
// 路由纯函数——从 core/langgraph/graph.ts:4-15 移植（langgraph 退役，语义逐字保留）。

export type GoalNodeName =
  | 'plan' | 'execute' | 'review' | 'askUser'
  | 'archive_success' | 'archive_fail' | 'archive_max_retries';

export interface RouteState {
  lastError: string | null;
  reviewVerdict: 'PASS' | 'FAIL' | 'ERROR' | null;
  round: number;
  maxRounds: number;
  pendingQuestion: unknown;
}

export type RouteStage = 'start' | 'after_plan' | 'after_execute' | 'after_review';

export function routeAfterPlan(s: RouteState): GoalNodeName {
  if (s.pendingQuestion) return 'askUser';
  return 'execute';
}

export function routeAfterReview(s: RouteState): GoalNodeName {
  if (s.lastError) return 'archive_fail';
  if (s.reviewVerdict === 'PASS') return 'archive_success';
  if (s.round >= s.maxRounds) return 'archive_max_retries';
  if (s.pendingQuestion) return 'askUser';
  return 'plan';
}

export function routeNext(stage: RouteStage, s: RouteState): GoalNodeName {
  switch (stage) {
    case 'start': return 'plan';
    case 'after_plan': return routeAfterPlan(s);
    case 'after_execute': return 'review';
    case 'after_review': return routeAfterReview(s);
  }
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-routing.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/routing.ts gateway/tests/unit/goal-routing.test.ts
git commit -m "feat(goal): port routing pure functions out of langgraph graph"
```

---

### Task 2: State v3 模块（core/goal/state-v3.ts）

**Files:**
- Create: `gateway/src/core/goal/state-v3.ts`
- Test: `gateway/tests/unit/goal-state-v3.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `GoalStateV3`、`NodeSessionRef`、`PendingQuestion`、`statePathFor(mafwDir, goalId)`、`loadGoalState`、`writeGoalState(mafwDir, goalId, patch, opts?)`、`ensureGoalState(mafwDir, goalId, init)`、`effectiveRound(s)`、`isTerminalState(s)`——Task 6/7/8/9/11/12 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-state-v3.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  GoalStateV3, statePathFor, loadGoalState, writeGoalState,
  ensureGoalState, effectiveRound, isTerminalState,
} from '../../src/core/goal/state-v3';

function tmpMafwDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-state-'));
}

describe('state-v3', () => {
  it('ensureGoalState 幂等：已存在则不覆盖', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
    writeGoalState(dir, 'g1', { round: 5 });
    const s2 = ensureGoalState(dir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
    expect(s2.round).toBe(5);
  });

  it('ensureGoalState 新建：version 3 / nextNode plan / round=loop=1 / policySnapshot', () => {
    const dir = tmpMafwDir();
    const s = ensureGoalState(dir, 'g2', { projectDir: 'C:/p', maxRounds: 3, policySnapshot: { version: 'builtin-v1' } });
    expect(s.version).toBe('3');
    expect(s.nextNode).toBe('plan');
    expect(s.round).toBe(1);
    expect(s.loop).toBe(1); // 双写别名（dashboard/旧读方兼容）
    expect(s.phase).toBe('PLANNING');
    expect(s.policySnapshot).toEqual({ version: 'builtin-v1' });
  });

  it('writeGoalState 原子合并 + round/loop 双写 + updatedAt 刷新 + 无 tmp 残留', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g3', { projectDir: 'C:/p', maxRounds: 3 });
    const before = loadGoalState(dir, 'g3')!;
    writeGoalState(dir, 'g3', { round: 2, lastError: 'boom' });
    const after = loadGoalState(dir, 'g3')!;
    expect(after.round).toBe(2);
    expect(after.loop).toBe(2);
    expect(after.lastError).toBe('boom');
    expect(after.maxRounds).toBe(before.maxRounds);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
    expect(fs.existsSync(statePathFor(dir, 'g3') + '.tmp')).toBe(false);
  });

  it('writeGoalState bumpVersion 显式递增 stateVersion', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g4', { projectDir: 'C:/p', maxRounds: 3 });
    const s = writeGoalState(dir, 'g4', { reviewVerdict: 'FAIL' }, { bumpVersion: true });
    expect(s.stateVersion).toBe(1);
  });

  it('effectiveRound: round 优先，回退 loop，再回退 0', () => {
    expect(effectiveRound({ round: 3, loop: 9 })).toBe(3);
    expect(effectiveRound({ loop: 9 } as any)).toBe(9);
    expect(effectiveRound({} as any)).toBe(0);
  });

  it('isTerminalState: nextAction 终态集', () => {
    expect(isTerminalState({ nextAction: 'COMPLETED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'FAILED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'CANCELLED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'RUNNING_plan' } as GoalStateV3)).toBe(false);
  });

  it('loadGoalState 读旧 v2（loop 字段）→ effectiveRound 规范化', () => {
    const dir = tmpMafwDir();
    fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
    fs.writeFileSync(statePathFor(dir, 'g5'), JSON.stringify({
      version: '2', goalId: 'g5', loop: 4, phase: 'EXECUTING', nextAction: 'WAIT_PHASE_COMPLETE',
    }), 'utf-8');
    const s = loadGoalState(dir, 'g5');
    expect(s).not.toBeNull();
    expect(effectiveRound(s!)).toBe(4);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-state-v3.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// gateway/src/core/goal/state-v3.ts
// GoalStateV3 —— NodeDriver 的唯一状态真相源（spec §5）。
// 写入方：NodeDriver（唯一）；读取方：驱动器/timeline/dashboard（双读兼容 round/loop）。
import * as fs from 'fs';
import * as path from 'path';

export interface NodeSessionRef {
  id: string;
  phase: 'plan' | 'execute' | 'review';
  startedAt: string;
  attempt: number;
  runId: number;
}

export interface PendingQuestion {
  questionId: string;
  node: 'plan' | 'review';
  loop: number;
  questions: string[];
  askedAt: string;
}

export interface UserResponse {
  questionId: string;
  answer: string;
  respondedAt: string;
}

export interface GoalStateV3 {
  version: '3';
  goalId: string;
  projectDir: string;
  mafwDir: string;
  phase: string;
  round: number;
  loop: number; // round 的双写别名（读取走 effectiveRound）
  maxRounds: number;
  reviewVerdict: 'PASS' | 'FAIL' | 'ERROR' | null;
  reviewReportPath: string | null;
  reviewFeedback: string;
  wavePlanPath: string | null;
  receiptPath: string | null;
  lastError: string | null;
  nodeSession: NodeSessionRef | null;
  pendingQuestion: PendingQuestion | null;
  userResponse: UserResponse | null;
  sameSigCount: number;
  stateVersion: number;
  nextNode: string;
  nextAction: string;
  artifacts: Record<string, string>;
  currentWave: number;
  totalWaves: number | null;
  sessions: Record<string, { id: string; createdAt: string; destroyedAt?: string; active: boolean }>;
  policySnapshot?: { version: string; proposalId: string | null; maxTurns?: number; maxCostUsd?: number };
  updatedAt: string;
}

const TERMINAL_ACTIONS = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED']);

export function statePathFor(mafwDir: string, goalId: string): string {
  return path.join(mafwDir, 'state', `${goalId}.json`);
}

export function effectiveRound(s: { round?: number; loop?: number }): number {
  return s.round ?? s.loop ?? 0;
}

export function isTerminalState(s: GoalStateV3): boolean {
  return TERMINAL_ACTIONS.has(s.nextAction);
}

/** 读 state（v3 或旧 v2 均可；旧格式不重写，读取侧规范化）。 */
export function loadGoalState(mafwDir: string, goalId: string): GoalStateV3 | null {
  const p = statePathFor(mafwDir, goalId);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return normalize(raw, mafwDir, goalId);
  } catch {
    return null;
  }
}

function normalize(raw: any, mafwDir: string, goalId: string): GoalStateV3 {
  const round = effectiveRound(raw);
  return {
    version: '3',
    goalId: raw.goalId ?? goalId,
    projectDir: raw.projectDir ?? '',
    mafwDir: raw.mafwDir ?? mafwDir,
    phase: raw.phase ?? null,
    round,
    loop: round,
    maxRounds: raw.maxRounds ?? 3,
    reviewVerdict: raw.reviewVerdict ?? null,
    reviewReportPath: raw.reviewReportPath ?? null,
    reviewFeedback: raw.reviewFeedback ?? '',
    wavePlanPath: raw.wavePlanPath ?? null,
    receiptPath: raw.receiptPath ?? null,
    lastError: raw.lastError ?? raw.error ?? null,
    nodeSession: raw.nodeSession ?? null,
    pendingQuestion: raw.pendingQuestion ?? null,
    userResponse: raw.userResponse ?? null,
    sameSigCount: raw.sameSigCount ?? 0,
    stateVersion: raw.stateVersion ?? 0,
    nextNode: raw.nextNode ?? 'plan',
    nextAction: raw.nextAction ?? 'RUNNING_plan',
    artifacts: raw.artifacts ?? {},
    currentWave: raw.currentWave ?? 0,
    totalWaves: raw.totalWaves ?? null,
    sessions: raw.sessions ?? {},
    policySnapshot: raw.policySnapshot,
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/** 原子合并写入（.tmp + rename；round/loop 双写）。 */
export function writeGoalState(
  mafwDir: string,
  goalId: string,
  patch: Partial<GoalStateV3>,
  opts?: { bumpVersion?: boolean },
): GoalStateV3 {
  const p = statePathFor(mafwDir, goalId);
  const current = loadGoalState(mafwDir, goalId);
  if (!current) throw new Error(`State file not found: ${p}`);
  const round = patch.round ?? current.round;
  const next: GoalStateV3 = {
    ...current,
    ...patch,
    round,
    loop: round,
    stateVersion: opts?.bumpVersion ? (current.stateVersion ?? 0) + 1 : current.stateVersion ?? 0,
    updatedAt: new Date().toISOString(),
  };
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
  fs.renameSync(tmp, p);
  return next;
}

/** starter 用：无 state 则建（含 policySnapshot），有则原样返回（幂等）。 */
export function ensureGoalState(
  mafwDir: string,
  goalId: string,
  init: { projectDir: string; maxRounds: number; policySnapshot?: GoalStateV3['policySnapshot'] },
): GoalStateV3 {
  const existing = loadGoalState(mafwDir, goalId);
  if (existing) return existing;
  const s: GoalStateV3 = {
    version: '3', goalId,
    projectDir: init.projectDir, mafwDir,
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: init.maxRounds,
    reviewVerdict: null, reviewReportPath: null, reviewFeedback: '',
    wavePlanPath: null, receiptPath: null, lastError: null,
    nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 0,
    nextNode: 'plan', nextAction: 'RUNNING_plan',
    artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
    ...(init.policySnapshot ? { policySnapshot: init.policySnapshot } : {}),
    updatedAt: new Date().toISOString(),
  };
  const p = statePathFor(mafwDir, goalId);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2), 'utf-8');
  return s;
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-state-v3.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/state-v3.ts gateway/tests/unit/goal-state-v3.test.ts
git commit -m "feat(goal): GoalStateV3 module — atomic writes, round/loop dual-read"
```

---

### Task 3: goal_node_runs 表 + store（gateway-db.ts）

**Files:**
- Modify: `gateway/src/memory/gateway-db.ts`（DDL 加在 goal_sessions 表之后 ~L231；类追加 4 方法）
- Create: `gateway/src/core/goal/node-run-store.ts`（类型再导出）
- Test: `gateway/tests/unit/goal-node-runs.test.ts`

**Interfaces:**
- Consumes: `GatewayDatabase`（已有；`:memory:` 可测——先例 goal-outcomes.test.ts）
- Produces: `NodeRunRow`；方法 `insertNodeRun(input): number`、`finishNodeRun(id, patch)`、`listNodeRuns(goalId): NodeRunRow[]`、`latestNodeAttempt(goalId, loop, node): NodeRunRow | null`——Task 6/7/11/12 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-node-runs.test.ts
import { GatewayDatabase } from '../../src/memory/gateway-db';

describe('goal_node_runs', () => {
  let db: GatewayDatabase;
  beforeEach(() => { db = new GatewayDatabase(':memory:'); });
  afterEach(() => { db.close(); });

  it('insert → running 行带 id', () => {
    const id = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'plan',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    expect(typeof id).toBe('number');
    const rows = db.listNodeRuns('g1');
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('running');
    expect(rows[0].session_id).toBe('ses_1');
  });

  it('finishNodeRun 更新状态/产物（不覆盖 attempt）', () => {
    const id = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'review',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    db.finishNodeRun(id, {
      status: 'succeeded', finishedAt: '2026-10-08T00:05:00Z',
      outcome: 'PASS', tokensInput: 100, tokensOutput: 50, costUsd: 0.01,
    });
    const row = db.listNodeRuns('g1').find((r) => r.id === id)!;
    expect(row.status).toBe('succeeded');
    expect(row.outcome).toBe('PASS');
    expect(row.attempt).toBe(1);
    expect(row.tokens_input).toBe(100);
    expect(row.cost_usd).toBeCloseTo(0.01);
  });

  it('watchdog 重试 = 新行新 attempt，失败历史保留', () => {
    const id1 = db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute',
      attempt: 1, sessionId: 'ses_1', startedAt: '2026-10-08T00:00:00Z',
    });
    db.finishNodeRun(id1, { status: 'timeout', finishedAt: '2026-10-08T00:30:00Z', error: 'timeout' });
    db.insertNodeRun({
      goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute',
      attempt: 2, sessionId: 'ses_2', startedAt: '2026-10-08T00:31:00Z',
    });
    const rows = db.listNodeRuns('g1');
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.status === 'timeout')).toHaveLength(1);
  });

  it('latestNodeAttempt 取该 (goal,loop,node) 最新行', () => {
    db.insertNodeRun({ goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute', attempt: 1, sessionId: 's1', startedAt: 't1' });
    db.insertNodeRun({ goalId: 'g1', projectId: 'C:/p', loop: 1, node: 'execute', attempt: 2, sessionId: 's2', startedAt: 't2' });
    expect(db.latestNodeAttempt('g1', 1, 'execute')!.attempt).toBe(2);
    expect(db.latestNodeAttempt('g1', 1, 'plan')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-node-runs.test.ts --runInBand`
Expected: FAIL — `db.insertNodeRun is not a function`

- [ ] **Step 3: 实现**

`gateway/src/memory/gateway-db.ts` DDL 块（紧跟 goal_sessions 之后）追加：

```sql
CREATE TABLE IF NOT EXISTS goal_node_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  loop INTEGER NOT NULL,
  node TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  session_id TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome TEXT,
  error TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  cost_usd REAL
)
```

```sql
CREATE INDEX IF NOT EXISTS idx_node_runs_goal ON goal_node_runs(goal_id, loop)
```

GatewayDatabase 类追加（跟随该文件既有 better-sqlite3 同步风格；`NodeRunRow` 接口同文件导出）：

```typescript
export interface NodeRunRow {
  id: number; goal_id: string; project_id: string; loop: number; node: string;
  attempt: number; session_id: string | null; status: string;
  started_at: string; finished_at: string | null; outcome: string | null; error: string | null;
  tokens_input: number | null; tokens_output: number | null; cost_usd: number | null;
}

insertNodeRun(input: {
  goalId: string; projectId: string; loop: number; node: string;
  attempt: number; sessionId: string | null; startedAt: string;
}): number {
  const info = this.db.prepare(`
    INSERT INTO goal_node_runs (goal_id, project_id, loop, node, attempt, session_id, status, started_at)
    VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
  `).run(input.goalId, input.projectId, input.loop, input.node, input.attempt, input.sessionId, input.startedAt);
  return Number(info.lastInsertRowid);
}

finishNodeRun(id: number, patch: {
  status: string; finishedAt: string; outcome?: string | null; error?: string | null;
  tokensInput?: number | null; tokensOutput?: number | null; costUsd?: number | null;
}): void {
  this.db.prepare(`
    UPDATE goal_node_runs
    SET status = ?, finished_at = ?,
        outcome = COALESCE(?, outcome), error = COALESCE(?, error),
        tokens_input = COALESCE(?, tokens_input), tokens_output = COALESCE(?, tokens_output),
        cost_usd = COALESCE(?, cost_usd)
    WHERE id = ?
  `).run(patch.status, patch.finishedAt, patch.outcome ?? null, patch.error ?? null,
    patch.tokensInput ?? null, patch.tokensOutput ?? null, patch.costUsd ?? null, id);
}

listNodeRuns(goalId: string): NodeRunRow[] {
  return this.db.prepare(
    'SELECT * FROM goal_node_runs WHERE goal_id = ? ORDER BY id ASC'
  ).all(goalId) as NodeRunRow[];
}

latestNodeAttempt(goalId: string, loop: number, node: string): NodeRunRow | null {
  const row = this.db.prepare(
    'SELECT * FROM goal_node_runs WHERE goal_id = ? AND loop = ? AND node = ? ORDER BY id DESC LIMIT 1'
  ).get(goalId, loop, node) as NodeRunRow | undefined;
  return row ?? null;
}
```

`gateway/src/core/goal/node-run-store.ts`：

```typescript
// gateway/src/core/goal/node-run-store.ts
export type { NodeRunRow } from '../../memory/gateway-db';
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-node-runs.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/memory/gateway-db.ts gateway/src/core/goal/node-run-store.ts gateway/tests/unit/goal-node-runs.test.ts
git commit -m "feat(goal): goal_node_runs table + store methods (per-node trace)"
```

---

### Task 4: 三节点身份注册（identity-registry.ts）

**Files:**
- Modify: `gateway/src/runtime/identity-registry.ts`（`buildBuiltins()` 返回数组追加 3 个 IdentitySpec）
- Test: `gateway/tests/unit/goal-identities.test.ts`

**Interfaces:**
- Consumes: `IdentitySpec`/`toAgentDefinition`/`policyDecides`（v4.21.0 已有）
- Produces: 注册表含 `mafw-plan`（deny file-edit/shell/web）、`mafw-execute`（无 deny）、`mafw-review`（deny file-edit/web，allowlist 含 shell）——Task 6 驱动器以 `agent: 'mafw-'+node` 绑定；物化经 `materializeIdentities()`（index.ts:1192）自动覆盖，**无需另接线**

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-identities.test.ts
import { createBuiltinIdentityRegistry, toAgentDefinition, policyDecides } from '../../src/runtime/identity-registry';

const registry = createBuiltinIdentityRegistry();
// 类别映射（与 identity-registry.ts TOOL_CATEGORY_TABLES.opencode 一致的子集）
const CAT: Record<string, string> = {
  edit: 'file-edit', write: 'file-edit', apply_patch: 'file-edit',
  bash: 'shell', read: 'readonly', grep: 'readonly', glob: 'readonly',
};
const cat = (t: string) => CAT[t] ?? null;

describe('goal 节点身份', () => {
  it('注册表含三个节点身份，scope=worker，systemPrompt 非空', () => {
    for (const name of ['mafw-plan', 'mafw-execute', 'mafw-review']) {
      const spec = registry.get(name);
      expect(spec).toBeDefined();
      expect(spec!.scope).toBe('worker');
      expect(spec!.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('mafw-plan 拒绝 file-edit 与 shell，放行 readonly', () => {
    const policy = registry.get('mafw-plan')!.policy;
    expect(policyDecides(policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(policy, 'bash', cat)).toBe('deny');
    expect(policyDecides(policy, 'read', cat)).toBe('allow');
  });

  it('mafw-review 拒绝 file-edit、放行 bash（跑测试）', () => {
    const policy = registry.get('mafw-review')!.policy;
    expect(policyDecides(policy, 'edit', cat)).toBe('deny');
    expect(policyDecides(policy, 'bash', cat)).toBe('allow');
  });

  it('mafw-execute 无 deny（全开）', () => {
    expect(registry.get('mafw-execute')!.policy.deny).toHaveLength(0);
  });

  it('toAgentDefinition：deny 类别派生原生权限', () => {
    const def = toAgentDefinition(registry.get('mafw-plan')!);
    expect(def.mode).toBe('subagent');
    expect((def.permissions as any).edit).toBe('deny');
    expect((def.permissions as any).bash).toBe('deny');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-identities.test.ts --runInBand`
Expected: FAIL — `registry.get('mafw-plan')` undefined

- [ ] **Step 3: 实现（buildBuiltins 数组尾部追加）**

```typescript
    {
      name: 'mafw-plan',
      description: 'MAFW goal 编排 plan 节点：依据 charter 拆解 waves 计划，产出 waves.json。只读。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 PLAN 节点执行者。你的唯一任务是依据 goal charter 产出 wave 计划文件。',
        '',
        '规则：',
        '1. 先读 charter 与请求文件（用户 prompt 会给出路径），理解目标、边界、成功指标。',
        '2. 把工作拆成有序 waves（每个 wave = 一批可独立验证的任务），写入用户 prompt 指定的 waves.json 路径。',
        '3. waves.json 必须是合法 JSON：{ "waves": [ { "id": "w1", "title": "...", "tasks": ["..."] } ], "status": "ready" }。',
        '4. 若 charter 存在无法自行消除的歧义：写 { "status": "need_clarification", "ambiguities": ["问题1"] } 而不是猜测。',
        '5. 你没有写代码权限——只做规划与读仓库。完成后简短汇报 wave 数量，不要贴全文。',
      ].join('\n'),
      policy: {
        deny: ['file-edit', 'shell', 'web'],
        allowlist: ['readonly', 'mafw_get_goal_status', 'mafw_get_deltas', 'mafw_search_hybrid'],
      },
    },
    {
      name: 'mafw-execute',
      description: 'MAFW goal 编排 execute 节点：按 waves.json 执行任务，产出 receipts。全权限。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 EXECUTE 节点执行者。按计划文件逐 wave 执行任务并写回执。',
        '',
        '规则：',
        '1. 读 waves.json（路径在用户 prompt 中），逐 wave 执行；每完成一个任务把结果记入用户 prompt 指定的 receipt JSON 文件。',
        '2. receipt 格式：{ "goalId": "...", "timestamp": "...", "receipts": [ { "taskId": "...", "status": "done|failed|skipped", "summary": "一句话", "files": ["改动文件"] } ] }。',
        '3. 遇到阻塞不要停下来提问——标记 status: "failed" 并在 summary 写明原因，让 review 节点裁决。',
        '4. 用 TDD：先测试后实现；跑测试验证你的改动。',
        '5. 不修改 waves.json 本身；执行中发现计划错误，在 receipt 里记录 deviation。',
      ].join('\n'),
      policy: { deny: [] },
    },
    {
      name: 'mafw-review',
      description: 'MAFW goal 编排 review 节点：独立验证执行结果，产出结构化 verdict。只读+可跑测试。',
      scope: 'worker',
      systemPrompt: [
        '你是 MAFW goal 编排的 REVIEW 节点执行者——独立 evaluator，不是执行者的延续。',
        '',
        '规则：',
        '1. 读 charter、waves.json 与 receipt（路径在用户 prompt 中），然后用只读工具与测试命令独立验证：代码是否真的改了、测试是否真的通过、指标是否真的达成。',
        '2. 不信任 receipt 的自述——用证据（文件内容、测试输出）复核。',
        '3. 把评审报告写入用户 prompt 指定的 markdown 路径，末尾必须带机器可读 verdict 块（```mafw-review 围栏 JSON）：',
        '   { "verdict": "PASS" | "FAIL", "feedback": "FAIL 时给可操作的修复指引；PASS 时一句话总结" }',
        '4. FAIL 的 feedback 要具体到文件与行为，供下一轮 plan 消化。',
        '5. 你没有写代码权限——发现问题时描述问题，不要顺手修。',
      ].join('\n'),
      policy: {
        deny: ['file-edit', 'web'],
        allowlist: ['readonly', 'shell', 'mafw_get_goal_status', 'mafw_search_hybrid'],
      },
    },
```

- [ ] **Step 4: 跑测试通过 + 既有 identity 回归**

Run: `cd gateway && npx jest tests/unit/goal-identities.test.ts --runInBand && npx jest tests/unit --runInBand -t identity`
Expected: PASS（v4.21.0 既有用例不受影响）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/runtime/identity-registry.ts gateway/tests/unit/goal-identities.test.ts
git commit -m "feat(goal): mafw-plan/execute/review worker identities with permission gradients"
```

---

### Task 5: 节点 prompt 模板（core/goal/node-prompts.ts）

**Files:**
- Create: `gateway/src/core/goal/node-prompts.ts`
- Test: `gateway/tests/unit/goal-node-prompts.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `nodeArtifactPaths(mafwDir, goalId, round): {waves, receipt, review}`（**receipt 为 per-loop 路径**）、`renderNodePrompt(node, ctx)`——Task 6/7 消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-node-prompts.test.ts
import { nodeArtifactPaths, renderNodePrompt } from '../../src/core/goal/node-prompts';

describe('nodeArtifactPaths', () => {
  it('receipts 按 loop 分文件（不再覆盖）；waves/review 路径稳定', () => {
    const p = nodeArtifactPaths('C:/m', 'g1', 2);
    expect(p.receipt).toContain(path.join('receipts', 'g1', 'loop-2-receipt.json').replace(/\\/g, '/'));
    expect(p.waves).toContain('waves.json');
    expect(p.review).toContain('g1-loop2.md');
  });
});

describe('renderNodePrompt', () => {
  const ctx = {
    goalId: 'g1', projectDir: 'C:/p', mafwDir: 'C:/m', round: 2, maxRounds: 3,
    charterPath: 'C:/m/goals/g1.md', requestPath: 'C:/m/requests/g1.json',
    reviewFeedback: '测试没跑',
  };

  it('plan prompt 含产物路径与格式示例，且不含 /skill 字样', () => {
    const p = renderNodePrompt('plan', ctx);
    expect(p).toContain('waves.json');
    expect(p).toContain('need_clarification');
    expect(p).not.toContain('/skill');
    expect(p).toContain('测试没跑'); // round>1 带上轮 feedback
  });

  it('execute prompt 含 per-loop receipt 路径', () => {
    const p = renderNodePrompt('execute', ctx);
    expect(p).toContain('loop-2-receipt.json');
    expect(p).toContain('receipts');
  });

  it('review prompt 含 review 路径 + mafw-review 围栏 + 上轮 feedback', () => {
    const p = renderNodePrompt('review', ctx);
    expect(p).toContain('g1-loop2.md');
    expect(p).toContain('mafw-review');
    expect(p).toContain('测试没跑');
  });
});
```

（文件头补 `import * as path from 'path';`）

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-node-prompts.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

```typescript
// gateway/src/core/goal/node-prompts.ts
// 节点用户 prompt 模板——替换旧 '/skill mafw-*' 裸文本（opencode 无对应物）。
// 角色纪律在身份 systemPrompt（Task 4）；这里只注入每 goal/loop 的实例上下文与产物契约。
import * as path from 'path';

export interface NodeArtifactPaths {
  waves: string;
  receipt: string; // per-loop，不覆盖
  review: string;
}

export function nodeArtifactPaths(mafwDir: string, goalId: string, round: number): NodeArtifactPaths {
  return {
    waves: path.join(mafwDir, 'waves.json'),
    receipt: path.join(mafwDir, 'receipts', goalId, `loop-${round}-receipt.json`),
    review: path.join(mafwDir, 'reviews', `${goalId}-loop${round}.md`),
  };
}

export interface NodePromptCtx {
  goalId: string;
  projectDir: string;
  mafwDir: string;
  round: number;
  maxRounds: number;
  charterPath: string;
  requestPath: string;
  reviewFeedback?: string;
}

export function renderNodePrompt(node: 'plan' | 'execute' | 'review', ctx: NodePromptCtx): string {
  const a = nodeArtifactPaths(ctx.mafwDir, ctx.goalId, ctx.round);
  const head = `【MAFW Goal ${ctx.goalId} · loop ${ctx.round}/${ctx.maxRounds}】`;
  const docs = `charter: ${ctx.charterPath}\nrequest: ${ctx.requestPath}`;

  if (node === 'plan') {
    return [
      head, docs, '',
      `任务：阅读 charter 与仓库现状，产出 wave 执行计划，写入 ${a.waves}。`,
      ctx.round > 1 && ctx.reviewFeedback
        ? `上一轮 review 指出的问题（本轮计划必须消化）：\n${ctx.reviewFeedback}` : '',
      '',
      `产物契约（必须是合法 JSON，写入 ${a.waves}）：`,
      '{"waves":[{"id":"w1","title":"...","tasks":["..."]}],"status":"ready"}',
      '若存在无法自行消除的歧义：{"status":"need_clarification","ambiguities":["问题..."]}',
    ].filter(Boolean).join('\n');
  }

  if (node === 'execute') {
    return [
      head, docs, '',
      `任务：读 ${a.waves}，逐 wave 执行。每完成一个任务把回执写入 ${a.receipt}（写完整个 JSON，覆盖式更新）。`,
      '',
      `产物契约（写入 ${a.receipt}）：`,
      `{"goalId":"${ctx.goalId}","timestamp":"<ISO>","receipts":[{"taskId":"w1-t1","status":"done|failed|skipped","summary":"一句话","files":["改动文件"]}]}`,
      '阻塞不停下提问：标 failed 并写明原因。用 TDD，跑测试验证。',
    ].join('\n');
  }

  return [
    head, docs, '',
    `任务：独立验证本轮执行结果。读 charter、${a.waves}、回执 ${a.receipt}，用只读工具与测试命令复核（不信任回执自述）。`,
    ctx.reviewFeedback ? `上轮 review 参考：${ctx.reviewFeedback}` : '',
    '',
    `把评审报告（markdown）写入 ${a.review}，文件末尾必须包含：`,
    '```mafw-review',
    '{"verdict":"PASS|FAIL","feedback":"FAIL 时给具体修复指引"}',
    '```',
  ].filter(Boolean).join('\n');
}
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-node-prompts.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/node-prompts.ts gateway/tests/unit/goal-node-prompts.test.ts
git commit -m "feat(goal): node prompt templates with per-loop artifact contracts"
```

---

### Task 6: NodeDriver 核心 + 共享测试 harness

**Files:**
- Create: `gateway/src/core/goal/driver.ts`
- Create: `gateway/tests/unit/helpers/goal-driver-harness.ts`（共享测试基建——Tasks 7/8/11 复用）
- Test: `gateway/tests/unit/goal-driver.test.ts`

**Interfaces:**
- Consumes: Task 1 `routeNext`、Task 2 state-v3、Task 3 db 方法签名、Task 5 `renderNodePrompt/nodeArtifactPaths`
- Produces: `GoalRuntimeClient`、`DriverDeps`、`class NodeDriver`：
  - `advance(goalId): Promise<void>`（互斥幂等推进）
  - `onSessionIdle(sessionID)` / `onSessionError(sessionID, msg)`（index.ts 事件分发入口）
  - `handleAnswer(goalId, questionId, answer): boolean`（Task 8 实现）
  - `handleCancel(goalId, questionId): boolean`（Task 8 实现）
  - `examineStaleNode(goalId, opts?)`（Task 11 实现）
  - `registerGoalDir(goalId, mafwDir)`、`retryNodeRun(goalId, runId)`（Task 12 用）
  - 本 task 实现：构造 / advance / executeNode（启动侧）/ executeAskUser / executeArchive / failNode；`completeNode` 留空（Task 7）+ `handleAnswer/handleCancel/examineStaleNode/retryNodeRun` 留 stub

- [ ] **Step 1: 写共享 harness（先于测试——它是测试基建不是被测物）**

```typescript
// gateway/tests/unit/helpers/goal-driver-harness.ts
// NodeDriver 测试共享基建：fake client/deps + state 工厂。
// Tasks 6/7/8/11 的驱动器测试统一 import；改动此处需跑全部 goal-driver* 测试回归。
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NodeDriver, DriverDeps, GoalRuntimeClient } from '../../../src/core/goal/driver';
import { ensureGoalState, loadGoalState, writeGoalState } from '../../../src/core/goal/state-v3';

export interface Harness {
  mafwDir: string;
  driver: NodeDriver;
  deps: DriverDeps;
  calls: any[];        // client/onSessionCreated/archiveGoal 调用记录
  events: any[];       // goal_node 事件
  ledgerEvents: any[]; // QuestionLedger 事件
  nodeRuns: any[];     // node_runs 行（内存实现）
  charter(goalId: string): void;                     // 写最小 charter
  startAndIdle(goalId: string): Promise<string>;     // advance → 返回 sessionId（触发前）
  fireIdle(sessionId?: string): Promise<void>;       // 触发 idle + 等 microtask
  load(goalId: string): any;                         // loadGoalState 快捷
  write(goalId: string, patch: any): void;           // writeGoalState 快捷
}

export function makeHarness(opts?: { nodeTimeoutMs?: number; maxAttempts?: number; promptAsyncThrows?: boolean }): Harness {
  const mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-driver-'));
  for (const d of ['goals', 'requests', 'receipts', 'reviews']) {
    fs.mkdirSync(path.join(mafwDir, d), { recursive: true });
  }
  const calls: any[] = []; const events: any[] = []; const ledgerEvents: any[] = [];
  const nodeRuns: any[] = []; let seq = 1;
  let currentSession: string | null = null;
  const client: GoalRuntimeClient = {
    create: async () => { const id = `ses_${seq++}`; currentSession = id; calls.push({ op: 'create', id }); return { id }; },
    promptAsync: async (o: any) => {
      if (opts?.promptAsyncThrows) throw new Error('boom');
      calls.push({ op: 'promptAsync', ...o });
    },
    delete: async (sid: string) => { calls.push({ op: 'delete', sid }); },
    abort: async (sid: string) => { calls.push({ op: 'abort', sid }); },
  };
  const deps: DriverDeps = {
    client,
    db: {
      insertNodeRun: (i: any) => { const id = seq++; nodeRuns.push({ id, status: 'running', ...i }); return id; },
      finishNodeRun: (id: number, p: any) => { Object.assign(nodeRuns.find((r) => r.id === id)!, p); },
      listNodeRuns: (g: string) => nodeRuns.filter((r) => r.goalId === g),
      latestNodeAttempt: (g: string, l: number, n: string) =>
        [...nodeRuns].reverse().find((r) => r.goalId === g && r.loop === l && r.node === n) ?? null,
    },
    ledger: {
      appendQuestionEvent: (e: any) => ledgerEvents.push(e),
      getQuestionState: (qid: string) => (qid.endsWith('_ok') ? 'pending' : null),
    },
    emitNodeEvent: (p: any) => events.push(p),
    emitPhaseTransition: (p: any) => events.push(p),
    onSessionCreated: (i: any) => calls.push({ op: 'onSessionCreated', ...i }),
    archiveGoal: async (goalId: string, o: any) => { calls.push({ op: 'archiveGoal', goalId, ...o }); },
    nodeTimeoutMs: opts?.nodeTimeoutMs ?? 30 * 60_000,
    maxAttempts: opts?.maxAttempts ?? 2,
  };
  const driver = new NodeDriver(deps);
  return {
    mafwDir, driver, deps, calls, events, ledgerEvents, nodeRuns,
    charter: (goalId) => fs.writeFileSync(path.join(mafwDir, 'goals', `${goalId}.md`), '# charter', 'utf-8'),
    async startAndIdle(goalId) {
      await driver.advance(goalId);
      const sid = loadGoalState(mafwDir, goalId)!.nodeSession!.id;
      return sid;
    },
    async fireIdle(sid?: string) {
      driver.onSessionIdle(sid ?? currentSession!);
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r)); // advance 链异步展开
    },
    load: (goalId) => loadGoalState(mafwDir, goalId),
    write: (goalId, patch) => writeGoalState(mafwDir, goalId, patch),
    ...({ ensure: ensureGoalState } as any),
  } as Harness;
}

/** 便捷：建 goal + charter + 注册目录。 */
export function seedGoal(h: Harness, goalId: string, init?: { maxRounds?: number; patch?: any }) {
  (h as any).ensure(h.mafwDir, goalId, { projectDir: 'C:/p', maxRounds: init?.maxRounds ?? 3 });
  h.driver.registerGoalDir(goalId, h.mafwDir);
  h.charter(goalId);
  if (init?.patch) h.write(goalId, init.patch);
}
```

- [ ] **Step 2: 写失败测试**

```typescript
// gateway/tests/unit/goal-driver.test.ts
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

describe('NodeDriver advance（启动侧）', () => {
  it('fresh goal → 启动 plan：建会话/绑身份/发 prompt/写 state/注册监听/INSERT node_run', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    await h.driver.advance('g1');

    const pa = h.calls.find((c) => c.op === 'promptAsync');
    expect(pa.agent).toBe('mafw-plan');            // 身份绑定
    expect(pa.parts[0].text).toContain('waves.json');
    expect(pa.parts[0].text).not.toContain('/skill');
    const st = h.load('g1')!;
    expect(st.nodeSession).not.toBeNull();
    expect(st.nodeSession!.phase).toBe('plan');
    expect(st.phase).toBe('PLANNING');
    expect(h.nodeRuns).toHaveLength(1);
    expect(h.nodeRuns[0].node).toBe('plan');
    expect(h.nodeRuns[0].status).toBe('running');
    expect(h.events[0]).toMatchObject({ type: 'goal_node', node: 'plan', transition: 'started', goalId: 'g1' });
  });

  it('幂等：nodeSession 在飞时 advance 短路（不重复建会话）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1');
    await h.driver.advance('g1');
    await h.driver.advance('g1');
    expect(h.calls.filter((c) => c.op === 'create')).toHaveLength(1);
  });

  it('终态 goal：advance 空转', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextAction: 'COMPLETED', phase: 'ARCHIVED' } });
    await h.driver.advance('g1');
    expect(h.calls).toHaveLength(0);
  });

  it('promptAsync 抛错 → failNode：lastError + archive_fail', async () => {
    const h = makeHarness({ promptAsyncThrows: true });
    seedGoal(h, 'g1');
    await h.driver.advance('g1');
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.lastError).toContain('boom');
    expect(st.nextAction).toBe('FAILED');
    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'FAIL' });
  });

  it('nextNode=execute 时直接启动 execute（绑 mafw-execute）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute', wavePlanPath: 'x' } });
    await h.driver.advance('g1');
    expect(h.calls.find((c: any) => c.op === 'promptAsync').agent).toBe('mafw-execute');
    expect(h.load('g1')!.phase).toBe('EXECUTING');
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-driver.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 4: 实现 driver.ts（启动侧完整 + 完成侧/应答/恢复留 stub）**

```typescript
// gateway/src/core/goal/driver.ts
// NodeDriver —— goal 编排状态机（spec §3）。
// 驱动：state 文件（真相源）+ per-session 事件监听（idle/error 双门完成判定）。
// langgraph 三件套（graph/checkpointer/interrupt）退役；路由用 routing.ts 纯函数。
import * as fs from 'fs';
import * as path from 'path';
import {
  GoalStateV3, loadGoalState, writeGoalState, isTerminalState, effectiveRound,
} from './state-v3';
import { routeNext, GoalNodeName } from './routing';
import { renderNodePrompt, nodeArtifactPaths } from './node-prompts';
import { parseReviewVerdict } from '../langgraph/review-parser';
import { matchesSignature } from '../langgraph/signature-detector';

export interface GoalRuntimeClient {
  create(directory: string): Promise<{ id: string }>;
  promptAsync(opts: {
    sessionID: string;
    parts: Array<{ type: string; text: string }>;
    agent?: string;
  }): Promise<void>;
  delete(sessionID: string): Promise<void>;
  abort?(sessionID: string): Promise<void>;
}

export interface DriverDeps {
  client: GoalRuntimeClient;
  db: {
    insertNodeRun(i: { goalId: string; projectId: string; loop: number; node: string; attempt: number; sessionId: string | null; startedAt: string }): number;
    finishNodeRun(id: number, p: { status: string; finishedAt: string; outcome?: string | null; error?: string | null; tokensInput?: number | null; tokensOutput?: number | null; costUsd?: number | null }): void;
    listNodeRuns(goalId: string): any[];
    latestNodeAttempt(goalId: string, loop: number, node: string): any | null;
  };
  ledger: {
    appendQuestionEvent(e: any): void;
    getQuestionState(questionId: string): string | null;
  };
  emitNodeEvent(p: Record<string, unknown>): void;
  emitPhaseTransition(p: { type: 'phase_transition'; goalId: string; phase: string; loop: number; projectDir: string }): void;
  onSessionCreated(info: { goalId: string; sessionId: string; phase: string; loop: number }): void;
  archiveGoal(goalId: string, opts: { verdict: string; rounds: number; lastError?: string | null; reviewFeedback?: string }): Promise<void>;
  nodeTimeoutMs: number;
  maxAttempts: number;
}

const NODE_PHASE: Record<'plan' | 'execute' | 'review', { running: string; complete: string }> = {
  plan: { running: 'PLANNING', complete: 'PLANNING_COMPLETE' },
  execute: { running: 'EXECUTING', complete: 'EXECUTING_COMPLETE' },
  review: { running: 'REVIEWING', complete: 'REVIEWING_COMPLETE' },
};

export class NodeDriver {
  private mutex = new Map<string, Promise<void>>();
  private listeners = new Map<string, (ev: 'idle' | 'error', errorMsg?: string) => void>();
  private stateDirs = new Map<string, string>(); // goalId → mafwDir

  constructor(private deps: DriverDeps) {}

  /** index.ts 启动/starter 调用：登记 goal 的状态目录。 */
  registerGoalDir(goalId: string, mafwDir: string): void {
    this.stateDirs.set(goalId, mafwDir);
  }

  /** handleOpencodeEvent 分发入口（idle）。 */
  onSessionIdle(sessionID: string): void {
    const h = this.listeners.get(sessionID);
    if (h) { this.listeners.delete(sessionID); h('idle'); }
  }

  /** handleOpencodeEvent 分发入口（error）。 */
  onSessionError(sessionID: string, errorMsg: string): void {
    const h = this.listeners.get(sessionID);
    if (h) { this.listeners.delete(sessionID); h('error', errorMsg); }
  }

  /** 推进 goal（幂等、互斥）。所有入口（starter/完成回调/应答/恢复/watchdog）都走这里。 */
  async advance(goalId: string): Promise<void> {
    const prev = this.mutex.get(goalId) ?? Promise.resolve();
    const next = prev.then(() => this.advanceInner(goalId)).catch((err) => {
      // 驱动器异常绝不外抛（spec §7）；落 lastError
      try {
        const mafwDir = this.stateDirs.get(goalId);
        if (mafwDir) writeGoalState(mafwDir, goalId, { lastError: `driver: ${err?.message ?? err}` });
      } catch { /* last-resort */ }
    });
    this.mutex.set(goalId, next);
    try { await next; } finally { if (this.mutex.get(goalId) === next) this.mutex.delete(goalId); }
  }

  private findState(goalId: string): { mafwDir: string; state: GoalStateV3 } | null {
    const mafwDir = this.stateDirs.get(goalId);
    if (!mafwDir) return null;
    const s = loadGoalState(mafwDir, goalId);
    return s ? { mafwDir, state: s } : null;
  }

  private async advanceInner(goalId: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    if (isTerminalState(state)) return;
    if (state.nodeSession) return; // 节点在飞——完成回调会再次 advance

    const node = state.nextNode as GoalNodeName;
    if (node === 'plan' || node === 'execute' || node === 'review') {
      await this.executeNode(goalId, mafwDir, node);
    } else if (node === 'askUser') {
      this.executeAskUser(goalId, mafwDir);
    } else {
      await this.executeArchive(goalId, mafwDir, node);
    }
  }

  private async executeNode(goalId: string, mafwDir: string, node: 'plan' | 'execute' | 'review'): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const phaseNames = NODE_PHASE[node];

    // phase 广播（payload 形状与旧 syncToFile 一致——milestone-push 零迁移）
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: phaseNames.running, loop: round, projectDir: state.projectDir });

    // attempt 语义：上一行 failed/timeout/aborted → attempt+1（重试历史在 node_runs）
    const prevRun = this.deps.db.latestNodeAttempt(goalId, round, node);
    const attempt = prevRun && ['failed', 'timeout', 'aborted'].includes(prevRun.status)
      ? prevRun.attempt + 1 : 1;

    const session = await this.deps.client.create(state.projectDir);
    const sessionId = session.id;
    this.deps.onSessionCreated({ goalId, sessionId, phase: node, loop: round });

    const runId = this.deps.db.insertNodeRun({
      goalId, projectId: state.projectDir, loop: round, node, attempt, sessionId,
      startedAt: new Date().toISOString(),
    });

    const prompt = renderNodePrompt(node, {
      goalId, projectDir: state.projectDir, mafwDir, round, maxRounds: state.maxRounds,
      charterPath: path.join(mafwDir, 'goals', `${goalId}.md`),
      requestPath: path.join(mafwDir, 'requests', `${goalId}.json`),
      reviewFeedback: state.reviewFeedback || undefined,
    });

    // 不 await——pi 的 promptAsync 在 idle 会话阻塞到回合结束，await 会卡死 advance（spec §7）
    void this.deps.client.promptAsync({
      sessionID: sessionId, parts: [{ type: 'text', text: prompt }], agent: `mafw-${node}`,
    }).catch((err: any) => {
      this.onSessionError(sessionId, `promptAsync: ${err?.message ?? err}`);
    });

    writeGoalState(mafwDir, goalId, {
      phase: phaseNames.running, nextAction: `RUNNING_${node}`,
      nodeSession: { id: sessionId, phase: node, startedAt: new Date().toISOString(), attempt, runId },
    });

    this.listeners.set(sessionId, (ev, errorMsg) => {
      if (ev === 'idle') void this.completeNode(goalId, sessionId);
      else void this.failNode(goalId, sessionId, 'session_error', errorMsg ?? 'session error');
    });

    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node,
      transition: 'started', at: new Date().toISOString(), attempt,
    });
  }

  private executeAskUser(goalId: string, mafwDir: string): void {
    const state = loadGoalState(mafwDir, goalId)!;
    if (!state.pendingQuestion) { // 数据异常 → 回 plan
      writeGoalState(mafwDir, goalId, { nextNode: 'plan' });
      void this.advance(goalId);
      return;
    }
    const q = state.pendingQuestion;
    // asked 落地——现状断链根因（asked 事件无写入点 → respond 恒 404）
    this.deps.ledger.appendQuestionEvent({
      type: 'asked', questionId: q.questionId, goalId, node: q.node, loop: q.loop,
      questions: q.questions, askedAt: q.askedAt,
    });
    this.deps.emitPhaseTransition({
      type: 'phase_transition', goalId, phase: 'ASKING_USER', loop: effectiveRound(state), projectDir: state.projectDir,
    });
    writeGoalState(mafwDir, goalId, { phase: 'ASKING_USER', nextAction: 'WAIT_USER_ANSWER' });
  }

  private async executeArchive(goalId: string, mafwDir: string, node: GoalNodeName): Promise<void> {
    const state = loadGoalState(mafwDir, goalId)!;
    const round = effectiveRound(state);
    const v = node === 'archive_success'
      ? { verdict: 'PASS', phase: 'ARCHIVED', nextAction: 'COMPLETED' }
      : node === 'archive_max_retries'
        ? { verdict: 'MAX_RETRIES', phase: 'FAILED', nextAction: 'FAILED' }
        : { verdict: 'FAIL', phase: 'FAILED', nextAction: 'FAILED' };
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: v.phase, loop: round, projectDir: state.projectDir });
    writeGoalState(mafwDir, goalId, { phase: v.phase, nextAction: v.nextAction, nodeSession: null });
    await this.deps.archiveGoal(goalId, {
      verdict: v.verdict, rounds: round,
      lastError: state.lastError, reviewFeedback: state.reviewFeedback,
    });
  }

  /** 节点失败（error/timeout/artifact 缺失或非法）。 */
  private async failNode(goalId: string, sessionID: string, kind: string, message: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (ns && ns.id === sessionID) {
      this.deps.db.finishNodeRun(ns.runId, {
        status: kind === 'timeout' ? 'timeout' : 'failed',
        finishedAt: new Date().toISOString(), error: message,
      });
      this.deps.emitNodeEvent({
        type: 'goal_node', goalId, projectDir: state.projectDir, loop: effectiveRound(state),
        node: ns.phase, transition: kind === 'timeout' ? 'timeout' : 'failed',
        at: new Date().toISOString(), error: message, attempt: ns.attempt,
      });
    }
    try { await this.deps.client.delete(sessionID); } catch { /* fail-open */ }
    writeGoalState(mafwDir, goalId, {
      nodeSession: null, lastError: `${kind}: ${message}`, reviewVerdict: 'ERROR',
      nextNode: 'archive_fail',
    });
    await this.advance(goalId);
  }

  /** 节点完成（idle + 产物双门）——Task 7 实现。 */
  private async completeNode(goalId: string, sessionID: string): Promise<void> {
    void goalId; void sessionID;
  }

  /** askUser 应答——Task 8 实现。 */
  handleAnswer(_goalId: string, _questionId: string, _answer: string): boolean { return false; }

  /** askUser 取消——Task 8 实现。 */
  handleCancel(_goalId: string, _questionId: string): boolean { return false; }

  /** 崩溃恢复/watchdog 共用——Task 11 实现。 */
  async examineStaleNode(_goalId: string, _opts?: { probeSession?: (sessionID: string) => Promise<'alive' | 'dead'> }): Promise<void> {}

  /** 节点重跑——Task 12 实现。 */
  async retryNodeRun(_goalId: string, _runId: number): Promise<{ runId: number }> { throw new Error('not implemented'); }
}
```

- [ ] **Step 5: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-driver.test.ts --runInBand`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/tests/unit/helpers/goal-driver-harness.ts gateway/tests/unit/goal-driver.test.ts
git commit -m "feat(goal): NodeDriver core — advance/startNode/listeners, event-driven reentry"
```

---

### Task 7: 节点完成处理（completeNode：产物双门 + 路由推进）

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`（实现 `completeNode`，替换 Task 6 stub）
- Test: `gateway/tests/unit/goal-driver-completion.test.ts`（用 Task 6 harness）

**Interfaces:**
- Consumes: Task 6 NodeDriver + harness；`parseReviewVerdict`（`core/langgraph/review-parser.ts`）、`matchesSignature`（`core/langgraph/signature-detector.ts`）——既有模块原样 import
- Produces: `completeNode` 完整语义：plan need_clarification / execute receipt / review verdict+round+1+sameSig（移植 plan.node.ts:55-68 与 review.node.ts:48-74）；推进链 `writeGoalState(nextNode) → advance`——Task 8/9/11 依赖

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-driver-completion.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

describe('completeNode 产物双门', () => {
  it('plan 完成 + waves ready → nextNode=execute；node_run succeeded', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', title: 't', tasks: [] }], status: 'ready' }), 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.nextNode).toBe('execute');
    expect(st.phase).toBe('PLANNING_COMPLETE');
    expect(h.nodeRuns[0].status).toBe('succeeded');
  });

  it('plan need_clarification → pendingQuestion + askUser 执行 + ledger asked', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ status: 'need_clarification', ambiguities: ['A?'] }), 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.pendingQuestion).toMatchObject({ node: 'plan', questions: ['A?'] });
    expect(h.ledgerEvents.some((e) => e.type === 'asked')).toBe(true);
    expect(st.phase).toBe('ASKING_USER');
  });

  it('idle 但产物缺失 → artifact_missing → archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    await h.fireIdle(sid); // 不写 waves.json
    const st = h.load('g9')!;
    expect(st.lastError).toContain('artifact_missing');
    expect(h.nodeRuns[0].status).toBe('failed');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'FAIL' });
  });

  it('产物非法 JSON → artifact_invalid', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    const sid = await h.startAndIdle('g9');
    fs.writeFileSync(path.join(h.mafwDir, 'waves.json'), '{broken', 'utf-8');
    await h.fireIdle(sid);
    expect(h.load('g9')!.lastError).toContain('artifact_invalid');
  });

  it('review PASS → round+1 → archive_success（verdict 优先于 maxRounds）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const a = nodeArtifactPaths(h.mafwDir, 'g9', 1);
    fs.writeFileSync(a.review, '# r\n\n```mafw-review\n{"verdict":"PASS","feedback":"ok"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.round).toBe(2);
    expect(st.nextAction).toBe('COMPLETED');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS' });
  });

  it('review FAIL round<max → nextNode=plan（下一轮）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 1, wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const r = path.join(h.mafwDir, 'reviews', 'g9-loop1.md');
    fs.writeFileSync(r, '```mafw-review\n{"verdict":"FAIL","feedback":"fix tests"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    const st = h.load('g9')!;
    expect(st.round).toBe(2);
    expect(st.nextNode).toBe('plan');
  });

  it('review FAIL round+1>=maxRounds → archive_max_retries', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9', { patch: { nextNode: 'review', round: 2, wavePlanPath: 'x' } });
    const sid = await h.startAndIdle('g9');
    const r = path.join(h.mafwDir, 'reviews', 'g9-loop2.md');
    fs.writeFileSync(r, '```mafw-review\n{"verdict":"FAIL","feedback":"still broken"}\n```\n', 'utf-8');
    await h.fireIdle(sid);
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'MAX_RETRIES' });
  });

  it('stale idle（非当前 nodeSession）被忽略', async () => {
    const h = makeHarness();
    seedGoal(h, 'g9');
    await h.driver.advance('g9');
    h.driver.onSessionIdle('ses_stale_999');
    await new Promise((r) => setImmediate(r));
    expect(h.load('g9')!.nodeSession).not.toBeNull(); // 未被误伤
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-driver-completion.test.ts --runInBand`
Expected: FAIL — completeNode 是空实现，state 不推进

- [ ] **Step 3: 实现（替换 Task 6 的 stub）**

```typescript
  private async completeNode(goalId: string, sessionID: string): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId)!;
    const ns = state.nodeSession;
    if (!ns || ns.id !== sessionID) return; // stale 事件守卫

    const node = ns.phase;
    const round = effectiveRound(state);
    const a = nodeArtifactPaths(mafwDir, goalId, round);

    // —— 双门之二：产物校验 ——
    const artifactPath = node === 'plan' ? a.waves : node === 'execute' ? a.receipt : a.review;
    if (!fs.existsSync(artifactPath)) {
      await this.failNode(goalId, sessionID, 'artifact_missing', `expected ${artifactPath}`);
      return;
    }

    // —— 解析（移植 NODE_CONFIGS.parseResult + plan.node/review.node 语义）——
    let patch: Partial<GoalStateV3>;
    let outcome: string;
    try {
      if (node === 'plan') {
        const waves = JSON.parse(fs.readFileSync(a.waves, 'utf-8'));
        if (waves.status === 'need_clarification') {
          patch = {
            pendingQuestion: {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'plan', loop: round, questions: waves.ambiguities || [], askedAt: new Date().toISOString(),
            },
          };
          outcome = 'need_clarification';
        } else {
          patch = { wavePlanPath: a.waves, pendingQuestion: null };
          outcome = `waves=${(waves.waves || []).length}`;
        }
      } else if (node === 'execute') {
        const receipt = JSON.parse(fs.readFileSync(a.receipt, 'utf-8'));
        patch = { receiptPath: a.receipt };
        outcome = `receipts=${(receipt.receipts || []).length}`;
      } else {
        const content = fs.readFileSync(a.review, 'utf-8');
        const verdict = parseReviewVerdict(content); // 既有共享模块
        const p: Partial<GoalStateV3> = {
          reviewVerdict: verdict.verdict,
          reviewReportPath: a.review,
          reviewFeedback: verdict.feedback,
          round: round + 1,
        };
        // same-signature 追问（移植 review.node.ts:56-74，上限 3）
        if (verdict.verdict === 'FAIL' && round < state.maxRounds) {
          const sameSig = state.reviewFeedback && matchesSignature(state.reviewFeedback, verdict.feedback);
          const newSameSigCount = sameSig ? state.sameSigCount + 1 : 1;
          p.sameSigCount = newSameSigCount;
          if (sameSig && newSameSigCount >= 2 && newSameSigCount <= 3) {
            p.pendingQuestion = {
              questionId: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_ok`,
              node: 'review', loop: round,
              questions: [`Review keeps failing with same issue: ${verdict.feedback}. Continue retrying?`],
              askedAt: new Date().toISOString(),
            };
          }
        } else {
          p.sameSigCount = 0;
        }
        patch = p;
        outcome = verdict.verdict;
      }
    } catch (err: any) {
      await this.failNode(goalId, sessionID, 'artifact_invalid', `${artifactPath}: ${err.message}`);
      return;
    }

    try { await this.deps.client.delete(sessionID); } catch { /* fail-open */ }

    const phaseNames = NODE_PHASE[node];
    const nextRound = patch.round ?? round;
    const nextNode = routeNext(
      node === 'plan' ? 'after_plan' : node === 'execute' ? 'after_execute' : 'after_review',
      {
        lastError: state.lastError,
        reviewVerdict: (patch.reviewVerdict ?? state.reviewVerdict) as any,
        round: nextRound,
        maxRounds: state.maxRounds,
        pendingQuestion: patch.pendingQuestion ?? null,
      },
    );

    this.deps.db.finishNodeRun(ns.runId, {
      status: 'succeeded', finishedAt: new Date().toISOString(), outcome,
    });
    this.deps.emitPhaseTransition({ type: 'phase_transition', goalId, phase: phaseNames.complete, loop: nextRound, projectDir: state.projectDir });
    this.deps.emitNodeEvent({
      type: 'goal_node', goalId, projectDir: state.projectDir, loop: round, node,
      transition: 'finished', at: new Date().toISOString(), outcome, attempt: ns.attempt,
    });

    writeGoalState(mafwDir, goalId, {
      ...patch, nodeSession: null, phase: phaseNames.complete, nextNode, nextAction: `NEXT_${nextNode}`,
    }, { bumpVersion: node === 'review' });
    await this.advance(goalId);
  }
```

> 注：`questionId` 带 `_ok` 后缀是 harness 的 `getQuestionState` 惯例（qid.endsWith('_ok') → pending），让 Task 8 的应答测试可复用；生产无影响（id 只要不重复）。

- [ ] **Step 4: 跑测试通过（含 Task 6 回归）**

Run: `cd gateway && npx jest tests/unit/goal-driver --runInBand`
Expected: PASS（driver + completion 两文件）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/tests/unit/goal-driver-completion.test.ts
git commit -m "feat(goal): node completion — artifact double-gate, verdict routing, same-sig questions"
```

---

### Task 8: askUser 应答链路（handleAnswer / handleCancel）

**Files:**
- Modify: `gateway/src/core/goal/driver.ts`（替换两个 stub）
- Test: `gateway/tests/unit/goal-askuser.test.ts`（用 Task 6 harness）

**Interfaces:**
- Consumes: Task 6/7 NodeDriver + harness
- Produces: `handleAnswer(goalId, questionId, answer): boolean`（应答 → userResponse 落 state → 回 plan → advance）、`handleCancel(goalId, questionId): boolean`（取消 → archive_fail）——Task 9 的 respond 路由消费

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-askuser.test.ts
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';

describe('askUser 应答链路', () => {
  it('askUser 节点执行时写 ledger asked（断链修复）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    await h.driver.advance('g1');
    expect(h.ledgerEvents).toEqual([
      expect.objectContaining({ type: 'asked', questionId: 'q_1_ok', goalId: 'g1' }),
    ]);
    expect(h.load('g1')!.nextAction).toBe('WAIT_USER_ANSWER');
  });

  it('handleAnswer：答对 → userResponse 落 state、pendingQuestion 清空、回 plan 并启动', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser', phase: 'ASKING_USER',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleAnswer('g1', 'q_1_ok', '用方案B')).toBe(true);
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.userResponse).toMatchObject({ questionId: 'q_1_ok', answer: '用方案B' });
    expect(st.pendingQuestion).toBeNull();
    expect(h.ledgerEvents.some((e) => e.type === 'answered')).toBe(true);
    expect(st.nodeSession?.phase).toBe('plan'); // 回 plan 且已启动
  });

  it('handleAnswer：questionId 不匹配 → false 不动 state', () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'plan', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleAnswer('g1', 'q_other', 'x')).toBe(false);
    expect(h.load('g1')!.pendingQuestion).not.toBeNull();
  });

  it('handleCancel → lastError + archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'askUser',
      pendingQuestion: { questionId: 'q_1_ok', node: 'review', loop: 1, questions: ['A?'], askedAt: 't' },
    } });
    expect(h.driver.handleCancel('g1', 'q_1_ok')).toBe(true);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const st = h.load('g1')!;
    expect(st.lastError).toContain('cancelled');
    expect(st.nextAction).toBe('FAILED');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-askuser.test.ts --runInBand`
Expected: FAIL — `handleAnswer` stub 恒 false

- [ ] **Step 3: 实现（替换 stub）**

```typescript
  /** 应答 askUser（respond 路由 / mafw_answer_question → HTTP → index.ts 调入）。 */
  handleAnswer(goalId: string, questionId: string, answer: string): boolean {
    const found = this.findState(goalId);
    if (!found) return false;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || !state.pendingQuestion || state.pendingQuestion.questionId !== questionId) return false;
    this.deps.ledger.appendQuestionEvent({
      type: 'answered', questionId, goalId, answer, answeredAt: new Date().toISOString(),
    });
    writeGoalState(mafwDir, goalId, {
      pendingQuestion: null,
      userResponse: { questionId, answer, respondedAt: new Date().toISOString() },
      nextNode: 'plan',
    });
    void this.advance(goalId);
    return true;
  }

  /** 取消 askUser → 用户拒答，goal 无法继续 → archive_fail。 */
  handleCancel(goalId: string, questionId: string): boolean {
    const found = this.findState(goalId);
    if (!found) return false;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || !state.pendingQuestion || state.pendingQuestion.questionId !== questionId) return false;
    this.deps.ledger.appendQuestionEvent({
      type: 'cancelled', questionId, goalId, cancelledAt: new Date().toISOString(),
    });
    writeGoalState(mafwDir, goalId, {
      pendingQuestion: null, lastError: `askUser cancelled by user (question ${questionId})`,
      nextNode: 'archive_fail',
    });
    void this.advance(goalId);
    return true;
  }
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-askuser.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/driver.ts gateway/tests/unit/goal-askuser.test.ts
git commit -m "feat(goal): askUser answer/cancel — state-driven resume, ledger asked landed"
```

---

### Task 9: index.ts 接线 + starter（替换 langgraph invoke 路径）

**Files:**
- Create: `gateway/src/core/goal/starter.ts`
- Modify: `gateway/src/index.ts`（锚点见 Step 3）
- Test: `gateway/tests/unit/goal-starter.test.ts`

**Interfaces:**
- Consumes: Task 6/7/8 NodeDriver 全部；`QuestionLedger`（已有）；`mergeBudgetIntoSnapshot`/`getActivePolicy`（已有）；`recordSessionInDb`（已有）
- Produces: `resolveGoalDir(projects, hint?, hasRequest?)` 纯函数；index.ts 侧 `this.goalDriver`、`startGoal(goalId, projectDirHint?)`、事件分发、respond 路由 state 驱动

**关键锚点**（行号为 2026-10-08 现状，编辑时以代码片段为准）：
- `handleOpencodeEvent` eventTaps 块后（~L1008）
- `setupEventBus` goal_created/state_change（~L2626-2633）
- respond 路由 langgraph 段（~L4002-4012）
- `handleValidate`/`handleComplete`（~L6260-6309）
- `buildNodeOptions`/`createInProcessClient`/`onGoalCreated`/`onEvent`/`syncFromCheckpoint`/`resumeStaleThreads`（~L6387-6587）

- [ ] **Step 1: 写失败测试（starter 纯函数）**

```typescript
// gateway/tests/unit/goal-starter.test.ts
import { resolveGoalDir } from '../../src/core/goal/starter';

describe('resolveGoalDir', () => {
  it('优先 hint 且已注册', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }, { projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' }],
      'C:/b',
    )).toEqual({ projectDir: 'C:/b', mafwDir: 'C:/b/.mafw' });
  });
  it('hint 未注册 → 回退扫 request 文件所在项目', () => {
    expect(resolveGoalDir(
      [{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }],
      'C:/unregistered',
      (mafwDir) => mafwDir === 'C:/a/.mafw',
    )).toEqual({ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' });
  });
  it('无 hint 无 request → 首个项目；空列表 → null', () => {
    expect(resolveGoalDir([{ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' }])).toEqual({ projectDir: 'C:/a', mafwDir: 'C:/a/.mafw' });
    expect(resolveGoalDir([], 'x')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-starter.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 starter + index.ts 接线（逐锚点编辑）**

新建 `gateway/src/core/goal/starter.ts`：

```typescript
// gateway/src/core/goal/starter.ts
// starter 目录解析——goal_created 后定位目标项目（spec §4）。
export interface ProjectEntry { projectDir: string; mafwDir: string }

export function resolveGoalDir(
  projects: ProjectEntry[],
  hintProjectDir?: string,
  hasRequest?: (mafwDir: string) => boolean,
): ProjectEntry | null {
  if (hintProjectDir) {
    const hit = projects.find((p) => p.projectDir === hintProjectDir);
    if (hit) return hit;
  }
  if (hasRequest) {
    const byRequest = projects.find((p) => hasRequest(p.mafwDir));
    if (byRequest) return byRequest;
  }
  return projects[0] ?? null;
}
```

index.ts 编辑（按锚点顺序）：

**① import 区**（goal 模块引入，删除 langgraph 相关 import：`buildExecutionGraph`、`FileCheckpointer`、`planNode`、`executeNode`、`reviewNode`、`syncToDashboard`——若无其他引用）：

```typescript
import { NodeDriver } from './core/goal/driver';
import { ensureGoalState, loadGoalState } from './core/goal/state-v3';
import { resolveGoalDir } from './core/goal/starter';
```

**② 类字段**（`identityRegistry` 字段附近）：

```typescript
  private goalDriver: NodeDriver | null = null;
  private goalDriverMafwDirCache = new Map<string, string>();
```

**③ `start()` 中 `materializeIdentities()` 之后**初始化驱动器：

```typescript
    this.goalDriver = new NodeDriver({
      client: {
        create: (directory: string) => this.sdkSession.create(directory),
        promptAsync: (opts) => this.sdkSession.promptAsync(opts as any) as unknown as Promise<void>,
        delete: (sessionID: string) => this.sdkSession.delete(sessionID),
        abort: async (sessionID: string) => { await this.runtime!.session.abort({ sessionID }); },
      },
      db: {
        insertNodeRun: (i) => this.getGatewayDb().insertNodeRun(i),
        finishNodeRun: (id, p) => this.getGatewayDb().finishNodeRun(id, p),
        listNodeRuns: (g) => this.getGatewayDb().listNodeRuns(g),
        latestNodeAttempt: (g, l, n) => this.getGatewayDb().latestNodeAttempt(g, l, n),
      },
      ledger: new QuestionLedger(config.resolvePath()),
      emitNodeEvent: (p) => this.broadcast(p), // 扁平顶层广播（wire 契约 §5.6）
      emitPhaseTransition: (p) => eventBus.emit('phase_transition', p),
      onSessionCreated: (info) => {
        recordSessionInDb(this.getGatewayDb(), info);
        const mafwDir = this.goalDriverMafwDirCache.get(info.goalId);
        if (mafwDir) this.attachBudgetGuardForGoal(info.goalId, info.sessionId, mafwDir);
      },
      archiveGoal: (goalId, opts) => this.archiveGoal(goalId, opts),
      nodeTimeoutMs: (config as any).goal?.nodeTimeoutMs ?? 30 * 60_000,
      maxAttempts: 2,
    });
```

**④ starter 私有方法**（放 handleValidate 附近）：

```typescript
  private async startGoal(goalId: string, projectDirHint?: string): Promise<void> {
    const projects = Array.from(this.registeredProjects.entries())
      .map(([projectDir, info]) => ({ projectDir, mafwDir: info.mafwDir }));
    const found = resolveGoalDir(projects, projectDirHint, (mafwDir) =>
      fs.existsSync(path.join(mafwDir, 'requests', `${goalId}.json`)));
    if (!found) { log.warn(`[Goal] ${goalId}: no project dir resolved — skipping`); return; }
    this.goalDriverMafwDirCache.set(goalId, found.mafwDir);
    this.goalDriver?.registerGoalDir(goalId, found.mafwDir);
    ensureGoalState(found.mafwDir, goalId, {
      projectDir: found.projectDir,
      maxRounds: config.loop.maxRounds,
      policySnapshot: mergeBudgetIntoSnapshot(
        (() => { try { return getActivePolicy(config.resolvePath()); } catch { return { version: 'builtin-v1', proposalId: null }; } })(),
        path.join(found.mafwDir, 'requests', `${goalId}.json`),
      ),
    });
    this.activeGoals.set(goalId, loadGoalState(found.mafwDir, goalId) as any);
    await this.goalDriver?.advance(goalId);
  }
```

**⑤ `setupEventBus` goal_created/state_change 替换**：

```typescript
    eventBus.on("goal_created", (data: any) => {
      this.broadcast({ type: "goal_created", ...data });
      if (data.goalId) setImmediate(() => this.startGoal(data.goalId, data.projectDir));
    });
    eventBus.on("state_change", (data: any) => {
      this.broadcast({ type: "state_change", ...data });
      // legacy /goal skill 链唤醒——driver.advance 幂等（在飞即短路）
      if (data.goalId) setImmediate(() => this.goalDriver?.advance(data.goalId));
    });
```

**⑥ `handleOpencodeEvent` eventTaps 块之后**（~L1008 后、approval policy 之前）：

```typescript
    // Goal node listeners: NodeDriver 完成/失败双门的事件侧（spec §3）。
    if (sessionID) {
      if (type === 'session.idle' || f.broadcast === 'idle') this.goalDriver?.onSessionIdle(sessionID);
      if (f.broadcast === 'error' || type === 'session.error') {
        this.goalDriver?.onSessionError(sessionID, String(props?.error ?? 'session error'));
      }
    }
```

**⑦ respond 路由**：`ledger.appendQuestionEvent(answered)` 保留，紧随其后的 langgraph `graph.invoke(new Command(...))` 段（~L4003-4012）替换为：

```typescript
          // Resume via NodeDriver（state 驱动——langgraph Command 退役）
          this.goalDriver?.handleAnswer(goalId, questionId, data.answer || '');
```

cancel 分支（~L3988-3995）在 `ledger.appendQuestionEvent(cancelled)` 后补一行：

```typescript
            this.goalDriver?.handleCancel(goalId, questionId);
```

**⑧ `handleValidate` 尾部触发替换**（~L6301）：

```typescript
    setImmediate(() => this.startGoal(goalId, projectDir));
```

**⑨ `handleComplete` 替换**：

```typescript
  private async handleComplete(goalId: string): Promise<any> {
    setImmediate(() => this.goalDriver?.advance(goalId));
    return { success: true, nextAction: 'SCHEDULED' };
  }
```

**⑩ 退役段删除**：`onGoalCreated`（6507-6542）、`onEvent`（6544-6558）、`syncFromCheckpoint`（6560-6569）、`buildNodeOptions`（6419-6488）、`createInProcessClient`（6387-6417）、`resumeStaleThreads`（6571-6587）整体删除（Task 11 会以 recovery 重挂周期扫描调用点；`watchEventsDir` 的 `state_change` → advance 已由 ⑤ 覆盖）。`findGoalStatePath` 保留（Task 11 recovery 复用其扫描模式）。

- [ ] **Step 4: 编译 + 定向回归**

Run: `cd gateway && npx tsc --noEmit && npx jest tests/unit/goal-starter.test.ts tests/unit/goal-snapshot.test.ts tests/unit/goal-sessions-route.test.ts tests/unit/goal-outcomes.test.ts --runInBand`
Expected: 编译零错误；测试 PASS（goal-snapshot 等读方如 fail，按「读 round 回退 loop」修读方——`goal-snapshot.ts:29` 的 `s.round` 改 `s.round ?? s.loop`）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/starter.ts gateway/src/index.ts gateway/tests/unit/goal-starter.test.ts
git commit -m "feat(goal): wire NodeDriver into index.ts — starter, event dispatch, retire langgraph invoke paths"
```

---

### Task 10: projectDir 解析（MCP 创建入口）

**Files:**
- Modify: `gateway/src/mcp/handlers/manager-set-goal.ts`、`gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/index.ts`（MCP services 构造点注入 `listProjects`——`grep -n "mafwDir:" gateway/src/index.ts` 定位）
- Test: `gateway/tests/unit/goal-set-goal-projectdir.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 两 handler 接受可选 `projectDir`（已注册校验，未注册报错并列出可选项），request/charter 写入**目标项目** `.mafw`；`services.listProjects?: () => Array<{projectDir, mafwDir}>`——无 `projectDir` 时维持现状行为（写 `services.mafwDir`），不回归

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-set-goal-projectdir.test.ts
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { handleManagerSetGoal } from '../../src/mcp/handlers/manager-set-goal';

function makeServices() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-setg-'));
  const projectA = path.join(tmp, 'projA');
  fs.mkdirSync(path.join(projectA, '.mafw'), { recursive: true });
  const projects = [{ projectDir: projectA, mafwDir: path.join(projectA, '.mafw') }];
  const svc = {
    mafwDir: path.join(tmp, 'home-mafw'),
    listProjects: () => projects,
  } as any;
  return { tmp, svc, projectA };
}

describe('mafw_set_goal projectDir', () => {
  it('projectDir 已注册 → 写入该项目 .mafw', async () => {
    const { svc, projectA } = makeServices();
    const res = await handleManagerSetGoal(
      { goalId: 'g1', title: 'T', charter: '# c', projectDir: projectA }, svc,
    );
    expect(JSON.parse(res.content![0].text as string).success).toBe(true);
    expect(fs.existsSync(path.join(projectA, '.mafw', 'requests', 'g1.json'))).toBe(true);
  });

  it('projectDir 未注册 → 报错并列出可选项', async () => {
    const { svc, projectA } = makeServices();
    const res = await handleManagerSetGoal(
      { goalId: 'g2', title: 'T', charter: '# c', projectDir: 'C:/nope' }, svc,
    );
    const body = JSON.parse(res.content![0].text as string);
    expect(body.success).toBe(false);
    expect(body.error).toContain('C:/nope');
    expect(body.error).toContain('projA');
  });

  it('无 projectDir → 维持现状（写 services.mafwDir）', async () => {
    const { svc } = makeServices();
    await handleManagerSetGoal({ goalId: 'g3', title: 'T', charter: '# c' }, svc);
    expect(fs.existsSync(path.join(svc.mafwDir, 'requests', 'g3.json'))).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-set-goal-projectdir.test.ts --runInBand`
Expected: FAIL — g1 写到了 home-mafw 而非项目

- [ ] **Step 3: 实现**

`manager-set-goal.ts` 目录解析段（L19-20）替换为：

```typescript
    // projectDir 解析（spec §4）：显式已注册 > 报错列选项 > 旧行为（services.mafwDir）
    const listProjects = (services as any).listProjects as
      (() => Array<{ projectDir: string; mafwDir: string }>) | undefined;
    const requestedProjectDir = args.projectDir as string | undefined;
    let projectDir: string;
    let mafwDir: string;
    if (requestedProjectDir && listProjects) {
      const hit = listProjects().find((p) => p.projectDir === path.resolve(requestedProjectDir));
      if (!hit) {
        const available = listProjects().map((p) => p.projectDir).join(', ');
        return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `projectDir not registered: ${requestedProjectDir}. Available: ${available || '(none)'}` }) }], isError: true };
      }
      projectDir = hit.projectDir;
      mafwDir = hit.mafwDir;
    } else {
      mafwDir = services.mafwDir ?? (process.env.MAFW_PROJECT_DIR ? path.join(process.env.MAFW_PROJECT_DIR, '.mafw') : undefined) ?? path.join(process.cwd(), '.mafw');
      projectDir = path.resolve(mafwDir, '..');
    }
```

`create-goal.ts` 同模式改造（其 `process.env.MAFW_PROJECT_DIR || process.cwd()` 段替换为同上解析，goalId/request 字段写入不变）。

index.ts MCP services 构造点追加：

```typescript
  listProjects: () => Array.from(this.registeredProjects.entries()).map(([projectDir, info]) => ({ projectDir, mafwDir: info.mafwDir })),
```

- [ ] **Step 4: 跑测试通过 + 回归**

Run: `cd gateway && npx jest tests/unit/goal-set-goal-projectdir.test.ts tests/unit/create-goal-budget.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/handlers/manager-set-goal.ts gateway/src/mcp/handlers/create-goal.ts gateway/src/index.ts gateway/tests/unit/goal-set-goal-projectdir.test.ts
git commit -m "feat(goal): projectDir resolution for goal creation MCP handlers"
```

---

### Task 11: 崩溃恢复 + watchdog（core/goal/recovery.ts）

**Files:**
- Create: `gateway/src/core/goal/recovery.ts`
- Modify: `gateway/src/core/goal/driver.ts`（实现 `examineStaleNode`，替换 Task 6 stub）
- Modify: `gateway/src/index.ts`（recoverState 末尾挂 recoverGoals；startBackupPolling 周期回调挂 watchdogScan）
- Test: `gateway/tests/unit/goal-recovery.test.ts`（用 Task 6 harness）

**Interfaces:**
- Consumes: Task 6/7 NodeDriver + harness；`isTerminalState`/`loadGoalState`
- Produces: `recoverGoals({driver, states, probeSession?})`（启动扫描）、`watchdogScan({driver, states, probeSession?, now?, timeoutMs?})`（周期扫描）；`driver.examineStaleNode(goalId, opts?)`——**产物优先 → 会话探测 → abort+重试（≥maxAttempts → archive_fail）**

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-recovery.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { recoverGoals, watchdogScan } from '../../src/core/goal/recovery';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

const settle = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

describe('恢复语义（spec §6：产物优先 → 会话探测 → 重试）', () => {
  it('重启时产物已出现 → 兑现为完成（不浪费已完成工作）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 1, runId: 1 },
    } });
    const a = nodeArtifactPaths(h.mafwDir, 'g1', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');

    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    const st = h.load('g1')!;
    expect(st.nextNode).toBe('execute'); // plan 已兑现并推进
    expect(st.nodeSession).toBeNull();
  });

  it('无产物 + 会话死 → 节点重试（attempt+1，新会话）', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: new Date().toISOString(), attempt: 1, runId: 1 },
    } });
    await recoverGoals({
      driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }],
      probeSession: async () => 'dead',
    });
    await settle();
    const st = h.load('g1')!;
    expect(st.nodeSession).not.toBeNull();
    expect(st.nodeSession!.attempt).toBe(2);
    expect(st.nodeSession!.id).not.toBe('ses_dead');
  });

  it('无产物 + attempt 已达上限 → archive_fail', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 2, runId: 1 },
    } });
    await recoverGoals({
      driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }],
      probeSession: async () => 'dead',
    });
    await settle();
    expect(h.load('g1')!.nextAction).toBe('FAILED');
  });

  it('无 probeSession（能力门降级）→ 视为 dead 重试', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_dead', phase: 'plan', startedAt: 't', attempt: 1, runId: 1 },
    } });
    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('g1')!.nodeSession!.attempt).toBe(2);
  });

  it('watchdog：startedAt 超时 → abort + 重试', async () => {
    const h = makeHarness({ nodeTimeoutMs: 1 });
    seedGoal(h, 'g1', { patch: {
      nextNode: 'plan',
      nodeSession: { id: 'ses_slow', phase: 'plan', startedAt: new Date(Date.now() - 60_000).toISOString(), attempt: 1, runId: 1 },
    } });
    await watchdogScan({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }], now: Date.now(), timeoutMs: 30_000 });
    await settle();
    expect(h.calls.some((c) => c.op === 'abort' && c.sid === 'ses_slow')).toBe(true);
    expect(h.load('g1')!.nodeSession!.attempt).toBe(2);
  });

  it('无 nodeSession 的非终态 → 直接 advance', async () => {
    const h = makeHarness();
    seedGoal(h, 'g1', { patch: { nextNode: 'execute', wavePlanPath: 'x' } });
    await recoverGoals({ driver: h.driver, states: [{ goalId: 'g1', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('g1')!.nodeSession?.phase).toBe('execute');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-recovery.test.ts --runInBand`
Expected: FAIL — `examineStaleNode` 是空 stub

- [ ] **Step 3: 实现**

driver.ts 替换 `examineStaleNode` stub：

```typescript
  /**
   * 崩溃恢复 / watchdog 共用：检查在飞节点的处置（spec §6）。
   * ① 产物优先（gateway 死亡期间完成的节点直接兑现）
   * ② 会话探测（alive 则交还监听/watchdog 兜底；无探测能力视为 dead）
   * ③ abort + 重试 attempt+1（≥maxAttempts → archive_fail）
   */
  async examineStaleNode(
    goalId: string,
    opts?: { probeSession?: (sessionID: string) => Promise<'alive' | 'dead'> },
  ): Promise<void> {
    const found = this.findState(goalId);
    if (!found) return;
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || isTerminalState(state)) return;
    const ns = state.nodeSession;
    if (!ns) { await this.advance(goalId); return; }

    // ① 产物优先
    const round = effectiveRound(state);
    const a = nodeArtifactPaths(mafwDir, goalId, round);
    const artifact = ns.phase === 'plan' ? a.waves : ns.phase === 'execute' ? a.receipt : a.review;
    if (fs.existsSync(artifact)) {
      // 兑现完成：借 completeNode（需要监听语义）——注册一次性监听再触发 idle
      const sid = ns.id;
      if (!this.listeners.has(sid)) {
        this.listeners.set(sid, () => {});
        this.onSessionIdle(sid);
      }
      return;
    }

    // ② 会话探测
    if (opts?.probeSession) {
      try {
        const alive = await opts.probeSession(ns.id);
        if (alive === 'alive') return; // 还在跑——监听若在则正常；若丢（重启）由 watchdog 超时兜底
      } catch { /* fail-open */ }
    }

    // ③ abort + 重试
    try { await this.deps.client.abort?.(ns.id); } catch { /* fail-open */ }
    this.deps.db.finishNodeRun(ns.runId, {
      status: 'aborted', finishedAt: new Date().toISOString(), error: 'stale node (recovery/watchdog)',
    });
    if (ns.attempt >= this.deps.maxAttempts) {
      await this.failNode(goalId, ns.id, 'timeout', `node ${ns.phase} exhausted attempts (${ns.attempt})`);
      return;
    }
    writeGoalState(mafwDir, goalId, { nodeSession: null }); // 清死会话 → advance 重启（attempt+1 由 latestNodeAttempt 推导）
    await this.advance(goalId);
  }
```

`gateway/src/core/goal/recovery.ts`：

```typescript
// gateway/src/core/goal/recovery.ts
import { NodeDriver } from './driver';
import { loadGoalState, isTerminalState } from './state-v3';

export interface RecoveryStateRef { goalId: string; mafwDir: string }

export interface RecoveryDeps {
  driver: NodeDriver;
  states: RecoveryStateRef[];
  probeSession?: (sessionID: string) => Promise<'alive' | 'dead'>;
}

/** 启动扫描：非终态 goal 全部 examine（产物优先/重试/归档）。 */
export async function recoverGoals(deps: RecoveryDeps): Promise<void> {
  for (const s of deps.states) {
    const state = loadGoalState(s.mafwDir, s.goalId);
    if (!state || isTerminalState(state)) continue;
    try {
      await deps.driver.examineStaleNode(s.goalId, { probeSession: deps.probeSession });
    } catch { /* fail-open：单 goal 失败不阻塞其他 */ }
  }
}

/** 周期扫描（挂 startBackupPolling）：nodeSession 超时 → examine。 */
export async function watchdogScan(
  deps: RecoveryDeps & { now?: number; timeoutMs?: number },
): Promise<void> {
  const now = deps.now ?? Date.now();
  const timeoutMs = deps.timeoutMs ?? 30 * 60_000;
  for (const s of deps.states) {
    const state = loadGoalState(s.mafwDir, s.goalId);
    if (!state || isTerminalState(state) || !state.nodeSession) continue;
    const started = Date.parse(state.nodeSession.startedAt);
    if (Number.isFinite(started) && now - started > timeoutMs) {
      try {
        await deps.driver.examineStaleNode(s.goalId, { probeSession: deps.probeSession });
      } catch { /* fail-open */ }
    }
  }
}
```

index.ts 挂接——`recoverState` 末尾（原 resumeStaleThreads 语义位置）：

```typescript
    const goalStates = Array.from(this.registeredProjects.entries()).flatMap(([projectDir, info]) => {
      const stateDir = path.join(info.mafwDir, 'state');
      if (!fs.existsSync(stateDir)) return [];
      return fs.readdirSync(stateDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ goalId: f.replace(/\.json$/, ''), mafwDir: info.mafwDir, projectDir }));
    });
    for (const s of goalStates) {
      this.goalDriverMafwDirCache.set(s.goalId, s.mafwDir);
      this.goalDriver?.registerGoalDir(s.goalId, s.mafwDir);
    }
    await recoverGoals({
      driver: this.goalDriver!, states: goalStates,
      probeSession: this.runtime?.capabilities?.sessionStorageApi
        ? async (sid) => {
            try { const info = await this.runtime!.session.get(sid); return info ? 'alive' : 'dead'; }
            catch { return 'dead'; }
          }
        : undefined,
    });
```

`startBackupPolling` 周期回调内（原 `resumeStaleThreads()` 调用替换）：

```typescript
      await watchdogScan({
        driver: this.goalDriver!, states: goalStates /* 同上构造，可提为私有方法 listGoalStates() */,
        timeoutMs: (config as any).goal?.nodeTimeoutMs ?? 30 * 60_000,
      });
```

（把 goalStates 构造提为私有方法 `listGoalStates()` 供两处复用。）

- [ ] **Step 4: 跑测试通过 + 全量 goal 回归**

Run: `cd gateway && npx jest tests/unit/goal-recovery.test.ts tests/unit/goal-driver --runInBand`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/recovery.ts gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/tests/unit/goal-recovery.test.ts
git commit -m "feat(goal): crash recovery + watchdog — artifact-first, probe, retry-attempt semantics"
```

---

### Task 12: Timeline + Retry API + SDK 方法

**Files:**
- Create: `gateway/src/routes/goal-timeline.ts`、`gateway/src/routes/goal-node-retry.ts`
- Modify: `gateway/src/core/goal/driver.ts`（实现 `retryNodeRun`，替换 stub）
- Modify: `gateway/src/index.ts`（路由注册**必须在 `/api/goals*` dashboard 兜底之前**——先例 goal-sessions.ts；SDK client）
- Modify: `packages/gateway-sdk/src/client.ts`（goals 命名空间 ~L586）
- Test: `gateway/tests/unit/goal-timeline-route.test.ts`、`gateway/tests/unit/goal-node-retry-route.test.ts`

**Interfaces:**
- Consumes: Task 3 `listNodeRuns`、Task 2 state、Task 11 retry 语义
- Produces: `GET /api/goals/:id/timeline` → `{goal, nodes[], artifacts, outcome?}`；`POST /api/goals/:id/nodes/:runId/retry`（execute 需 `confirm: true` 过 destructive 门）→ `{success, runId}`；SDK `goals.timeline(goalId)` / `goals.retryNode(goalId, runId, opts?)`

- [ ] **Step 1: 写失败测试**

```typescript
// gateway/tests/unit/goal-timeline-route.test.ts
import { handleGoalTimeline } from '../../src/routes/goal-timeline';

function fakeRes() {
  let b = ''; let s = 0;
  const res = { writeHead(st: number) { s = st; }, end(d: string) { b = d; } } as any;
  return { res, get body() { return b; }, get status() { return s; } };
}

describe('GET /api/goals/:id/timeline', () => {
  const state = {
    version: '3', goalId: 'g1', phase: 'REVIEWING', round: 2, loop: 2, maxRounds: 3,
    reviewVerdict: null, reviewReportPath: null, reviewFeedback: '', wavePlanPath: 'w', receiptPath: 'r',
    lastError: null, nodeSession: { id: 's9', phase: 'review', startedAt: 't', attempt: 1, runId: 9 },
    pendingQuestion: null, userResponse: null, sameSigCount: 0, stateVersion: 1,
    nextNode: 'review', nextAction: 'RUNNING_review', artifacts: {}, currentWave: 1, totalWaves: 2,
    sessions: {}, updatedAt: 't', projectDir: 'C:/p', mafwDir: 'C:/m',
  };
  const runs = [{
    id: 1, goal_id: 'g1', project_id: 'C:/p', loop: 1, node: 'plan', attempt: 1, session_id: 's1',
    status: 'succeeded', started_at: '2026-10-08T00:00:00Z', finished_at: '2026-10-08T00:05:00Z',
    outcome: 'waves=2', error: null, tokens_input: 10, tokens_output: 5, cost_usd: 0.1,
  }];

  it('聚合 state + node_runs 富化 duration/outcome', async () => {
    const { res, body } = fakeRes();
    const handled = await handleGoalTimeline({ method: 'GET', url: '/api/goals/g1/timeline' } as any, res, {
      loadState: () => state, listNodeRuns: () => runs,
      loadRequest: () => ({ title: 'T' }), getOutcome: () => null,
    } as any);
    expect(handled).toBe(true);
    const j = JSON.parse(body);
    expect(j.goal.title).toBe('T');
    expect(j.goal.round).toBe(2);
    expect(j.nodes[0]).toMatchObject({ node: 'plan', status: 'succeeded', durationMs: 300_000, loop: 1 });
    expect(j.artifacts.wavesPath).toBe('w');
  });

  it('state 缺失 → 404', async () => {
    const { res, body } = fakeRes();
    await handleGoalTimeline({ method: 'GET', url: '/api/goals/nope/timeline' } as any, res, {
      loadState: () => null, listNodeRuns: () => [], loadRequest: () => null, getOutcome: () => null,
    } as any);
    expect(JSON.parse(body).error).toBeDefined();
  });
});
```

```typescript
// gateway/tests/unit/goal-node-retry-route.test.ts
import { handleNodeRetry } from '../../src/routes/goal-node-retry';

function fakeRes() {
  let b = ''; let s = 0;
  const res = { writeHead(st: number) { s = st; }, end(d: string) { b = d; } } as any;
  return { res, get body() { return b; }, get status() { return s; } };
}

describe('POST /api/goals/:id/nodes/:runId/retry', () => {
  it('execute 节点缺 confirm → 409（destructive 门）', async () => {
    const { res, body, status } = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, res, {
      body: {},
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'execute', status: 'failed', loop: 1 }),
      retryNodeRun: async () => { throw new Error('should not reach'); },
    } as any);
    expect(status).toBe(409);
    expect(JSON.parse(body).error).toContain('confirm');
  });

  it('execute 节点带 confirm=true → 放行', async () => {
    const { res, body, status } = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, res, {
      body: { confirm: true },
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'execute', status: 'failed', loop: 1 }),
      retryNodeRun: async () => ({ runId: 7 }),
    } as any);
    expect(status).toBe(200);
    expect(JSON.parse(body).runId).toBe(7);
  });

  it('succeeded 行不可重试 → 400', async () => {
    const { res, status } = fakeRes();
    await handleNodeRetry({ method: 'POST', url: '/api/goals/g1/nodes/5/retry' } as any, res, {
      body: {},
      getNodeRun: () => ({ id: 5, goal_id: 'g1', node: 'review', status: 'succeeded', loop: 1 }),
      retryNodeRun: async () => { throw new Error('x'); },
    } as any);
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/goal-timeline-route.test.ts tests/unit/goal-node-retry-route.test.ts --runInBand`
Expected: FAIL — modules not found

- [ ] **Step 3: 实现**

`gateway/src/routes/goal-timeline.ts`（模式照抄 goal-sessions.ts：deps 注入 + handled 语义）：

```typescript
// gateway/src/routes/goal-timeline.ts
import * as http from 'http';
import * as path from 'path';
import { GoalStateV3 } from '../core/goal/state-v3';
import { nodeArtifactPaths } from '../core/goal/node-prompts';

export interface TimelineDeps {
  loadState(goalId: string): GoalStateV3 | null;
  listNodeRuns(goalId: string): any[];
  loadRequest(goalId: string): any;
  getOutcome(goalId: string): any;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleGoalTimeline(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: TimelineDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/goals\/([^/]+)\/timeline(?:\?|$)/);
  if (!m || req.method !== 'GET') return false;
  const goalId = decodeURIComponent(m[1]);
  try {
    const state = deps.loadState(goalId);
    if (!state) { json(res, 404, { error: 'goal state not found' }); return true; }
    const request = deps.loadRequest(goalId);
    const a = nodeArtifactPaths(state.mafwDir, goalId, state.round);
    const nodes = (deps.listNodeRuns(goalId) ?? []).map((r) => ({
      runId: r.id, loop: r.loop, node: r.node, attempt: r.attempt, status: r.status,
      sessionId: r.session_id, startedAt: r.started_at, finishedAt: r.finished_at,
      durationMs: r.started_at && r.finished_at
        ? Math.max(0, Date.parse(r.finished_at) - Date.parse(r.started_at)) : null,
      outcome: r.outcome, error: r.error,
      tokensInput: r.tokens_input, tokensOutput: r.tokens_output, costUsd: r.cost_usd,
    }));
    json(res, 200, {
      goal: {
        goalId, title: request?.title ?? goalId, phase: state.phase,
        round: state.round, maxRounds: state.maxRounds,
        verdict: state.reviewVerdict, nextNode: state.nextNode, nextAction: state.nextAction,
        lastError: state.lastError, updatedAt: state.updatedAt,
      },
      nodes,
      artifacts: {
        wavesPath: state.wavePlanPath ?? a.waves,
        receipts: nodes.filter((n) => n.node === 'execute').map((n) => n.outcome),
        reviewsDir: path.dirname(a.review),
      },
      outcome: deps.getOutcome(goalId) ?? undefined,
    });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
```

`gateway/src/routes/goal-node-retry.ts`：

```typescript
// gateway/src/routes/goal-node-retry.ts
import * as http from 'http';

export interface NodeRetryDeps {
  body: { confirm?: boolean };
  getNodeRun(runId: number): { id: number; goal_id: string; node: string; status: string; loop: number } | null;
  retryNodeRun(goalId: string, runId: number): Promise<{ runId: number }>;
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export async function handleNodeRetry(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: NodeRetryDeps,
): Promise<boolean> {
  const m = url.match(/^\/api\/goals\/([^/]+)\/nodes\/(\d+)\/retry$/);
  if (!m || req.method !== 'POST') return false;
  const goalId = decodeURIComponent(m[1]);
  const runId = Number(m[2]);
  try {
    const run = deps.getNodeRun(runId);
    if (!run || run.goal_id !== goalId) { json(res, 404, { error: 'node run not found' }); return true; }
    if (run.status === 'succeeded') { json(res, 400, { error: 'cannot retry a succeeded run' }); return true; }
    if (run.node === 'execute' && !deps.body.confirm) {
      json(res, 409, {
        error: 'execute retry re-runs write operations — pass confirm: true to proceed',
      });
      return true;
    }
    const result = await deps.retryNodeRun(goalId, runId);
    json(res, 200, { success: true, runId: result.runId });
  } catch (err: any) {
    json(res, 500, { error: err?.message ?? String(err) });
  }
  return true;
}
```

driver.ts 替换 `retryNodeRun` stub（借 examineStaleNode 语义——只读节点直接重跑 = 清 nodeSession 设 nextNode 再 advance）：

```typescript
  /** 节点重跑（DFX）：失败/超时行重试；execute 的 destructive 门在路由层。 */
  async retryNodeRun(goalId: string, runId: number): Promise<{ runId: number }> {
    const found = this.findState(goalId);
    if (!found) throw new Error('goal not found');
    const { mafwDir } = found;
    const state = loadGoalState(mafwDir, goalId);
    if (!state || isTerminalState(state)) throw new Error('goal is terminal');
    const run = this.deps.db.listNodeRuns(goalId).find((r: any) => r.id === runId);
    if (!run) throw new Error(`node run ${runId} not found`);
    // 清在飞会话（若有）并指回该节点（loop 不回退——重跑当前 loop 的该节点）
    if (state.nodeSession) {
      try { await this.deps.client.abort?.(state.nodeSession.id); } catch { /* fail-open */ }
    }
    writeGoalState(mafwDir, goalId, { nodeSession: null, nextNode: run.node, nextAction: `RUNNING_${run.node}` });
    await this.advance(goalId);
    const latest = this.deps.db.latestNodeAttempt(goalId, run.loop, run.node);
    return { runId: latest?.id ?? runId };
  }
```

index.ts 路由注册（在 `/api/goals*` dashboard 兜底 ~L4023 **之前**，参照 goal-sessions 注册点）：

```typescript
        if (await handleGoalTimeline(req, res, req.url!, {
          loadState: (goalId) => {
            const mafwDir = this.goalDriverMafwDirCache.get(goalId)
              ?? this.findGoalStatePath(goalId)?.info.mafwDir;
            return mafwDir ? loadGoalState(mafwDir, goalId) : null;
          },
          listNodeRuns: (goalId) => this.getGatewayDb().listNodeRuns(goalId),
          loadRequest: (goalId) => { try { return this.loadRequest(goalId); } catch { return null; } },
          getOutcome: (goalId) => this.getGatewayDb().getGoalOutcome?.(goalId) ?? null,
        } as any)) return;

        // POST body 需先 readBody —— retry 路由独立解析：
        const retryMatch = req.url?.match(/^\/api\/goals\/([^/]+)\/nodes\/(\d+)\/retry$/);
        if (retryMatch && req.method === 'POST') {
          const raw = await readBody(req);
          let body: any; try { body = JSON.parse(raw); } catch { body = {}; }
          if (await handleNodeRetry(req, res, req.url!, {
            body,
            getNodeRun: (runId) => this.getGatewayDb().listNodeRuns(retryMatch[1]).find((r: any) => r.id === runId) ?? null,
            retryNodeRun: (goalId, runId) => this.goalDriver!.retryNodeRun(goalId, runId),
          } as any)) return;
        }
```

（`getGoalOutcome` 若 GatewayDatabase 无此方法：加一个 `getGoalOutcome(goalId)` 单行查询方法——`SELECT * FROM goal_outcomes WHERE goal_id = ? ORDER BY created_at DESC LIMIT 1`。）

SDK `packages/gateway-sdk/src/client.ts` goals 命名空间追加：

```typescript
    timeline: async (goalId: string) =>
      this.request(`/api/goals/${encodeURIComponent(goalId)}/timeline`),
    retryNode: async (goalId: string, runId: number, opts?: { confirm?: boolean }) =>
      this.request(`/api/goals/${encodeURIComponent(goalId)}/nodes/${runId}/retry`, {
        method: 'POST',
        body: JSON.stringify(opts ?? {}),
      }),
```

- [ ] **Step 4: 跑测试通过**

Run: `cd gateway && npx jest tests/unit/goal-timeline-route.test.ts tests/unit/goal-node-retry-route.test.ts --runInBand && npx tsc --noEmit`
Expected: PASS + 编译零错误

- [ ] **Step 5: Commit**

```bash
git add gateway/src/routes/goal-timeline.ts gateway/src/routes/goal-node-retry.ts gateway/src/core/goal/driver.ts gateway/src/index.ts gateway/src/memory/gateway-db.ts packages/gateway-sdk/src/client.ts gateway/tests/unit/goal-timeline-route.test.ts gateway/tests/unit/goal-node-retry-route.test.ts
git commit -m "feat(goal): timeline aggregation + node retry APIs (destructive gate on execute)"
```

---

### Task 13: 端到端冒烟 + 死代码标注 + 版本收尾

**Files:**
- Test: `gateway/tests/unit/goal-e2e.test.ts`（fake runtime 全链路）
- Modify: 死代码标注——`gateway/src/chat/graph-runner.ts`、`gateway/src/core/plugin.ts`（若在 gateway src；否则 root `src/`）、`gateway/src/core/mcp/tools.ts`、`gateway/src/poll.ts`（各文件头加 deprecated 注释，**不删**）
- Modify: 根 `package.json`（version bump）、`AGENTS.md`（新增 §5.22 或扩写 goal 编排段落）

**Interfaces:**
- Consumes: 全部前置 task
- Produces: 端到端验证（spec 启用检查清单的核心项）+ 交付物

- [ ] **Step 1: 写端到端测试（fake client 全链路：plan→execute→review PASS→archive + askUser 中断恢复 + 崩溃恢复）**

```typescript
// gateway/tests/unit/goal-e2e.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';
import { recoverGoals } from '../../src/core/goal/recovery';

const settle = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

describe('goal 端到端（fake runtime）', () => {
  it('全链路：plan → execute → review PASS → archive_success，产物/事件/node_runs 齐全', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e'); // plan

    // 模拟 agent 写产物 → idle
    let a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [{ id: 'w1', title: 't', tasks: ['x'] }], status: 'ready' }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('execute');

    fs.writeFileSync(a.receipt, JSON.stringify({ goalId: 'e2e', timestamp: 't', receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'ok', files: [] }] }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('review');

    fs.writeFileSync(a.review, '```mafw-review\n{"verdict":"PASS","feedback":"done"}\n```\\n', 'utf-8');
    await h.fireIdle(); await settle();

    const st = h.load('e2e')!;
    expect(st.nextAction).toBe('COMPLETED');
    expect(st.phase).toBe('ARCHIVED');
    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'PASS', rounds: 1 });
    // 三节点 run 行 + started/finished 事件
    expect(h.nodeRuns.filter((r) => r.status === 'succeeded').map((r) => r.node)).toEqual(['plan', 'execute', 'review']);
    expect(h.events.filter((e) => e.type === 'goal_node' && e.transition === 'finished')).toHaveLength(3);
    // 会话全部清理
    expect(h.calls.filter((c) => c.op === 'delete')).toHaveLength(3);
  });

  it('askUser 中断恢复：need_clarification → 应答 → 回 plan → 继续到 PASS', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e');
    const a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ status: 'need_clarification', ambiguities: ['用哪个方案?'] }), 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.phase).toBe('ASKING_USER');

    // manager 自治代答（questionId 来自 state）
    const qid = h.load('e2e')!.pendingQuestion!.questionId;
    expect(h.driver.handleAnswer('e2e', qid, '方案B')).toBe(true);
    await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('plan'); // 回 plan 重规划

    // 第二轮 plan → ready → 一路到 PASS
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');
    await h.fireIdle(); await settle();
    fs.writeFileSync(a.receipt, JSON.stringify({ goalId: 'e2e', receipts: [] }), 'utf-8');
    await h.fireIdle(); await settle();
    fs.writeFileSync(a.review, '```mafw-review\n{"verdict":"PASS","feedback":"ok"}\n```\\n', 'utf-8');
    await h.fireIdle(); await settle();
    expect(h.load('e2e')!.nextAction).toBe('COMPLETED');
  });

  it('崩溃恢复：节点飞行中"重启"（丢监听）→ 产物已出 → 兑现完成继续', async () => {
    const h = makeHarness();
    seedGoal(h, 'e2e');
    await h.driver.advance('e2e');
    const a = nodeArtifactPaths(h.mafwDir, 'e2e', 1);
    fs.writeFileSync(a.waves, JSON.stringify({ waves: [], status: 'ready' }), 'utf-8');
    // 模拟重启：直接丢弃 driver（监听随实例消失），新 driver 从 state 恢复
    const h2 = { ...h, driver: new (h.driver.constructor as any)(h.deps) };
    h2.driver.registerGoalDir('e2e', h.mafwDir);
    await recoverGoals({ driver: h2.driver, states: [{ goalId: 'e2e', mafwDir: h.mafwDir }] });
    await settle();
    expect(h.load('e2e')!.nodeSession?.phase).toBe('execute'); // plan 兑现，推进 execute
  });
});
```

- [ ] **Step 2: 跑测试（应直接 PASS——前面任务已实现全部逻辑；失败=集成缝隙，修 driver/接线）**

Run: `cd gateway && npx jest tests/unit/goal-e2e.test.ts --runInBand`
Expected: PASS

- [ ] **Step 3: 死代码标注（各文件头注释，不删）**

```typescript
// @deprecated (2026-10-08, goal P1): GraphRunner 无生产实例化点，goal 编排已由
// core/goal/driver.ts（NodeDriver）接管。物理删除安排在后续清理 PR。
```

对 `gateway/src/chat/graph-runner.ts`、`gateway/src/core/mcp/tools.ts`、`gateway/src/poll.ts`（若路径不同以 `grep -rn "class GraphRunner\|RequestManager" gateway/src` 实测为准）逐个加同款注释（文件名与理由相应调整；`core/plugin.ts` 若只被 legacy 插件路径引用则标注「legacy skill 链，P1 后删除」）。

- [ ] **Step 4: 全量回归 + 计数**

Run: `cd gateway && npm test 2>&1 | tail -20`
Expected: 全绿。记录新增测试文件数/用例数与全量通过数（交付汇报用）。

- [ ] **Step 5: 版本 bump + AGENTS.md 更新**

- 根 `package.json`：`4.21.0` → `4.22.0`
- `AGENTS.md`：新增「§5.22 Goal 编排 P1：NodeDriver + 节点级 Trace」小节——内容要点：NodeDriver 架构（state v3 + 事件驱动重入，langgraph 退役）、三节点身份（IdentityRegistry mafw-plan/execute/review）、goal_node_runs 表与 goal_node 事件、timeline/retry API、starter 链路（goal_created → startGoal）、watchdog/恢复语义、legacy skill 链并存说明（双读 round/loop）。行文风格对齐既有小节（密集要点式）。

- [ ] **Step 6: Commit**

```bash
git add gateway/tests/unit/goal-e2e.test.ts gateway/src/chat/graph-runner.ts gateway/src/core/mcp/tools.ts package.json AGENTS.md
git commit -m "feat(goal): P1 e2e smoke + deprecation markers + v4.22.0 (NodeDriver, node-level trace)"
```

---

## Self-Review 清单（计划完成后自查）

1. **Spec 覆盖**：D1 驱动器(Task 6/7/9/11) ✅；D2 三身份(Task 4) ✅；D3 双门(Task 7) ✅；D4 starter(Task 9 ④⑤ + Task 10) ✅；D5 askUser(Task 8/9 ⑦) ✅；D6 legacy 并存(Task 9 ⑤ state_change 兼容) ✅；§5 数据层(Task 3/12) ✅；§6 恢复(Task 11) ✅；§7 错误分类(session_error/artifact_missing/artifact_invalid/timeout 各有测试) ✅；§8 测试策略 ✅；§9 交付清单 1-12 全覆盖（#12 死代码标注在 Task 13）✅
2. **类型一致性**：`DriverDeps.db.insertNodeRun/finishNodeRun/listNodeRuns/latestNodeAttempt` 在 Task 3（GatewayDatabase 方法）、Task 6（接口）、Task 9 ③（接线）三处签名一致；`NodeSessionRef{runId}` 贯穿 Task 2/6/7/11/12；`handleAnswer/handleCancel` Task 8 定义 → Task 9 ⑦ 消费；`nodeArtifactPaths` Task 5 定义 → 7/11/12 消费
3. **已知留白**（实现时按实况微调，不阻塞）：`sdkSession.promptAsync` 的 agent 参数透传签名以 `gateway/src/resources/sdk-session.ts:118-134` 实测为准（若 opts 形状不同，改接线不改 driver 接口）；`getGoalOutcome` 方法若不存在按 Task 12 步骤补；watchdog 默认 30min 走 `(config as any).goal?.nodeTimeoutMs`（config.ts 可后续补类型化字段）
4. **风险提示**：Task 9 是最大单点（index.ts 十处锚点编辑）——建议单独 review；`fireIdle` 的 settle 轮数在慢机可能需 +1（harness 已含注释）

