# Phase 2 · Goal lifecycle domain events + SQLite GoalState Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this repo runs inline on `main`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Goal 生命周期事实写进独立 `domain_events` 表，把 GoalState 迁进同一个 SQLite 库，并让归档动作的 state + event + outbox 真正同事务。

**Architecture:** `domain_events` 是 append-only 的 domain log（独立表，按 aggregate 版本单调）；`pod_events` 保持「事件 → 人」的 inbox 投影不变。`GoalStateV3` 的模块 API（`loadGoalState` / `writeGoalState` / `ensureGoalState`）通过可插拔 backend 委托给 SQLite，JSON 文件降级为兼容镜像（Phase 3 再移除）。`PodGoalService.onGoalArchived` 接受一个事务内回调，k嵌入式在同一个 `db.transaction` 里写 goal 状态、归档 domain event、写 pod event 和 lead outbox。

**Tech Stack:** TypeScript、better-sqlite3（单连接、`db.transaction`）、Jest（`--runInBand --forceExit`）、现有 `PodStore` / `EventStore` / `PodEventService`。

**Spec:** `docs/superpowers/plans/2026-11-16-event-centric-workflow.md`（Phase 2 段 + 开放问题 1-3 的已定结论）+ `docs/research/2026-11-16-event-layer-as-center.md`（§8 已定结论）。

## Global Constraints

- 在 `main` 上 native 执行；**不 push、不 merge、不发布**，除非用户明确批准。
- TDD：先写 failing test，看它失败，再写最小实现。没有 failing test 不写生产代码。
- `domain_events` 是**独立表**；`pod_events` 保持 inbox 投影，不并入、不删除。
- SQLite 是 GoalState 的写权威；`.mafw/state/<goalId>.json` 保留为尽力镜像（写入失败只 log，不阻塞），旧 `state/revisions/<goalId>/rev-<n>.json` 归档文件继续写。
- 所有新表只做 additive `CREATE TABLE IF NOT EXISTS`；不物理删除旧数据、不改旧表语义。
- 时间戳统一用现有依赖注入的 `now()`（ISO UTC 字符串），不直接 `new Date()`（纯函数/测试除外）。
- 类型门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`（必须带 `-p`）。
- 全量门禁：`cd gateway && npx jest --runInBand --forceExit`，结束必须 `0 failed`。
- 只提交本任务列出的文件；工作树里其他并行改动不要 `git add -A`。

## Review Focus

1. **两份 GoalState 互相覆盖**：driver 的 patch 写和归档写并发时，`save` 必须是单条 upsert，不能 read-modify-write 丢更新。
2. **升级后首次读取**：已有 Goal 只有 JSON、没有 `goal_state` 行时，`loadGoalState` 必须惰性导入 JSON 并返回，而不是返回 `null`（否则 active Goal 在重启后消失）。
3. **归档事务失败**：`domain_events` append 抛错时，goal 状态必须回滚为未归档，且不留 pod event / outbox 僵尸行。
4. **共享 Lead 会话**：同一 project 的 Lead 会话可能服务多个 Pod，ack 只能命中 `sent_session_id` 相同的行，不能按 channel 前缀全 ack。
5. **事件重试**：进程在 append 成功、outbox 落盘前崩溃，重试同一个 `eventId` 必须返回原行、版本不变，不能产生第二条事件。

---

### Task 1: Domain event store

**Files:**
- Create: `gateway/src/core/events/domain-event.ts`
- Create: `gateway/src/core/events/domain-event-store.ts`
- Test: `gateway/tests/unit/events/domain-event-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DomainAggregateType = 'goal' | 'pod' | 'external'
  export type DomainEventAudience = 'human' | 'lead' | 'member' | 'none'

  export interface DomainEvent {
    eventId: string
    type: string
    aggregateType: DomainAggregateType
    aggregateId: string
    aggregateVersion: number
    occurredAt: string
    recordedAt: string
    actor: string | null
    correlationId: string | null
    causationId: string | null
    audience: DomainEventAudience
    schemaVersion: number
    payload: Record<string, unknown>
  }

  export interface DomainEventInput {
    eventId?: string
    type: string
    aggregateType: DomainAggregateType
    aggregateId: string
    /** Optimistic concurrency: caller believes this is the current version. */
    expectedVersion?: number
    occurredAt: string
    actor?: string | null
    correlationId?: string | null
    causationId?: string | null
    audience: DomainEventAudience
    payload?: Record<string, unknown>
  }

  export class DomainEventConflictError extends Error {}

  export class DomainEventStore {
    constructor(db: Database.Database)
    append(input: DomainEventInput): DomainEvent
    lastVersion(aggregateType: DomainAggregateType, aggregateId: string): number
    listAggregate(
      aggregateType: DomainAggregateType,
      aggregateId: string,
      opts?: { afterVersion?: number; limit?: number },
    ): DomainEvent[]
  }
  ```
- 表：
  ```sql
  CREATE TABLE IF NOT EXISTS domain_events (
    event_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    aggregate_version INTEGER NOT NULL,
    occurred_at TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    actor TEXT,
    correlation_id TEXT,
    causation_id TEXT,
    audience TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    payload TEXT NOT NULL DEFAULT '{}',
    UNIQUE(aggregate_type, aggregate_id, aggregate_version)
  );
  ```
- 版本规则：`append` 在 `db.transaction` 内取 `MAX(aggregate_version)`；`expectedVersion` 不匹配 → `DomainEventConflictError`；未传 → 自动 `max + 1`；`eventId` 已存在 → 原样返回既有行（幂等，不校验 payload 差异）。

- [ ] **Step 1: 写 failing test**

```ts
import Database from 'better-sqlite3';
import { DomainEventConflictError, DomainEventStore } from '../../../src/core/events/domain-event-store';

const base = {
  type: 'goal.node.started',
  aggregateType: 'goal' as const,
  aggregateId: 'g1',
  occurredAt: '2026-11-16T00:00:00.000Z',
  audience: 'none' as const,
  payload: { node: 'plan' },
};

test('assigns monotonic versions per aggregate and replays in order', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const a = store.append({ ...base, eventId: 'e1' });
  const b = store.append({ ...base, eventId: 'e2', type: 'goal.node.completed' });
  const other = store.append({ ...base, eventId: 'e3', aggregateId: 'g2' });
  expect([a.aggregateVersion, b.aggregateVersion, other.aggregateVersion]).toEqual([1, 2, 1]);
  expect(store.listAggregate('goal', 'g1').map((e) => e.eventId)).toEqual(['e1', 'e2']);
  expect(store.lastVersion('goal', 'g1')).toBe(2);
});

test('same eventId is idempotent and does not bump the version', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  const first = store.append({ ...base, eventId: 'e1' });
  const again = store.append({ ...base, eventId: 'e1', payload: { node: 'review' } });
  expect(again.aggregateVersion).toBe(first.aggregateVersion);
  expect(again.payload).toEqual({ node: 'plan' });
  expect(store.listAggregate('goal', 'g1')).toHaveLength(1);
});

test('rejects a stale expectedVersion', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  store.append({ ...base, eventId: 'e1' });
  expect(() => store.append({ ...base, eventId: 'e2', expectedVersion: 0 }))
    .toThrow(DomainEventConflictError);
});

test('afterVersion filters the replay tail', () => {
  const store = new DomainEventStore(new Database(':memory:'));
  store.append({ ...base, eventId: 'e1' });
  store.append({ ...base, eventId: 'e2' });
  expect(store.listAggregate('goal', 'g1', { afterVersion: 1 }).map((e) => e.eventId))
    .toEqual(['e2']);
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/events/domain-event-store.test.ts --runInBand --forceExit`
Expected: FAIL — `Cannot find module '../../../src/core/events/domain-event-store'`。

- [ ] **Step 3: 实现**

`domain-event.ts` 只放类型与 `DomainEventConflictError`。`domain-event-store.ts` 在构造函数里建表；`append` 用 `this.db.transaction(() => {...})()`，内部先按 `eventId` 查既有行、再算版本、再 INSERT，`recordedAt` 取 `new Date().toISOString()`（store 是基础设施，事件时间用 `input.occurredAt`）。`listAggregate` 按 `aggregate_version ASC` 排序；`afterVersion` 用 `aggregate_version > ?`。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/events/domain-event-store.test.ts --runInBand --forceExit`
Expected: PASS，4 tests。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/events/domain-event.ts gateway/src/core/events/domain-event-store.ts gateway/tests/unit/events/domain-event-store.test.ts
git commit -m "feat(events): add append-only domain event store"
```

---

### Task 2: GoalState 迁进 SQLite（JSON 镜像保留）

**Files:**
- Create: `gateway/src/core/goal/goal-state-file.ts`
- Create: `gateway/src/core/goal/goal-state-store.ts`
- Modify: `gateway/src/core/goal/state-v3.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/goal/goal-state-store.test.ts`
- Test: `gateway/tests/unit/goal/state-v3-backend.test.ts`

**Interfaces:**
- Consumes: `GoalStateV3`、`EnsureGoalStateInit`（都在 `state-v3.ts`）。
- Produces:
  ```ts
  // goal-state-store.ts
  export interface GoalStateBackend {
    load(mafwDir: string, goalId: string): GoalStateV3 | null
    save(mafwDir: string, goalId: string, state: GoalStateV3): void
    archiveRevision(mafwDir: string, goalId: string, revision: number): void
    list(): GoalStateV3[]
  }

  export class GoalStateStore implements GoalStateBackend {
    constructor(db: Database.Database)
    load(mafwDir: string, goalId: string): GoalStateV3 | null
    save(mafwDir: string, goalId: string, state: GoalStateV3): void
    archiveRevision(mafwDir: string, goalId: string, revision: number): void
    list(): GoalStateV3[]
  }

  // state-v3.ts 新增
  export function setGoalStateBackend(backend: GoalStateBackend | null): void
  export function normalizeGoalState(raw: any, mafwDir: string, goalId: string): GoalStateV3
  export function listGoalStateSummaries(
    workspaces: Array<{ projectDir: string; mafwDir: string }>,
  ): Array<{ goalId: string; mafwDir: string; projectDir: string }>

  // goal-state-file.ts（从 state-v3.ts 抽出的文件实现）
  export function loadGoalStateFile(mafwDir: string, goalId: string): GoalStateV3 | null
  export function saveGoalStateFile(mafwDir: string, goalId: string, state: GoalStateV3): void
  export function archiveGoalStateFile(mafwDir: string, goalId: string, revision: number): void
  ```
- 表：
  ```sql
  CREATE TABLE IF NOT EXISTS goal_state (
    goal_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    phase TEXT,
    next_action TEXT NOT NULL,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS goal_state_revisions (
    goal_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    archived_at TEXT NOT NULL,
    PRIMARY KEY (goal_id, revision)
  );
  ```
- 委托规则（`state-v3.ts`）：`loadGoalState` / `writeGoalState` / `ensureGoalState` / `archiveGoalStateForRevision` 有 backend 时走 backend，否则走 `goal-state-file.ts`。`writeGoalState` 的 patch 合并、`bumpVersion`、`updatedAt` 逻辑保持不变。
- `GoalStateStore.load` 未命中时读 `loadGoalStateFile`，读到就 `save` 进库再返回（**惰性导入**）；`GoalStateStore.save` 先 upsert 库，再尽力 `saveGoalStateFile`（异常吞掉并 `console.warn`）。
- `GoalStateStore.archiveRevision`：从库里取当前行（没有则先惰性导入）→ `INSERT OR IGNORE INTO goal_state_revisions` → 尽力 `archiveGoalStateFile`。
- kernel：`getGatewayDb().getStore()` 之后 `setGoalStateBackend(new GoalStateStore(...))`；`listGoalStates()` 改为调用 `listGoalStateSummaries([...this.registeredProjects].map(([projectDir, info]) => ({ projectDir, mafwDir: info.mafwDir })))`；`recoverState` 的项目文件扫描改为遍历 `this.listGoalStates()` + `loadGoalState`。

- [ ] **Step 1: 写 failing test（store + 惰性导入 + 归档幂等）**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import { statePathFor, loadGoalState, type GoalStateV3 } from '../../../src/core/goal/state-v3';

function legacy(): GoalStateV3 {
  return {
    version: '3', goalId: 'g1', revision: 1, projectDir: 'p', mafwDir: 'm',
    phase: 'PLANNING', round: 1, loop: 1, maxRounds: 3, reviewVerdict: null,
    reviewReportPath: null, reviewFeedback: '', wavePlanPath: null, receiptPath: null,
    lastError: null, nodeSession: null, pendingQuestion: null, userResponse: null,
    sameSigCount: 0, stateVersion: 0, nextNode: 'plan', nextAction: 'RUNNING_plan',
    artifacts: {}, currentWave: 0, totalWaves: null, sessions: {},
    updatedAt: '2026-11-16T00:00:00.000Z',
  };
}

test('imports a legacy state file on first load and then serves it from sqlite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(statePathFor(dir, 'g1'), JSON.stringify(legacy()));
  const store = new GoalStateStore(new Database(':memory:'));
  expect(store.load(dir, 'g1')?.phase).toBe('PLANNING');
  fs.rmSync(statePathFor(dir, 'g1'));
  expect(store.load(dir, 'g1')?.goalId).toBe('g1');
});

test('save writes sqlite first and mirrors the json file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', { ...legacy(), phase: 'EXECUTING' });
  expect(JSON.parse(fs.readFileSync(statePathFor(dir, 'g1'), 'utf-8')).phase).toBe('EXECUTING');
  expect(store.list().map((s) => s.goalId)).toEqual(['g1']);
});

test('archives a revision once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', legacy());
  store.archiveRevision(dir, 'g1', 1);
  store.archiveRevision(dir, 'g1', 1);
  expect(store.list()).toHaveLength(1);
  expect(fs.existsSync(path.join(dir, 'state', 'revisions', 'g1', 'rev-1.json'))).toBe(true);
});

test('successive patches merge against the latest stored state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-state-'));
  const store = new GoalStateStore(new Database(':memory:'));
  store.save(dir, 'g1', { ...legacy(), phase: 'PLANNING' });
  store.save(dir, 'g1', { ...store.load(dir, 'g1')!, phase: 'EXECUTING' });
  store.save(dir, 'g1', { ...store.load(dir, 'g1')!, round: 2, loop: 2 });
  expect(store.load(dir, 'g1')).toMatchObject({ phase: 'EXECUTING', round: 2 });
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-state-store.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 store + 文件抽取**

先把 `state-v3.ts` 里的 fs 函数原样搬到 `goal-state-file.ts`（`statePathFor` / `revisionStatePathFor` 也搬，`state-v3.ts` 重新导出保持引用兼容）。再写 `GoalStateStore`。最后改 `state-v3.ts` 的自由函数为委托，并导出 `normalizeGoalState`（原 `normalize` 改名）与 `listGoalStateSummaries`。

- [ ] **Step 4: 写 failing test（委托切换）**

```ts
import { loadGoalState, setGoalStateBackend, writeGoalState, type GoalStateV3 } from '../../../src/core/goal/state-v3';

test('routes reads and writes through the registered backend', () => {
  const saved: GoalStateV3[] = [];
  const state = { goalId: 'g1', revision: 1, phase: 'PLANNING', stateVersion: 0 } as GoalStateV3;
  setGoalStateBackend({
    load: () => state,
    save: (_dir, _id, next) => { saved.push(next); },
    archiveRevision: () => {},
    list: () => [state],
  });
  try {
    expect(loadGoalState('/x', 'g1')?.goalId).toBe('g1');
    writeGoalState('/x', 'g1', { phase: 'EXECUTING' });
    expect(saved[0].phase).toBe('EXECUTING');
  } finally {
    setGoalStateBackend(null);
  }
});
```

- [ ] **Step 5: 跑两个 test 确认通过**

Run: `cd gateway && npx jest tests/unit/goal/goal-state-store.test.ts tests/unit/goal/state-v3-backend.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 6: 接入 kernel**

在 PodStore 初始化后注册 backend；`listGoalStates()` 与 `recoverState()` 改为走 `listGoalStateSummaries` / `loadGoalState`。kernel shutdown 时 `setGoalStateBackend(null)`。

- [ ] **Step 7: 类型门禁**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 8: Commit**

```bash
git add gateway/src/core/goal/goal-state-file.ts gateway/src/core/goal/goal-state-store.ts gateway/src/core/goal/state-v3.ts gateway/src/kernel.ts gateway/tests/unit/goal/goal-state-store.test.ts gateway/tests/unit/goal/state-v3-backend.test.ts
git commit -m "feat(goal): persist goal state in sqlite behind the state-v3 api"
```

---

### Task 3: Goal lifecycle event producers

**Files:**
- Create: `gateway/src/core/goal/goal-lifecycle-events.ts`
- Modify: `gateway/src/kernel.ts`
- Modify: `gateway/src/boot.ts`
- Test: `gateway/tests/unit/goal/goal-lifecycle-events.test.ts`
- Test: `gateway/tests/unit/goal/goal-lifecycle-wiring.test.ts`

**Interfaces:**
- Consumes: `DomainEventInput`（Task 1）。
- Produces:
  ```ts
  export function goalCreatedEvent(input: {
    goalId: string; revision: number; maxRounds: number;
    taskType?: string; planReview?: 'auto' | 'manual'; occurredAt: string;
  }): DomainEventInput

  export function goalPhaseChangedEvent(input: {
    goalId: string; phase: string; round: number; revision?: number;
    projectDir: string; occurredAt: string;
  }): DomainEventInput

  export function goalNodeStartedEvent(input: {
    goalId: string; node: string; round: number; attempt: number;
    revision: number; projectDir: string; occurredAt: string;
  }): DomainEventInput

  export function goalNodeFinishedEvent(input: {
    goalId: string; node: string; round: number; attempt: number;
    revision: number; projectDir: string; outcome?: string; occurredAt: string;
  }): DomainEventInput

  export function goalNodeFailedEvent(input: {
    goalId: string; node: string; round: number; attempt: number;
    revision: number; projectDir: string;
    failureClass: string; code: string; message: string; occurredAt: string;
  }): DomainEventInput
  ```
- 事件映射（固定）：
  - `goal.created` → `audience: 'none'`，payload `{ revision, maxRounds, taskType, planReview }`
  - `goal.phase.changed` → `audience: 'none'`，payload `{ phase, round, projectDir }`
  - `goal.node.started` → `audience: 'none'`，payload `{ node, round, attempt, projectDir }`
  - `goal.node.completed` → `audience: 'none'`，payload `{ node, round, attempt, outcome, projectDir }`
  - `goal.node.failed` → `audience: 'human'`，payload `{ node, round, attempt, failureClass, code, message, projectDir }`
  - 全部 `aggregateType: 'goal'`，`aggregateId: goalId`，`causationId: null`，`schemaVersion` 由 store 写 1。
- 生产点（全部在 kernel，NodeDriver 仍是执行权威）：
  - `kernel.startGoal` 调用 `ensureGoalState` 之后 append `goalCreatedEvent`；
  - `kernel.onPodGoalNode` 的 `started` / `finished` 分支 append 对应事件；`finished` 且 `outcome === 'failed'` 时改发 `goalNodeFailedEvent`（用 `state.lastFailure` 的 class/code/message，缺失时 `'unknown'`）；
  - 新增 `kernel.onGoalPhaseTransition(p)` 处理 `phase_transition`，在 `boot.ts` 与 `goal_node` 同处接线。

- [ ] **Step 1: 写 failing test（纯映射）**

```ts
import {
  goalCreatedEvent, goalNodeFailedEvent, goalNodeFinishedEvent, goalPhaseChangedEvent,
} from '../../../src/core/goal/goal-lifecycle-events';

test('maps a node start to a goal aggregate event', () => {
  const e = goalNodeFailedEvent({
    goalId: 'g1', node: 'execute', round: 2, attempt: 1, revision: 1,
    projectDir: '/p', failureClass: 'test', code: 'red', message: 'boom',
    occurredAt: '2026-11-16T00:00:00.000Z',
  });
  expect(e).toMatchObject({
    type: 'goal.node.failed',
    aggregateType: 'goal',
    aggregateId: 'g1',
    audience: 'human',
    payload: { node: 'execute', round: 2, attempt: 1, failureClass: 'test', code: 'red' },
  });
});

test('phase and created events stay internal', () => {
  expect(goalPhaseChangedEvent({
    goalId: 'g1', phase: 'EXECUTING', round: 1, projectDir: '/p',
    occurredAt: '2026-11-16T00:00:00.000Z',
  }).audience).toBe('none');
  expect(goalCreatedEvent({
    goalId: 'g1', revision: 1, maxRounds: 3, occurredAt: '2026-11-16T00:00:00.000Z',
  }).type).toBe('goal.created');
});

test('node finished carries the outcome', () => {
  expect(goalNodeFinishedEvent({
    goalId: 'g1', node: 'plan', round: 1, attempt: 1, revision: 1,
    projectDir: '/p', outcome: 'success', occurredAt: '2026-11-16T00:00:00.000Z',
  }).payload).toMatchObject({ outcome: 'success' });
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-lifecycle-events.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 builders 并接线**

builders 是纯函数，不依赖 store。kernel 侧 append 失败必须 `try/catch` + `log.warn`（事件是观测面，不能阻断节点推进）。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/goal/goal-lifecycle-events.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 写 wiring test（源码级接线断言）**

```ts
import * as fs from 'fs';
import * as path from 'path';

const kernel = fs.readFileSync(path.join(__dirname, '../../../src/kernel.ts'), 'utf-8');
const boot = fs.readFileSync(path.join(__dirname, '../../../src/boot.ts'), 'utf-8');

test('node lifecycle appends domain events', () => {
  const start = kernel.indexOf('private onPodGoalNode(');
  const end = kernel.indexOf('private onGoalPhaseTransition(', start);
  const block = kernel.slice(start, end > start ? end : start + 4000);
  expect(block).toMatch(/goalNodeStartedEvent/);
  expect(block).toMatch(/goalNodeFinishedEvent|goalNodeFailedEvent/);
  expect(block).toMatch(/domainEvents\.append/);
});

test('phase transitions are wired to the kernel', () => {
  expect(boot).toMatch(/onGoalPhaseTransition/);
});
```

- [ ] **Step 6: 跑 wiring test + 类型门禁**

Run: `cd gateway && npx jest tests/unit/goal/goal-lifecycle-wiring.test.ts --runInBand --forceExit`
Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: PASS / exit 0。

- [ ] **Step 7: Commit**

```bash
git add gateway/src/core/goal/goal-lifecycle-events.ts gateway/src/kernel.ts gateway/src/boot.ts gateway/tests/unit/goal/goal-lifecycle-events.test.ts gateway/tests/unit/goal/goal-lifecycle-wiring.test.ts
git commit -m "feat(goal): record node and phase lifecycle domain events"
```

---

### Task 4: 归档同事务（state + domain event + pod event + outbox）

**Files:**
- Create: `gateway/src/core/goal/goal-archive-events.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`（新增 `transaction`）
- Modify: `gateway/src/core/pod/pod-event-service.ts`（拆 `recordRow` / `writeAudit`）
- Modify: `gateway/src/core/pod/pod-goal-service.ts`（`onGoalArchived` 增加事务内回调）
- Modify: `gateway/src/kernel.ts`（`finishPodGoal` 改走回调）
- Test: `gateway/tests/unit/pod/goal-archive-tx.test.ts`
- Test: `gateway/tests/unit/pod/goal-archive-events.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // pod-store.ts
  transaction<T>(fn: () => T): T

  // pod-event-service.ts
  recordRow(input: PodEventRecordInput): PodEventRow   // DB only
  writeAudit(row: PodEventRow): void                   // fs only, best-effort

  // pod-goal-service.ts
  onGoalArchived(
    goalId: string,
    outcome?: { verdict?: string },
    opts?: { inTransaction?: (goal: PodGoalRow) => void },
  ): Promise<void>

  // goal-archive-events.ts
  export function archiveDomainEvent(input: {
    goalId: string; revision: number; verdict: string;
    status: 'done' | 'aborted'; lastError?: string | null;
    projectDir: string; occurredAt: string;
  }): DomainEventInput   // 'goal.result' | 'goal.failed'
  ```
- 事务边界（`onGoalArchived` 内）：
  ```ts
  this.deps.store.transaction(() => {
    this.deps.store.setGoalStatus(goal.id, nextStatus, { endedAt, verdict });
    this.deps.store.updatePod(pod.id, { activeGoalId: nextPointer, status }, now);
    opts?.inTransaction?.(goal);
  });
  ```
  `onGoalCompleted` / `promote` / `notify` 保持在事务提交之后。
- `archiveDomainEvent` 映射：`PASS` / `UNREVIEWED` → `goal.result`（audience `human`）；其余（`FAIL` / `MAX_RETRIES` / `ERROR` / `CANCELLED`）→ `goal.failed`（audience `human`）；`status` 为 `aborted` 只在 `CANCELLED` 出现。payload `{ verdict, status, lastError, projectDir }`。
- kernel `finishPodGoal` 收口：
  1. 先算 `domainInput`（`archiveDomainEvent`）和 `podEventInput`（`classifyGoalArchive` + title/summary）；
  2. `await this.podGoalService.onGoalArchived(goalId, { verdict }, { inTransaction: () => { this.domainEvents.append(domainInput); const row = this.podEventService.recordRow(podEventInput); if (row.audience === 'lead') this.leadOutbox.enqueuePodEvent({ podId, eventId: row.id, goalId, text: renderPodEvent(row), priority: 'p1' }); captured = row; } })`；
  3. 事务外 `record.writeAudit(captured)` + `broadcast(pod.event)`。
  `PodEventService.record` 的旧调用点（非归档）保持原样。

- [ ] **Step 1: 写 failing test（事务回滚）**

```ts
import Database from 'better-sqlite3';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';
// harness() 复用 tests/unit/pod/pod-goal-service.test.ts 的最小 deps 构造

test('rolls back the archive when the in-transaction writer throws', async () => {
  const h = harness(); // 已有 active goal g1
  await expect(
    h.service.onGoalArchived('g1', { verdict: 'FAIL' }, {
      inTransaction: () => { throw new Error('domain append failed'); },
    }),
  ).rejects.toThrow('domain append failed');
  expect(h.store.getGoalByGoalId('g1')?.status).toBe('active');
});

test('runs the in-transaction writer before committing the archive', async () => {
  const h = harness();
  const seen: string[] = [];
  await h.service.onGoalArchived('g1', { verdict: 'PASS' }, {
    inTransaction: (goal) => { seen.push(goal.goalId); },
  });
  expect(seen).toEqual(['g1']);
  expect(h.store.getGoalByGoalId('g1')?.status).toBe('done');
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/pod/goal-archive-tx.test.ts --runInBand --forceExit`
Expected: FAIL — `onGoalArchived` 不接受第三个参数 / 事务不回滚。

- [ ] **Step 3: 实现事务边界与 recordRow/writeAudit 拆分**

`PodStore.transaction` 直接 `return this.db.transaction(fn)()`；确认 `setGoalStatus` / `updatePod` 用的是同一个 `this.db`。`recordRow` 是现有 `record` 去掉 `writeAuditFile` 的版本。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/pod/goal-archive-tx.test.ts tests/unit/pod/pod-event-service.test.ts --runInBand --forceExit`
Expected: PASS（`record` 的原测试仍然绿）。

- [ ] **Step 5: 写 failing test（归档事件映射）**

```ts
import { archiveDomainEvent } from '../../../src/core/goal/goal-archive-events';

test('PASS and UNREVIEWED produce goal.result', () => {
  for (const verdict of ['PASS', 'UNREVIEWED']) {
    const e = archiveDomainEvent({
      goalId: 'g1', revision: 1, verdict, status: 'done', projectDir: '/p',
      occurredAt: '2026-11-16T00:00:00.000Z',
    });
    expect(e.type).toBe('goal.result');
    expect(e.audience).toBe('human');
    expect(e.payload).toMatchObject({ verdict });
  }
});

test('FAIL, MAX_RETRIES, ERROR and CANCELLED produce goal.failed', () => {
  for (const verdict of ['FAIL', 'MAX_RETRIES', 'ERROR', 'CANCELLED']) {
    const status = verdict === 'CANCELLED' ? 'aborted' : 'done';
    const e = archiveDomainEvent({
      goalId: 'g1', revision: 1, verdict, status, projectDir: '/p',
      occurredAt: '2026-11-16T00:00:00.000Z',
    });
    expect(e.type).toBe('goal.failed');
    expect(e.payload).toMatchObject({ verdict, status });
  }
});
```

- [ ] **Step 6: 跑 test 确认失败 → 实现 → 再跑**

Run: `cd gateway && npx jest tests/unit/pod/goal-archive-events.test.ts --runInBand --forceExit`
Expected: 先 FAIL（模块不存在），实现后 PASS。

- [ ] **Step 7: kernel 收口 + 类型门禁**

`finishPodGoal` 删除原来独立的 `podEventService.record` 块，改走 `onGoalArchived` 回调（保留 `broadcast` 与 `notifyResult`）。然后：

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0。

- [ ] **Step 8: Commit**

```bash
git add gateway/src/core/goal/goal-archive-events.ts gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-event-service.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/kernel.ts gateway/tests/unit/pod/goal-archive-tx.test.ts gateway/tests/unit/pod/goal-archive-events.test.ts
git commit -m "feat(goal): archive state and domain events in one transaction"
```

---

### Task 5: Goal projection + parity

**Files:**
- Create: `gateway/src/core/pod/goal-view-projector.ts`
- Test: `gateway/tests/unit/pod/goal-view-projector.test.ts`
- Test: `gateway/tests/unit/pod/goal-view-projection-parity.test.ts`

**Interfaces:**
- Consumes: `DomainEvent[]`（Task 1）；`PodGoalView`、`buildPodGoalView`（`pod-view.ts`）；`deriveAttention`（`lead/attention.ts`）。
- Produces:
  ```ts
  export interface GoalLifecycleProjection {
    goalId: string
    revision: number
    phase: string | null
    round: number
    status: 'active' | 'done' | 'aborted'
    verdict: 'PASS' | 'UNREVIEWED' | 'FAIL' | 'MAX_RETRIES' | 'ERROR' | 'CANCELLED' | null
    failed: boolean
    resultReady: boolean
    lastError: string | null
    accepted: boolean
  }

  export function projectGoalLifecycle(events: DomainEvent[]): GoalLifecycleProjection | null
  export function projectAttention(p: GoalLifecycleProjection): {
    failed: boolean
    openResult: boolean
  }
  ```
- 投影规则：
  - 只看 `aggregateType === 'goal'` 且 `aggregateId` 相同的事件，按 `aggregateVersion` 升序；
  - `goal.created` → `status='active'`、`revision`；
  - `goal.phase.changed` → `phase`、`round`；
  - `goal.node.started` → `phase` 不变、`round` 取事件；
  - `goal.node.failed` → `lastError = message`；
  - `goal.result` → `status='done'`、`verdict`、`resultReady=true`、`failed=false`；
  - `goal.failed` → `status = verdict === 'CANCELLED' ? 'aborted' : 'done'`、`failed=true`、`resultReady=false`；
  - `goal.accepted` → `accepted=true`；
  - 无任何事件 → `null`。
- parity 规则：同一个 fixture（`PodGoalRow` + `PodGoalDescription`）下，投影的
  `status/verdict/phase/failed/resultReady/accepted` 必须等于 `buildPodGoalView(...)` 的
  `status/verdict/phase` + `deriveAttention([view])` 里的 `failed`/`open_result` 语义。

- [ ] **Step 1: 写 failing test（投影）**

```ts
import type { DomainEvent } from '../../../src/core/events/domain-event';
import { projectGoalLifecycle } from '../../../src/core/pod/goal-view-projector';

const evt = (type: string, version: number, payload: Record<string, unknown> = {}): DomainEvent => ({
  eventId: `e${version}`, type, aggregateType: 'goal', aggregateId: 'g1',
  aggregateVersion: version, occurredAt: '2026-11-16T00:00:00.000Z',
  recordedAt: '2026-11-16T00:00:00.000Z', actor: null, correlationId: null,
  causationId: null, audience: 'none', schemaVersion: 1, payload,
});

test('replays a PASS lifecycle', () => {
  const p = projectGoalLifecycle([
    evt('goal.created', 1, { revision: 1 }),
    evt('goal.phase.changed', 2, { phase: 'EXECUTING', round: 1 }),
    evt('goal.result', 3, { verdict: 'PASS' }),
    evt('goal.accepted', 4, { revision: 1 }),
  ]);
  expect(p).toMatchObject({
    status: 'done', verdict: 'PASS', phase: 'EXECUTING', resultReady: true, accepted: true,
  });
});

test('replays a FAIL lifecycle and exposes the error', () => {
  const p = projectGoalLifecycle([
    evt('goal.created', 1, { revision: 1 }),
    evt('goal.node.failed', 2, { node: 'execute', message: 'boom' }),
    evt('goal.failed', 3, { verdict: 'MAX_RETRIES' }),
  ]);
  expect(p).toMatchObject({ status: 'done', failed: true, resultReady: false, lastError: 'boom' });
});

test('unknowable goals project to null', () => {
  expect(projectGoalLifecycle([])).toBeNull();
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/pod/goal-view-projector.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 projector**

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/pod/goal-view-projector.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 写 failing parity test**

用现有 `buildPodGoalView` fixture 构造 4 个场景（PASS、FAIL、MAX_RETRIES、ERROR），断言
`projectGoalLifecycle` 的 `status/verdict/failed/resultReady` 与
`buildPodGoalView(...)` + `deriveAttention([view])` 一致：

```ts
const view = buildPodGoalView(row({ verdict: 'FAIL' }), { terminal: true, verdict: 'FAIL' });
const p = projectGoalLifecycle([
  evt('goal.created', 1, { revision: 1 }),
  evt('goal.failed', 2, { verdict: 'FAIL' }),
]);
expect(p!.status).toBe(view.status);
expect(p!.verdict).toBe(view.verdict);
expect(p!.failed).toBe(deriveAttention([view]).some((a) => a.kind === 'failed'));
```

- [ ] **Step 6: 跑 parity test**

Run: `cd gateway && npx jest tests/unit/pod/goal-view-projection-parity.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add gateway/src/core/pod/goal-view-projector.ts gateway/tests/unit/pod/goal-view-projector.test.ts gateway/tests/unit/pod/goal-view-projection-parity.test.ts
git commit -m "feat(pod): project goal views from domain events"
```

---

### Task 6: Lead inbox read / ack

**Files:**
- Modify: `gateway/src/core/events/event-types.ts`
- Modify: `gateway/src/core/events/event-store.ts`
- Modify: `gateway/src/core/events/event-outbox.ts`
- Modify: `gateway/src/core/lead/lead-outbox.ts`
- Modify: `gateway/src/core/pod/pod-event-service.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`（按 goal+revision 列未读）
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/lead/lead-outbox-read-ack.test.ts`

**Interfaces:**
- `EventOutboxRow` 新增：
  ```ts
  readAt: string | null
  ackAt: string | null
  sentSessionId: string | null
  ```
- `event_outbox` additive 列：`read_at TEXT`、`ack_at TEXT`、`sent_session_id TEXT`（`EventStore` 构造时用 `ALTER TABLE ... ADD COLUMN` 守卫，缺列才加）。
- 新增方法：
  ```ts
  // EventOutbox
  markSent(id: string, sessionId?: string): EventOutboxRow

  // EventStore
  markOutboxRead(ids: string[], now: string): number
  markOutboxAckedBySession(sessionId: string, now: string): number

  // PodEventServiceDeps
  onSeen?(row: PodEventRow): void

  // PodStore
  listUnreadEventsForGoal(podId: string, goalId: string, revision: number): PodEventRow[]
  ```
- 语义（已定）：
  - **read**：`PodEventService.markSeen` / `markSeenAll` 成功后，对每个 `wakeSessionId` 形如
    `outbox:<id>` 的行调 `onSeen`；kernel 把它翻译成 `markOutboxRead([id])`。
    `a2a:<messageId>` 行不参与 read。
  - **ack**：kernel 的 runtime `turn.completed` 处理里，若 `podStore.getSessionBySessionId(sessionId)`
    对应成员的 `role === 'lead'`，调 `markOutboxAckedBySession(sessionId)`；只命中
    `state='sent' AND sent_session_id = ? AND ack_at IS NULL`。
  - `LeadOutbox.dispatch` 成功 prompt 后 `markSent(row.id, lead.sessionId)`。
  - ack 不跨 Pod：同一 Lead 会话服务多个 Pod 时，只 ack 发到该会话的行。

- [ ] **Step 1: 写 failing test（store 层）**

```ts
import Database from 'better-sqlite3';
import { EventStore } from '../../../src/core/events/event-store';
import { EventOutbox } from '../../../src/core/events/event-outbox';

test('markSent records the session and ack only touches that session', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => '2026-11-16T00:00:00.000Z' });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: '2026-11-16T00:00:00.000Z' });
  const a = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e1', payload: { kind: 'pod-event' } });
  const b = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e2', payload: { kind: 'pod-event' } });
  outbox.markSent(a.id, 'ses_a');
  outbox.markSent(b.id, 'ses_b');
  expect(store.markOutboxAckedBySession('ses_a', '2026-11-16T00:01:00.000Z')).toBe(1);
  expect(store.getOutbox(a.id)?.ackAt).toBe('2026-11-16T00:01:00.000Z');
  expect(store.getOutbox(b.id)?.ackAt).toBeNull();
});

test('markOutboxRead is idempotent', () => {
  const store = new EventStore(new Database(':memory:'));
  const outbox = new EventOutbox({ store, now: () => '2026-11-16T00:00:00.000Z' });
  store.insertChannel({ id: 'lead:p1', threadId: '*', kind: 'chat', address: {}, now: '2026-11-16T00:00:00.000Z' });
  const row = outbox.enqueue({ channelId: 'lead:p1', dedupeKey: 'pod-event:e1', payload: {} });
  expect(store.markOutboxRead([row.id], '2026-11-16T00:01:00.000Z')).toBe(1);
  expect(store.markOutboxRead([row.id], '2026-11-16T00:02:00.000Z')).toBe(0);
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-read-ack.test.ts --runInBand --forceExit`
Expected: FAIL — `markSent` 不收 sessionId / 方法不存在。

- [ ] **Step 3: 实现 store 列与方法**

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/lead/lead-outbox-read-ack.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: 写 failing test（seen → read 桥）**

```ts
test('marking a pod event seen reads its outbox row', () => {
  const seen: any[] = [];
  const svc = new PodEventService({
    store, mafwDir: tmpDir(), now: () => '2026-11-16T00:00:00.000Z',
    onSeen: (row) => seen.push(row),
  });
  const evt = svc.record({ ...base, audience: 'lead', severity: 'p2' });
  svc.markWakeQueued(evt.id, 'outbox_1');
  svc.markSeen('pod_1', evt.id);
  expect(seen[0]?.wakeSessionId).toBe('outbox:outbox_1');
});
```

- [ ] **Step 6: 实现 onSeen + kernel 接线**

`markSeen` 先 `this.deps.store.getEvent(podId, id)`，更新后调 `onSeen(row)`；`markSeenAll` 用 `listUnreadEventsForGoal` 先取行再更新。kernel：

```ts
onSeen: (row) => {
  const hit = /^outbox:(.+)$/.exec(row.wakeSessionId ?? '');
  if (hit) this.eventStore.markOutboxRead([hit[1]], this.nowIso());
},
```

`turn.completed` 分支追加：

```ts
const member = this.podStore?.getMemberBySession(sessionId);
if (member?.role === 'lead') {
  this.eventStore.markOutboxAckedBySession(sessionId, this.nowIso());
}
```

- [ ] **Step 7: 跑定向 + 类型门禁**

Run: `cd gateway && npx jest tests/unit/lead tests/unit/pod/pod-event-service.test.ts --runInBand --forceExit`
Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: 全绿 / exit 0。

- [ ] **Step 8: Commit**

```bash
git add gateway/src/core/events/event-types.ts gateway/src/core/events/event-store.ts gateway/src/core/events/event-outbox.ts gateway/src/core/lead/lead-outbox.ts gateway/src/core/pod/pod-event-service.ts gateway/src/core/pod/pod-store.ts gateway/src/kernel.ts gateway/tests/unit/lead/lead-outbox-read-ack.test.ts
git commit -m "feat(lead): track read and ack on the lead outbox"
```

---

### Task 7: 文档与全量门禁

**Files:**
- Modify: `docs/architecture/events.md`
- Modify: `docs/architecture/goal.md`
- Modify: `docs/architecture/pod.md`
- Create: `docs/releases/2026-11-16-goal-domain-events.md`

**Interfaces:** 无代码接口。

- [ ] **Step 1: 更新架构文档**

- `events.md` 新增 `domain_events` 一节：表结构、append/版本规则、与 `pod_events` 的分工
  （domain log vs inbox 投影）、`goal.*` 事件清单、read/ack 语义（人看到=read，
  Lead 会话 `turn.completed`=ack，按 `sent_session_id` 收敛）。
- `goal.md`：GoalState 写权威在 SQLite（`goal_state` / `goal_state_revisions`），
  JSON 是兼容镜像；归档走 `onGoalArchived` 事务内回调。
- `pod.md`：`pod_events.wake_session_id` 的三种形态（`outbox:` / `a2a:` / 旧 session id）
  与 read/ack 的对应关系。

- [ ] **Step 2: 写 release note**

`docs/releases/2026-11-16-goal-domain-events.md`：版本 `v5.1.0`、commit 列表（实现后回填）、
测试数、边界（JSON 镜像仍在 / 投影只做 parity 不接管读路径 / 外部事件仍走 `event_*`）、
回滚方式（`setGoalStateBackend(null)` + 关 projector）。

- [ ] **Step 3: 全量类型与测试**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Run: `cd gateway && Remove-Item Env:OPENCODE_SERVER_PASSWORD -ErrorAction SilentlyContinue; npx jest --runInBand --forceExit`
Expected: tsc exit 0；全量 `0 failed`（记录 suites / passed / skipped 实际数字）。

- [ ] **Step 4: 构建**

Run: `cd gateway && npm run build`
Expected: 生成 `dist/release.json`，无 TS 错误。

- [ ] **Step 5: 真机验收（可选，记录结果）**

gateway 重启后（用 `node -e` + `better-sqlite3` 查库，Windows 上没有 `sqlite3` CLI）：
1. `SELECT COUNT(*) FROM domain_events` 能查到启动后新增的事件；
2. 启动一个 Goal，确认 `goal.created` / `goal.node.started` / `goal.phase.changed` 入库；
3. Goal 归档后确认 `goal.result` 或 `goal.failed` 与 `pod_events` 行、`event_outbox` 行**同一时刻**出现（事务）；
4. 人点「已读」（`POST /api/pods/:podId/events/:id/seen`）后 `event_outbox.read_at` 有值；
5. Lead 会话完成一轮后 `event_outbox.ack_at` 有值。

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/events.md docs/architecture/goal.md docs/architecture/pod.md docs/releases/2026-11-16-goal-domain-events.md
git commit -m "docs: record phase 2 goal domain events"
```

---

## Phase 2 退出标准

- `domain_events` 独立表可 append/replay，同一 aggregate 版本单调、`eventId` 幂等。
- GoalState 读写走 SQLite，旧 JSON 惰性导入；JSON 继续作为镜像存在。
- 归档的 goal 状态、`goal.result` / `goal.failed`、`pod_events` 行与 lead outbox 行在同一事务内提交；任一失败全部回滚。
- `projectGoalLifecycle` 与 `buildPodGoalView` + `deriveAttention` 在 PASS / FAIL / MAX_RETRIES / ERROR 四个场景 parity 通过。
- Lead inbox read/ack 落到 `event_outbox`，按 `sent_session_id` 收敛，不跨 Pod。
- gateway 全量测试 0 failed，`tsc` 与 `build` 通过。

**范围说明（相对父计划的偏差）：** 父计划 Phase 2 的第 4 项「Desktop 统一投影」
（`work-overview-model.ts` / `goal-user-view.ts` / `lead-goal-status.ts` 删除重复分类）
**不在本计划内**。原因：Phase 2 的 projector 只做 parity，服务端读路径仍以
`buildPodGoalView` 为准；此时改 Desktop 会引入第三套分类，而不是消除重复。
Desktop 切换跟随 Phase 3 的「projector 接管读路径」一起做，届时才有可消费的
服务端投影字段。此偏差需要在 Phase 2 的 release note 里显式记录。
