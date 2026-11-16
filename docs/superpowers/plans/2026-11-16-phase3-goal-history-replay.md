# Phase 3 · Goal History + Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (this repo runs inline on `main`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让每次 GoalState 写入自动进入 domain log（`goal.state.changed`），用快照 + patch 纯回放重建任意版本的状态，并在状态行缺失时恢复 Goal。

**Architecture:** `writeGoalState` 的 patch 由 `GoalStateStore.save` 在同一 SQLite 事务里写成 `goal.state.changed`；每 20 个 aggregate version（以及新 revision reset）写一行 `goal_snapshots`。回放 = 最新快照 + 之后的 patch，纯函数、不调 LLM、不写文件。默认读路径仍是 `goal_state` 行；`MAFW_GOAL_REPLAY_READ=1` 时改读快照+回放并记录 divergence。

**Tech Stack:** TypeScript、better-sqlite3（同一连接、嵌套 savepoint）、Jest、现有 `DomainEventStore` / `GoalStateStore` / `state-v3`。

**Spec:** `docs/superpowers/plans/2026-11-16-event-centric-workflow.md`（Phase 3 + 开放问题 4/5 已定）+ `docs/research/2026-11-16-event-layer-as-center.md`（§8）。

## Global Constraints

- 在 `main` 上 native 执行；**不 push、不 merge、不发布**，除非用户明确批准。
- TDD：先写 failing test，看它失败，再写最小实现。
- 回放必须是**纯函数**：不调 runtime/LLM、不写文件、不广播；只读 DB + 纯计算。
- 默认读路径不变（`goal_state` 行）；history 读取由 `MAFW_GOAL_REPLAY_READ=1` 显式开启。
- 新表 additive：`goal_snapshots`；不删旧事件、不改 `domain_events` 语义。
- 时间戳走依赖注入的 `now()`；回放时使用事件里记录的 `updatedAt`，不重新取时间。
- 类型门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`。
- 全量门禁：`cd gateway && npx jest --runInBand --forceExit`，结束必须 `0 failed`。
- 只提交本任务列出的文件；工作树里的并行改动不要 `git add -A`。

## Review Focus

1. **回放与在线状态不一致**：同一 goal 的 snapshot + tail 必须逐字段等于当时的 `goal_state` 行（含 `round`/`loop` 双写、`stateVersion`、`updatedAt`）。
2. **reset（新 revision）**：`ensureGoalState` 的 reset 事件必须让回放丢弃旧 revision 的字段，而不是 merge。
3. **状态行缺失但历史存在**：`loadGoalState` 必须能回放恢复，而不是返回 null（否则 Goal 在库里“消失”）。
4. **回放副作用**：回放期间不得调用 runtime/LLM/fs；崩溃恢复重放不能重复执行节点。
5. **事件膨胀**：每次 state 写入一条事件；snapshot 必须按版本稳定触发（20 的倍数 + reset），不能因语义事件穿插而漂移。

---

### Task 1: `goal.state.changed` history capture

**Files:**
- Modify: `gateway/src/core/goal/goal-state-store.ts`
- Modify: `gateway/src/core/goal/state-v3.ts`
- Test: `gateway/tests/unit/goal/goal-state-history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GoalStateHistoryMeta {
    /** Fields changed by this write (writeGoalState). */
    patch?: Partial<GoalStateV3>
    /** New revision / brand-new state: replay must replace, not merge. */
    reset?: boolean
  }

  export interface GoalStateStoreOptions {
    events?: DomainEventStore
    snapshots?: GoalSnapshotStore
    snapshotEvery?: number          // default 20 (counted in goal.state.changed events)
    now?(): string
  }

  export class GoalStateStore implements GoalStateBackend {
    constructor(db: Database.Database, opts?: GoalStateStoreOptions)
    save(mafwDir: string, goalId: string, state: GoalStateV3, meta?: GoalStateHistoryMeta): void
  }
  ```
- `GoalStateBackend.save` 增加可选第 4 参 `meta?: GoalStateHistoryMeta`（现有实现/测试向后兼容）。
- `writeGoalState` 调 `saveGoalState(..., { patch })`；`ensureGoalState` 调 `saveGoalState(..., { reset: true })`。
- 事件映射（固定）：
  ```ts
  type: 'goal.state.changed'
  aggregateType: 'goal', aggregateId: goalId
  audience: 'none'
  payload: {
    goalId, revision, stateVersion, round, loop, updatedAt,
    reset: boolean,
    /** reset=true 时的完整新状态；回放用它整份替换。 */
    resetState?: GoalStateV3,
    patch?: Record<string, unknown>,
  }
  ```
- `save` 在**一个事务**里：upsert `goal_state` → `events.append(...)` → 按 Task 2 的节奏写 snapshot（Task 1 先只 append）。`events` 未注入时只 upsert（测试/文件模式）。

- [ ] **Step 1: 写 failing test**

```ts
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DomainEventStore } from '../../../src/core/events/domain-event-store';
import { GoalStateStore } from '../../../src/core/goal/goal-state-store';
import {
  ensureGoalState, setGoalStateBackend, statePathFor, writeGoalState,
} from '../../../src/core/goal/state-v3';

function setup() {
  const db = new Database(':memory:');
  const events = new DomainEventStore(db);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-'));
  const store = new GoalStateStore(db, { events });
  setGoalStateBackend(store);
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  return { db, events, dir, store };
}

test('every write appends one goal.state.changed event with the patch', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    writeGoalState(h.dir, 'g1', { round: 2 });
    const events = h.events.listAggregate('goal', 'g1');
    expect(events.map((e) => e.type)).toEqual([
      'goal.state.changed', 'goal.state.changed', 'goal.state.changed',
    ]);
    expect(events[1].payload).toMatchObject({ patch: { phase: 'EXECUTING' }, reset: false });
    expect(events[0].payload).toMatchObject({ reset: true });
    expect(events[2].payload).toMatchObject({ round: 2, loop: 2 });
  } finally {
    setGoalStateBackend(null);
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

test('history is skipped when no event store is wired', () => {
  const db = new Database(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-history-'));
  const store = new GoalStateStore(db);
  setGoalStateBackend(store);
  try {
    fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
    ensureGoalState(dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(dir, 'g1', { phase: 'EXECUTING' });
    expect(store.list()).toHaveLength(1);
  } finally {
    setGoalStateBackend(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-state-history.test.ts --runInBand --forceExit`
Expected: FAIL — payload/事件不存在（`goal.state.changed` 为 0 条）。

- [ ] **Step 3: 实现**

`GoalStateStore` 新增 `events`/`snapshotEvery`/`now`；`save(..., meta)` 外包 `this.db.transaction(() => { upsert; events?.append(...) })`。`state-v3.saveGoalState` 透传 meta；`writeGoalState` 传 `{ patch }`；`ensureGoalState` 的最终 `saveGoalState` 传 `{ reset: true }`。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/goal/goal-state-history.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-state-store.ts gateway/src/core/goal/state-v3.ts gateway/tests/unit/goal/goal-state-history.test.ts
git commit -m "feat(goal): record state patches in the domain log"
```

---

### Task 2: Snapshots + pure replay

**Files:**
- Create: `gateway/src/core/goal/goal-history.ts`
- Modify: `gateway/src/core/goal/goal-state-store.ts`
- Test: `gateway/tests/unit/goal/goal-history.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export class GoalSnapshotStore {
    constructor(db: Database.Database)
    save(goalId: string, version: number, state: GoalStateV3, now: string): void
    latest(goalId: string, atVersion?: number): { version: number; state: GoalStateV3 } | null
  }

  export interface GoalReplayStats {
    events: number
    snapshots: number
    fromSnapshotVersion: number
  }

  export function replayGoalState(input: {
    goalId: string
    events: DomainEventStore
    snapshots: GoalSnapshotStore
    atVersion?: number
  }): { state: GoalStateV3; stats: GoalReplayStats } | null
  ```
- 表：
  ```sql
  CREATE TABLE IF NOT EXISTS goal_snapshots (
    goal_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (goal_id, version)
  );
  ```
- 回放规则（固定）：
  - 找 `version <= atVersion` 的最新快照（无 `atVersion` = 最新）；无快照则从空状态开始；
  - 按 `aggregateVersion ASC` 读取 `goal.state.changed`，只应用 `version > snapshot.version`；
  - `reset: true` → 用 payload 里的 `resetState` 整份替换（Task 1 需在 reset 事件的 payload 里带 `resetState: GoalStateV3`；普通事件不带）；
  - `reset: false` → `{ ...state, ...patch, round: patch.round ?? state.round, loop: 同 round }`；`stateVersion`/`updatedAt` 用 payload 的值；
  - 无快照且无事件 → `null`；
  - 回放只做纯计算，不写库、不写文件。
- 快照节奏：`save` append 后，统计**自上一快照以来**的 `goal.state.changed` 条数；达到
  `snapshotEvery`（默认 20）或 `meta.reset` 时，在同一事务里
  `snapshots.save(goalId, event.aggregateVersion, nextState, now)`。语义事件（`goal.node.*`）
  不计入节奏，避免穿插导致漂移。

- [ ] **Step 1: 写 failing test**

```ts
// 本文件自带 setup(opts?: { snapshotEvery?: number })，返回 { db, events, snapshots, store, dir }。
test('replays from the latest snapshot plus tail', () => {
  const h = setup({ snapshotEvery: 2 });
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'PLANNING', round: 1 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    writeGoalState(h.dir, 'g1', { currentWave: 2 });
    const replayed = replayGoalState({
      goalId: 'g1', events: h.events, snapshots: h.snapshots,
    });
    expect(replayed!.state).toMatchObject({ phase: 'EXECUTING', currentWave: 2 });
    expect(replayed!.state).toEqual(h.store.load(h.dir, 'g1'));
    expect(replayed!.stats.snapshots).toBeGreaterThan(0);
  } finally { teardown(h); }
});

test('reset drops the previous revision fields', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 1 });
    writeGoalState(h.dir, 'g1', { reviewVerdict: 'FAIL', round: 3 });
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3, revision: 2 });
    const replayed = replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots });
    expect(replayed!.state).toMatchObject({ revision: 2, round: 1, reviewVerdict: null });
  } finally { teardown(h); }
});

test('replays an intermediate version for diagnostics', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'PLANNING' });
    const v = h.events.lastVersion('goal', 'g1');
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    const past = replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots, atVersion: v });
    expect(past!.state.phase).toBe('PLANNING');
  } finally { teardown(h); }
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-history.test.ts --runInBand --forceExit`
Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

`goal-history.ts`：快照表 + `replayGoalState`。`GoalStateStore.save` 注入 `snapshots` 并在版本命中时写快照。Task 1 的 reset 事件 payload 增加 `resetState`（存整份 state；revision 切换不频繁，体积可接受）。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/goal/goal-history.test.ts tests/unit/goal/goal-state-history.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-history.ts gateway/src/core/goal/goal-state-store.ts gateway/tests/unit/goal/goal-history.test.ts
git commit -m "feat(goal): add snapshots and pure history replay"
```

---

### Task 3: Load / recovery integration + flag

**Files:**
- Modify: `gateway/src/core/goal/goal-state-store.ts`
- Modify: `gateway/src/kernel.ts`
- Test: `gateway/tests/unit/goal/goal-history-load.test.ts`

**Interfaces:**
- `GoalStateStore.load`：
  1. `goal_state` 行存在 → 直接返回（默认路径）；
  2. 行缺失 → legacy JSON 导入（现有）；
  3. 仍缺失且有 `events` + `snapshots` → `replayGoalState`，恢复成功则持久化行（不追加新事件）并返回；
  4. `MAFW_GOAL_REPLAY_READ=1` 且历史可用 → 返回回放结果，若与行不一致 `log.warn('[GoalHistory] divergence ...')` 并把计数挂在 `store.replayStats()`。
- Produces:
  ```ts
  replayStats(): { replays: number; divergences: number; failures: number }
  ```
- kernel：先 `new DomainEventStore(db)`，再 `new GoalStateStore(db, { events: this.domainEvents, snapshots: this.goalSnapshots })`；`goalSnapshots = new GoalSnapshotStore(db)`。

- [ ] **Step 1: 写 failing test**

```ts
test('load replays when the state row is missing but history exists', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    h.db.prepare('DELETE FROM goal_state WHERE goal_id = ?').run('g1');
    fs.rmSync(statePathFor(h.dir, 'g1'), { force: true });
    const state = h.store.load(h.dir, 'g1');
    expect(state).toMatchObject({ goalId: 'g1', phase: 'EXECUTING' });
    expect(h.db.prepare('SELECT COUNT(*) n FROM goal_state WHERE goal_id = ?').get('g1')).toMatchObject({ n: 1 });
  } finally { teardown(h); }
});

test('replay-read flag returns history state and counts divergence', () => {
  const h = setup();
  const prev = process.env.MAFW_GOAL_REPLAY_READ;
  process.env.MAFW_GOAL_REPLAY_READ = '1';
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    h.db.prepare("UPDATE goal_state SET state_json = json_set(state_json, '$.phase', 'TAMPERED') WHERE goal_id = ?").run('g1');
    expect(h.store.load(h.dir, 'g1')?.phase).toBe('EXECUTING');
    expect(h.store.replayStats().divergences).toBe(1);
  } finally {
    if (prev === undefined) delete process.env.MAFW_GOAL_REPLAY_READ;
    else process.env.MAFW_GOAL_REPLAY_READ = prev;
    teardown(h);
  }
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-history-load.test.ts --runInBand --forceExit`
Expected: FAIL — 行缺失返回 null / flag 不生效。

- [ ] **Step 3: 实现 + kernel 接线**

`load` 按上面的 4 步；恢复写行用私有 `persistRow`（不 append 事件、不写快照）。kernel 调整构造顺序并把 `DomainEventStore` / `GoalSnapshotStore` 注入。

- [ ] **Step 4: 跑 test + tsc**

Run: `cd gateway && npx jest tests/unit/goal/goal-history-load.test.ts --runInBand --forceExit`
Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Expected: PASS / exit 0。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/goal/goal-state-store.ts gateway/src/kernel.ts gateway/tests/unit/goal/goal-history-load.test.ts
git commit -m "feat(goal): replay history when the state row is missing"
```

---

### Task 4: Crash-prefix parity + replay purity

**Files:**
- Test: `gateway/tests/unit/goal/goal-history-parity.test.ts`

**Interfaces:**
- Consumes: `replayGoalState`、`GoalStateStore`、`DomainEventStore`、`GoalSnapshotStore`。

- [ ] **Step 1: 写 failing test（前缀 parity）**

```ts
test('every prefix replays to the state that was live at that version', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    const expected: Array<{ version: number; state: GoalStateV3 }> = [
      { version: h.events.lastVersion('goal', 'g1'), state: h.store.load(h.dir, 'g1')! },
    ];
    const patches = [
      { phase: 'EXECUTING' }, { currentWave: 1 }, { round: 2 },
      { reviewVerdict: 'FAIL' as const }, { nextAction: 'RUNNING_execute' },
    ];
    for (const patch of patches) {
      const state = writeGoalState(h.dir, 'g1', patch);
      expected.push({ version: h.events.lastVersion('goal', 'g1'), state });
    }
    for (const row of expected) {
      const replayed = replayGoalState({
        goalId: 'g1', events: h.events, snapshots: h.snapshots, atVersion: row.version,
      });
      expect(replayed!.state).toEqual(row.state);
    }
  } finally { teardown(h); }
});

test('replay performs no writes and never touches the state row', () => {
  const h = setup();
  try {
    ensureGoalState(h.dir, 'g1', { projectDir: '/p', maxRounds: 3 });
    writeGoalState(h.dir, 'g1', { phase: 'EXECUTING' });
    const before = h.db.prepare('SELECT updated_at, state_json FROM goal_state WHERE goal_id = ?').get('g1');
    const eventsBefore = h.events.lastVersion('goal', 'g1');
    replayGoalState({ goalId: 'g1', events: h.events, snapshots: h.snapshots });
    expect(h.db.prepare('SELECT updated_at, state_json FROM goal_state WHERE goal_id = ?').get('g1')).toEqual(before);
    expect(h.events.lastVersion('goal', 'g1')).toBe(eventsBefore);
  } finally { teardown(h); }
});
```

- [ ] **Step 2: 跑 test 确认失败**

Run: `cd gateway && npx jest tests/unit/goal/goal-history-parity.test.ts --runInBand --forceExit`
Expected: FAIL（若 Task 1-3 已实现，至少 purity 断言应通过；前缀 parity 若失败说明回放规则有缺口）。

- [ ] **Step 3: 修回放规则直到 parity 全绿**

常见缺口：`round`/`loop` 双写、`patch.round` 缺失时沿用旧值、`stateVersion`/`updatedAt` 取事件 payload。不要放宽断言。

- [ ] **Step 4: 跑 test 确认通过**

Run: `cd gateway && npx jest tests/unit/goal/goal-history-parity.test.ts --runInBand --forceExit`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/unit/goal/goal-history-parity.test.ts
git commit -m "test(goal): prove replay parity for every history prefix"
```

---

### Task 5: 文档、门禁与真机验收

**Files:**
- Modify: `docs/architecture/goal.md`
- Modify: `docs/architecture/events.md`
- Create: `docs/releases/2026-11-16-goal-history-replay.md`

- [ ] **Step 1: 更新架构文档**

- `events.md`：新增 `goal.state.changed` 与 `goal_snapshots`；说明 history 是状态回放源，
  语义事件（`goal.node.*` 等）仍面向消费者；回放是纯函数。
- `goal.md`：state 写入自动进 history；每 20 版本 + revision reset 打快照；
  `MAFW_GOAL_REPLAY_READ=1` 切换读路径；行缺失时从 history 恢复。

- [ ] **Step 2: 写 release note**

`docs/releases/2026-11-16-goal-history-replay.md`：版本 `v5.1.0`、commit 列表（提交后回填）、
测试数、边界（事件膨胀 / 回放只做诊断恢复 / 旧 Goal 无 history）、回滚
（`MAFW_GOAL_REPLAY_READ=0` + 忽略 snapshot 表）。

- [ ] **Step 3: 全量门禁**

Run: `cd gateway && npx tsc --noEmit -p tsconfig.json`
Run: `cd gateway && Remove-Item Env:OPENCODE_SERVER_PASSWORD -ErrorAction SilentlyContinue; npx jest --runInBand --forceExit`
Expected: tsc exit 0；全量 0 failed。

- [ ] **Step 4: 构建**

Run: `cd gateway && npm run build`
Expected: 生成 `dist/release.json`，无 TS 错误。

- [ ] **Step 5: 真机验收（记录结果）**

重启后：
1. 任意 state 写入（例如对新 Goal 执行 start）后，`domain_events` 出现
   `goal.state.changed`，且 `event.aggregate_version` 单调；
2. 写入超过 20 个版本后 `goal_snapshots` 出现行；
3. 手动删除某个测试 Goal 的 `goal_state` 行（保留事件与快照）后重启，
   `loadGoalState` 能从 history 恢复该行；
4. `MAFW_GOAL_REPLAY_READ=1` 下启动，日志无 divergence（或记录已知历史缺口）。

- [ ] **Step 6: Commit**

```bash
git add docs/architecture/goal.md docs/architecture/events.md docs/releases/2026-11-16-goal-history-replay.md
git commit -m "docs: record phase 3 goal history and replay"
```

---

## Phase 3 退出标准

- 每次 `writeGoalState` 都产生一条 `goal.state.changed`，含 patch / round-loop 双写 / stateVersion / updatedAt。
- 每 20 个 aggregate version 与每次 revision reset 都有快照。
- `replayGoalState` 在任意前缀上与当时的 `goal_state` 行逐字段一致；回放无写副作用。
- `goal_state` 行缺失时能从 history 恢复；`MAFW_GOAL_REPLAY_READ=1` 可切换读路径并记录 divergence。
- gateway 全量测试 0 failed，`tsc` 与 `build` 通过。

**范围说明（相对父计划）：** Phase 3 不重写 NodeDriver，也不引入 Temporal 式 Activity
抽象（开放问题 5 已定）。父计划里「Activity 结果从 history 读取」在本阶段的含义是：
history 保存的 state patch 已包含 artifact / receipt / verdict 等结果字段，**回放本身**
不调用 LLM 或写文件；运行中的节点完成判定仍由现有产物/会话探测负责。真正把「节点执行」
也纳入历史，需要 Phase 4 之后另立项目。
