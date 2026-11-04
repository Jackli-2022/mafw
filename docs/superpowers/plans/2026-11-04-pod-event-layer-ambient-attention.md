# Pod 事件层与常驻注意力 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Goal 在跑 / 跑完 / 需要人时一定有信号（托盘 + 任务栏 + 通知），并让 Lead 在没有用户开口时也能被 agent 消息叫醒。

**Architecture:** gateway 新增 `pod_events` 表与 `PodEventService`（DB 是运行时真相，`~/.mafw/pods/<id>/events/*.json` 是创建时写一次的审计快照）；分级走确定性纯函数；跨项目 `GET /api/presence` 由桌面 main 进程 15s 轮询驱动托盘三层；Lead 唤醒由 `PodEventWake` 扫描器按预算/去重/暂停/挂起闸门合并注入 `[POD EVENT]`。

**Tech Stack:** TypeScript、better-sqlite3（`PodStore`）、Electron（`Tray` / `setProgressBar` / `setOverlayIcon` / `Notification`）、jest（gateway）、node --test + tsx + test-shim（desktop）。

**Spec:** `docs/superpowers/specs/2026-11-04-pod-event-layer-ambient-attention-design.md`

## Global Constraints

- 行为变更必须 TDD：先写失败测试，跑出 RED，再实现，跑出 GREEN。
- 每个 Task 独立提交；不 push、不发布。
- gateway 测试：`cd gateway && npx jest tests/unit/pod/<file>.test.ts --runInBand`
- desktop 测试：`cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/<file>.test.ts`
- 类型门禁：`cd gateway && npx tsc --noEmit -p tsconfig.json`；`cd packages/desktop && npx tsgo --noEmit -p tsconfig.json`
- 基线（本批开工前）：desktop **2823/2823（617 suites）**、gateway **4681/4681（592 suites）**、SDK **199/199**。
- 消息 kind 只有五个：`note | request | review | decision | escalation`（`PodMessageKind`，`gateway/src/core/pod/pod-message-service.ts:3`）。不扩展。
- 唤醒与通知**不得调用 `switchAgent`**（coordination 会话切离 lead 会 403）。
- 事件 `severity` 只有 `p1 | p2 | p3`；p0 不进事件表。

## Review Focus

- **同一 Goal 打回后的第二版结果**：`goal.result` 的 dedupeKey 漏掉 revision 会让第二版永久静默——用户以为重做失败了。
- **A2A 来源的 escalation**：写点若挂在 `PodMessageService` 而非 `PodStore.insertMessage`，agent 的默认通道一条事件都不会产生，且所有单测仍绿。
- **gateway 在「事件落库」与「唤醒投递」之间重启**：没有持久化 `wakeState` 就等于把消息吞了。
- **用户打开 Goal 但结果接口失败**：此时把事件标记 `seen` 会让未读标记消失而用户什么也没看到。
- **跨项目完成**：desktop 停在项目 A，项目 B 的 Goal 完成——旧代码在这里直接 `return`（`MafwShell.tsx:2005`），而现在要它出声。

---

### Task 1: 事件模型与分级纯函数

**Files:**
- Create: `gateway/src/core/pod/pod-event-model.ts`
- Test: `gateway/tests/unit/pod/pod-event-model.test.ts`

**Interfaces:**
- Produces:
  - `type PodEventSeverity = 'p1' | 'p2' | 'p3'`
  - `type PodEventReason = 'decision' | 'result' | 'blocked' | 'progress' | 'message'`
  - `type PodEventAudience = 'human' | 'lead' | 'none'`
  - `interface PodEventClass { kind: string; severity: PodEventSeverity; audience: PodEventAudience; reason: PodEventReason }`
  - `classifyGoalArchive(input: { verdict: 'PASS'|'FAIL'|'MAX_RETRIES'|'ERROR'|'UNREVIEWED'|'CANCELLED'|null }): PodEventClass`
  - `classifyMemberMessage(input: { kind: string; toMemberId: string | null; leadMemberId: string | null }): PodEventClass`
  - `goalDedupeKey(goalId: string, revision: number): string`
  - `memberDedupeKey(kind: string, messageId: string, toMemberId: string | null): string`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-event-model.test.ts
import { classifyGoalArchive, classifyMemberMessage, goalDedupeKey, memberDedupeKey } from '../../../src/core/pod/pod-event-model';

describe('classifyGoalArchive', () => {
  it.each(['PASS', 'FAIL', 'MAX_RETRIES', 'ERROR', 'UNREVIEWED'] as const)(
    '%s is p1 (resultReady is irrelevant)', (verdict) => {
      expect(classifyGoalArchive({ verdict })).toMatchObject({ kind: 'goal.result', severity: 'p1', audience: 'human', reason: 'result' });
    },
  );
  it('CANCELLED is p3 (user cancelled on purpose)', () => {
    expect(classifyGoalArchive({ verdict: 'CANCELLED' })).toMatchObject({ kind: 'goal.ended', severity: 'p3', audience: 'none' });
  });
  it('null verdict is p3', () => {
    expect(classifyGoalArchive({ verdict: null })).toMatchObject({ kind: 'goal.ended', severity: 'p3' });
  });
});

describe('classifyMemberMessage', () => {
  it('request to lead is p2', () => {
    expect(classifyMemberMessage({ kind: 'request', toMemberId: 'lead', leadMemberId: 'lead' }))
      .toMatchObject({ kind: 'member.request', severity: 'p2', audience: 'lead', reason: 'blocked' });
  });
  it('escalation to lead is p2', () => {
    expect(classifyMemberMessage({ kind: 'escalation', toMemberId: 'lead', leadMemberId: 'lead' }))
      .toMatchObject({ severity: 'p2', audience: 'lead' });
  });
  it('request to builder is p3', () => {
    expect(classifyMemberMessage({ kind: 'request', toMemberId: 'builder', leadMemberId: 'lead' }))
      .toMatchObject({ severity: 'p3', audience: 'none' });
  });
  it.each(['note', 'review', 'decision'])('%s is p3 even to lead', (kind) => {
    expect(classifyMemberMessage({ kind, toMemberId: 'lead', leadMemberId: 'lead' }))
      .toMatchObject({ severity: 'p3', audience: 'none' });
  });
});

describe('dedupe keys', () => {
  it('goal key carries revision', () => {
    expect(goalDedupeKey('g1', 2)).toBe('goal.result:g1:r2');
    expect(goalDedupeKey('g1', 1)).not.toBe(goalDedupeKey('g1', 2));
  });
  it('member key carries message id', () => {
    expect(memberDedupeKey('escalation', 'm1', 'lead')).toBe('member.escalation:m1:lead');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-model.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/core/pod/pod-event-model'`

- [ ] **Step 3: Implement `pod-event-model.ts`**

`classifyGoalArchive`：`verdict === 'CANCELLED' || verdict === null` → `{ kind:'goal.ended', severity:'p3', audience:'none', reason:'progress' }`；其余一律 `{ kind:'goal.result', severity:'p1', audience:'human', reason:'result' }`。
`classifyMemberMessage`：`(kind === 'request' || kind === 'escalation') && toMemberId !== null && toMemberId === leadMemberId` → `{ kind: \`member.${kind}\`, severity:'p2', audience:'lead', reason:'blocked' }`；否则 `{ kind: \`member.${kind}\`, severity:'p3', audience:'none', reason:'message' }`。
`goalDedupeKey = \`goal.result:${goalId}:r${revision}\``；`memberDedupeKey = \`member.${kind}:${messageId}:${toMemberId ?? '*'}\``。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-model.test.ts --runInBand`
Expected: PASS（13 个用例）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-event-model.ts gateway/tests/unit/pod/pod-event-model.test.ts
git commit -m "feat(gateway): add pod event model and deterministic severity rules"
```

---

### Task 2: `pod_events` 表与 `PodEventService`

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`（在既有 `CREATE TABLE` 块末尾追加；在类内加 7 个方法）
- Create: `gateway/src/core/pod/pod-event-service.ts`
- Test: `gateway/tests/unit/pod/pod-event-service.test.ts`

**Interfaces:**
- Consumes: `PodStore`，`classifyGoalArchive` / `classifyMemberMessage` / `goalDedupeKey`（Task 1）
- Produces:
  - `interface PodEventRow { id, podId, projectId, goalId, revision, kind, severity, reason, title, summary, refsJson, dedupeKey, audience, state, wakeState, wakeAttempts, wakeAt, wakeSessionId, createdAt, seenAt }`
  - `interface PodEventRecordInput { podId: string; projectId: string; goalId?: string | null; revision?: number | null; kind: string; severity: 'p1'|'p2'|'p3'; reason: 'decision'|'result'|'blocked'|'progress'|'message'; title: string; summary?: string | null; refs?: Array<{ kind: string; id: string }>; dedupeKey: string; audience: 'human'|'lead'|'none'; wakeState?: 'none'|'pending' }`
  - `class PodEventService { constructor(deps: { store: PodStore; mafwDir?: string; now?(): string }); record(input: PodEventRecordInput): PodEventRow; list(podId, opts?): { items: PodEventRow[]; unread: number }; markSeen(podId, id): boolean; markSeenAll(podId, goalId, revision): number; pendingWakes(podId): PodEventRow[]; markWakeDelivered(id, sessionId): void; markWakeSuppressed(id): void }`
  - `PodStore` 新增：`insertEvent(row): PodEventRow`、`listEvents(podId, opts)`、`getEvent(podId,id)`、`markEventSeen(id, now)`、`markEventsSeenForGoal(podId, goalId, revision, now)`、`updateEventWake(id, patch)`、`countUnreadEvents(podId)`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-event-service.test.ts
import * as fs from 'fs';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodEventService } from '../../../src/core/pod/pod-event-service';

function make(mafwDir: string) {
  const store = new PodStore(':memory:');
  const svc = new PodEventService({ store, mafwDir, now: () => '2026-11-04T10:00:00.000Z' });
  return { store, svc };
}

const base = {
  podId: 'pod_1', projectId: 'proj', goalId: 'g1', revision: 1,
  kind: 'goal.result', severity: 'p1' as const, reason: 'result' as const,
  title: '冒烟 · PASS', summary: null, refs: [], dedupeKey: 'goal.result:g1:r1',
  audience: 'human' as const,
};

it('records once and is idempotent on dedupeKey', () => {
  const mafwDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-events-'));
  const { svc } = make(mafwDir);
  const a = svc.record(base);
  const b = svc.record({ ...base, title: 'different title' });
  expect(b.id).toBe(a.id);
  expect(b.title).toBe('冒烟 · PASS');
  expect(svc.list('pod_1').items).toHaveLength(1);
});

it('writes an audit file under <mafwDir>/pods/<podId>/events', () => {
  const mafwDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-events-'));
  const { svc } = make(mafwDir);
  const row = svc.record(base);
  const dir = path.join(mafwDir, 'pods', 'pod_1', 'events');
  expect(fs.readdirSync(dir).some((f) => f.includes(row.id))).toBe(true);
});

it('revision 2 of the same goal produces a new event', () => {
  const mafwDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-events-'));
  const { svc } = make(mafwDir);
  svc.record(base);
  svc.record({ ...base, revision: 2, dedupeKey: 'goal.result:g1:r2' });
  expect(svc.list('pod_1').items).toHaveLength(2);
});

it('seen is idempotent and scoped to one revision', () => {
  const mafwDir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-events-'));
  const { svc } = make(mafwDir);
  svc.record(base);
  svc.record({ ...base, revision: 2, dedupeKey: 'goal.result:g1:r2' });
  expect(svc.markSeenAll('pod_1', 'g1', 1)).toBe(1);
  expect(svc.markSeenAll('pod_1', 'g1', 1)).toBe(0);
  expect(svc.list('pod_1', { state: 'unread' }).items).toHaveLength(1);
});

it('a file write failure does not lose the event', () => {
  const { svc } = make('Z:\\nonexistent\\dir');
  expect(() => svc.record(base)).not.toThrow();
  expect(svc.list('pod_1').items).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-service.test.ts --runInBand`
Expected: FAIL — `Cannot find module '../../../src/core/pod/pod-event-service'`

- [ ] **Step 3: Add the table + store methods**

表（追加到 `pod-store.ts` 的建表块，紧跟 `pod_message_deliveries` 之后）：

```sql
CREATE TABLE IF NOT EXISTS pod_events (
  id TEXT PRIMARY KEY,
  pod_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  goal_id TEXT,
  revision INTEGER,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL,
  reason TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  refs_json TEXT,
  dedupe_key TEXT NOT NULL,
  audience TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'unread',
  wake_state TEXT NOT NULL DEFAULT 'none',
  wake_attempts INTEGER NOT NULL DEFAULT 0,
  wake_at TEXT,
  wake_session_id TEXT,
  created_at TEXT NOT NULL,
  seen_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pod_events_dedupe ON pod_events(pod_id, dedupe_key);
CREATE INDEX IF NOT EXISTS idx_pod_events_state ON pod_events(pod_id, state, created_at);
CREATE INDEX IF NOT EXISTS idx_pod_events_wake ON pod_events(pod_id, wake_state);
```

`insertEvent` 用 `INSERT ... ON CONFLICT(pod_id, dedupe_key) DO NOTHING`，随后按 `(pod_id, dedupe_key)` 读回并返回既有行——这就是幂等的实现。

- [ ] **Step 4: Implement `PodEventService`**

`record()`：生成 `id = evt_<nowMs>_<6 rand>`；`store.insertEvent()`；随后 best-effort 写 `path.join(mafwDir,'pods',podId,'events',\`${createdAt}-${id}.json\`)`（`fs.mkdirSync(recursive)` + `writeFileSync`），**整段 try/catch 吞掉异常只 log**。`markSeen` / `markSeenAll` / `pendingWakes` / `markWakeDelivered` / `markWakeSuppressed` 都是薄封装。

- [ ] **Step 5: Run test to verify it passes**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-service.test.ts --runInBand`
Expected: PASS（5 个用例）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-event-service.ts gateway/tests/unit/pod/pod-event-service.test.ts
git commit -m "feat(gateway): add pod_events store and service with file audit"
```

---

### Task 3: 写点接线（归档全 verdict + 消息唯一收口）

**Files:**
- Modify: `gateway/src/core/pod/pod-store.ts`（`insertMessage` 末尾触发回调；新增 `onMessageInserted(cb)`）
- Modify: `gateway/src/index.ts`（`finishPodGoal` 写 p1/p3；构造 service 并注册消息回调）
- Test: `gateway/tests/unit/pod/pod-event-write-points.test.ts`

**Interfaces:**
- Consumes: `PodEventService.record`（Task 2）
- Produces: `PodStore.onMessageInserted((row: PodMessageRow) => void): void`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-event-write-points.test.ts
// 证明三条消息路径（REST service / decision note / A2A bridge）都经过 insertMessage，
// 且注册的回调对每条都触发——这是 C-A 的回归。
import { PodStore } from '../../../src/core/pod/pod-store';

it('insertMessage fires the registered hook for every write path', () => {
  const store = new PodStore(':memory:');
  const seen: string[] = [];
  store.onMessageInserted((row) => seen.push(row.id));
  store.insertMessage({ id: 'm1', podId: 'p', fromMemberId: 'a', toMemberId: 'lead', kind: 'escalation', body: 'x', now: 't' });
  store.insertMessage({ id: 'm2', podId: 'p', fromMemberId: 'b', toMemberId: null, kind: 'note', body: 'y', now: 't' });
  expect(seen).toEqual(['m1', 'm2']);
});

it('classifies an A2A-shaped escalation to lead as p2', () => {
  const store = new PodStore(':memory:');
  const events: any[] = [];
  store.onMessageInserted((row) => {
    const c = classifyMemberMessage({ kind: row.kind, toMemberId: row.toMemberId, leadMemberId: 'lead' });
    events.push(c);
  });
  store.insertMessage({ id: 'm3', podId: 'p', fromMemberId: 'builder', toMemberId: 'lead', kind: 'escalation', body: 'blocked', now: 't' });
  expect(events[0]).toMatchObject({ severity: 'p2', audience: 'lead' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-write-points.test.ts --runInBand`
Expected: FAIL — `store.onMessageInserted is not a function`

- [ ] **Step 3: Implement the hook + archive write**

`PodStore`：字段 `private messageHooks: Array<(row: PodMessageRow) => void> = []`；`onMessageInserted(cb)` 追加；`insertMessage` 在 `return` 前遍历调用（每个 try/catch，fail-open）。
`index.ts`：构造 `const podEventService = new PodEventService({ store: podStore, mafwDir })`，并注册消息钩子：取该 Pod 的 lead 成员 id（`podStore.listMembers(podId).find((m) => m.role === 'lead')?.id ?? null`），调 `classifyMemberMessage({ kind: row.kind, toMemberId: row.toMemberId, leadMemberId })`，拿 `projectId` 后 `record({ ...cls, podId, projectId, goalId: null, dedupeKey: memberDedupeKey(row.kind, row.id, row.toMemberId) })`。
`finishPodGoal` 在写 decision note 之后、archive 之前：`const cls = classifyGoalArchive({ verdict })`；`record({ ...cls, podId, projectId, goalId, revision: activeRevision, title, dedupeKey: goalDedupeKey(goalId, activeRevision) })`。

- [ ] **Step 4: Run tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-write-points.test.ts tests/unit/goal --runInBand`
Expected: PASS（含既有 goal 套件不回归）

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/pod/pod-store.ts gateway/src/index.ts gateway/tests/unit/pod/pod-event-write-points.test.ts
git commit -m "feat(gateway): write pod events at archive and message insert chokepoints"
```

---

### Task 4: `GET /api/presence` 跨项目聚合

**Files:**
- Create: `gateway/src/core/pod/pod-presence.ts`
- Create: `gateway/src/routes/presence.ts`
- Modify: `gateway/src/routes/route-catalog.ts`
- Modify: `gateway/src/index.ts`（挂路由）
- Test: `gateway/tests/unit/pod/pod-presence.test.ts`

**Interfaces:**
- Consumes: `PodStore.listPods()`、`PodService.views(podId)`、`PodTaskService` 的任务行、`projectPodAttention`
- Produces:
  - `interface PodPresenceItem { podId; projectId; projectName; goalId; title; phase; node: string|null; progress: { current: number; total: number } | null; startedAt: string; updatedAt: string }`
  - `interface PodPresence { running: PodPresenceItem[]; attention: { count: number; items: PodAttentionItem[] }; unreadResults: { count: number; latest: PodPresenceItem | null } }`
  - `buildPodPresence(inputs: Array<{ podId; projectId; projectName; goals: PodGoalView[]; tasks: Array<{ goalId: string|null; status: string }>; attention: PodAttentionItem[] }>): PodPresence`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-presence.test.ts
import { buildPodPresence } from '../../../src/core/pod/pod-presence';

const goal = (over: any) => ({
  goalId: 'g1', title: '冒烟', phase: 'EXECUTING', status: 'active', verdict: null,
  resultReady: false, endedAt: null, startedAt: '2026-11-04T00:00:00Z', currentAssignment: null, ...over,
});

it('counts only non-terminal goals and derives progress from tasks', () => {
  const out = buildPodPresence([{
    podId: 'p1', projectId: 'proj', projectName: 'mafw',
    goals: [goal({}), goal({ goalId: 'g2', status: 'done', endedAt: '2026-11-04T01:00:00Z' })],
    tasks: [{ goalId: 'g1', status: 'done' }, { goalId: 'g1', status: 'review' }, { goalId: 'g1', status: 'pending' }],
    attention: [],
  }]);
  expect(out.running).toHaveLength(1);
  expect(out.running[0].progress).toEqual({ current: 1, total: 3 });
});

it('progress is null when the goal has no tasks', () => {
  const out = buildPodPresence([{ podId: 'p1', projectId: 'proj', projectName: 'mafw', goals: [goal({})], tasks: [], attention: [] }]);
  expect(out.running[0].progress).toBeNull();
});

it('unread results exclude cancelled goals and pick the latest', () => {
  const out = buildPodPresence([{
    podId: 'p1', projectId: 'proj', projectName: 'mafw', tasks: [], attention: [],
    goals: [goal({ goalId: 'old', status: 'done', resultReady: true, endedAt: '2026-11-04T01:00:00Z' }),
            goal({ goalId: 'new', status: 'done', resultReady: true, endedAt: '2026-11-04T02:00:00Z' })],
  }]);
  expect(out.unreadResults.count).toBe(2);
  expect(out.unreadResults.latest?.goalId).toBe('new');
});

it('folds worktree pods into the parent project', () => {
  const out = buildPodPresence([
    { podId: 'p1', projectId: 'C:/proj', projectName: 'proj', goals: [goal({})], tasks: [], attention: [] },
    { podId: 'p2', projectId: 'C:/proj-wt-x', parentProjectId: 'C:/proj', projectName: 'proj', goals: [goal({ goalId: 'g9' })], tasks: [], attention: [] },
  ]);
  expect(out.running.map((r) => r.projectId)).toEqual(['C:/proj', 'C:/proj']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-presence.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `buildPodPresence`**

`projectId` 取 `input.parentProjectId ?? input.projectId`（调用方用 `parentProjectDirForWorktree` 算好）；`running` 过滤 `status === 'active' && !endedAt`；`progress` 用该 goalId 的 tasks 计数（`total>0` 才有值，`current` 只数 `status === 'done'`）；`node` 取 `currentAssignment?.node ?? null`；`unreadResults` 过滤 `resultReady === true`，按 `endedAt` 倒序取第一条。

- [ ] **Step 4: Implement the route + catalog**

`gateway/src/routes/presence.ts` 导出 `handlePresence(deps: { list: () => PodPresence | Promise<PodPresence> }): Promise<{ status: number; body: unknown }>`——**handler 只返回 `{status, body}`，不碰 `res`**（便于单测；`index.ts` 负责 `writeHead` + `end`，这是 `routes/agent-priors.ts` 的既有风格）。异常 → `{ status: 500, body: { error } }`。
`route-catalog.ts` 增：`{ method: 'GET', path: '/api/presence', operationId: 'presence.get', tags: ['presence'] }`。
`index.ts` 在 dashboard 兜底委托**之前**注册。

- [ ] **Step 5: Run tests + emit contracts**

Run: `cd gateway && npx jest tests/unit/pod/pod-presence.test.ts --runInBand && npm run emit:openapi`
Expected: PASS；`gateway-paths.json` 出现 `presence.get`

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/pod/pod-presence.ts gateway/src/routes/presence.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/pod/pod-presence.test.ts gateway/gateway-paths.json
git commit -m "feat(gateway): add cross-project presence projection and route"
```

---

### Task 5: 事件路由 + `pod.event` SSE

**Files:**
- Create: `gateway/src/routes/pod-events.ts`
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Modify: `gateway/src/runtime/mafw-vocabulary.ts`、`gateway/src/runtime/event-flow-matrix.ts`、`gateway/src/runtime/contract-events.ts`
- Modify: `packages/gateway-sdk/src/events.ts`
- Test: `gateway/tests/unit/pod/pod-events-route.test.ts`

**Interfaces:**
- Consumes: `PodEventService.list/markSeen/markSeenAll`（Task 2）
- Produces: 路由 `get/list`、`seen`、`seenAll`；SSE 事件 `pod.event`，payload `{ podId, eventId, goalId, revision, kind, severity }`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-events-route.test.ts
import { handlePodEvents } from '../../../src/routes/pod-events';

it('lists unread events', async () => {
  const h = handlePodEvents({
    service: { list: (podId, opts) => ({ items: [{ id: 'e1' }], unread: 1 }) } as any,
  });
  const res = await h({ method: 'GET', podId: 'p1', query: { state: 'unread' } });
  expect(res.status).toBe(200);
  expect(res.body.items).toHaveLength(1);
});

it('seenAll requires revision', async () => {
  const h = handlePodEvents({ service: { markSeenAll: () => 0 } as any });
  const res = await h({ method: 'POST', podId: 'p1', action: 'seenAll', body: { goalId: 'g1' } });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-events-route.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Implement handler + routes + catalog**

四条：`GET /api/pods/:podId/events`、`POST /api/pods/:podId/events/:id/seen`、`POST /api/pods/:podId/events/seen`。`seenAll` body 必须 `{ goalId: string, revision: number }`，缺任一项 400。导出 `handlePodEvents(deps): (req: { method; podId; id?; action?; query?; body? }) => Promise<{ status: number; body: unknown }>`——同上，不碰 `res`。
catalog 增 `pod.events.list` / `pod.events.seen` / `pod.events.seenAll`。

- [ ] **Step 4: Wire the SSE vocabulary chain**

在下列位置各加一行（与既有 `pod.updated` 同款）：
`packages/gateway-sdk/src/events.ts` 的 `RUNTIME_EVENT_TYPES`；`gateway/src/runtime/mafw-vocabulary.ts` 的 `MAFW`；`event-flow-matrix.ts` 加一行 `pod.event`（broadcast，无 session 作用域）；`contract-events.ts` 的 `GATEWAY_PRODUCED` 与 `requiredFieldsOf`（必须含 `podId`、`eventId`、`severity`）；`packages/desktop/src/renderer/mafw/session-events.ts` 的 `ShellHandledType` 与覆盖断言；`packages/tui/tests/event-coverage.test.ts` 的 `KNOWN_EVENTS`。

- [ ] **Step 5: Run tests + emit both contracts**

Run: `cd gateway && npx jest tests/unit/pod/pod-events-route.test.ts tests/unit/api-contract --runInBand && npm run emit:openapi && npm run emit:runtime-contract`
Expected: PASS；两个契约文件都更新

- [ ] **Step 6: Commit**

```bash
git add gateway/src packages/gateway-sdk/src packages/desktop/src/renderer/mafw/session-events.ts packages/tui/tests/event-coverage.test.ts
git commit -m "feat(gateway): expose pod events routes and pod.event sse"
```

---

### Task 6: Lead 唤醒扫描器

**Files:**
- Create: `gateway/src/core/pod/pod-event-wake.ts`
- Modify: `gateway/src/index.ts`（启动扫描 + 60s 间隔 + 事件落库后立即触发）
- Test: `gateway/tests/unit/pod/pod-event-wake.test.ts`

**Interfaces:**
- Consumes: `PodEventService.pendingWakes/markWakeDelivered/markWakeSuppressed`；`ensureLead`；`busySessions`；`RunStateService.active`
- Produces:
  - `class PodEventWake { constructor(deps: PodEventWakeDeps); scan(podId?: string): Promise<{ delivered: number; suppressed: number }>; notify(): void }`
  - `interface PodEventWakeDeps { events: PodEventService; store: PodStore; leadMemberId(podId): string | null; ensureLead(podId): Promise<{ sessionId: string }>; isBusy(sessionId): boolean; isSuspended(sessionId): boolean; isPodPaused(podId): boolean; promptAsync(input: { sessionID: string; message: string }): Promise<void>; deliveryDelivered(messageId, memberId): boolean; commitDelivered(ids: string[], sessionId: string): void; now?(): number; budget?: { perHour: number; dedupeMs: number } }`

- [ ] **Step 1: Write the failing test**

```ts
// gateway/tests/unit/pod/pod-event-wake.test.ts
import { PodEventWake } from '../../../src/core/pod/pod-event-wake';

function harness(over: Partial<any> = {}) {
  const prompts: any[] = [];
  const suppressed: string[] = [];
  const delivered: string[] = [];
  const events = {
    pendingWakes: () => over.pending ?? [
      { id: 'e1', podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'blocked', summary: null, refsJson: null, severity: 'p2' },
    ],
    markWakeDelivered: (_id: string) => delivered.push(_id),
    markWakeSuppressed: (_id: string) => suppressed.push(_id),
    list: () => ({ items: [], unread: 0 }),
    record: () => ({}),
  };
  const wake = new PodEventWake({
    events: events as any,
    store: { getMemberBySession: () => ({ id: 'lead' }) } as any,
    leadMemberId: () => 'lead',
    ensureLead: async () => ({ sessionId: 'ses_lead' }),
    isBusy: () => over.busy ?? false,
    isSuspended: () => over.suspended ?? false,
    isPodPaused: () => over.paused ?? false,
    promptAsync: async (i) => { prompts.push(i); },
    deliveryDelivered: () => over.alreadyDelivered ?? false,
    commitDelivered: () => {},
    now: () => over.now ?? 1_000_000,
    budget: { perHour: 6, dedupeMs: 600_000 },
  });
  return { wake, prompts, suppressed, delivered };
}

it('merges all pending events into one prompt', async () => {
  const h = harness({ pending: [
    { id: 'e1', podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'a', summary: null, refsJson: null, severity: 'p2' },
    { id: 'e2', podId: 'p', goalId: 'g1', kind: 'member.request', title: 'b', summary: null, refsJson: null, severity: 'p2' },
  ] });
  await h.wake.scan('p');
  expect(h.prompts).toHaveLength(1);
  expect(h.prompts[0].message).toContain('2 条待处理');
  expect(h.delivered).toEqual(['e1', 'e2']);
});

it('does not wake when the message was already delivered', async () => {
  const h = harness({ alreadyDelivered: true });
  await h.wake.scan('p');
  expect(h.prompts).toHaveLength(0);
  expect(h.delivered).toEqual(['e1']);
});

it('stays pending while busy, suspended or paused', async () => {
  for (const flag of ['busy', 'suspended', 'paused'] as const) {
    const h = harness({ [flag]: true } as any);
    await h.wake.scan('p');
    expect(h.prompts).toHaveLength(0);
    expect(h.delivered).toHaveLength(0);
  }
});

it('suppresses beyond the hourly budget', async () => {
  const h = harness({ pending: Array.from({ length: 8 }, (_, i) => ({
    id: `e${i}`, podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'x', summary: null, refsJson: null, severity: 'p2',
  })) });
  const out = await h.wake.scan('p');
  expect(out.delivered).toBe(6);
  expect(out.suppressed).toBe(2);
});

it('a fresh instance still sees pending wakes (restart recovery)', async () => {
  // 同一个 events 端口两次 scan：模拟 gateway 重启后 pending 仍在
  const pending = [{ id: 'e1', podId: 'p', goalId: 'g1', kind: 'member.escalation', title: 'a', summary: null, refsJson: null, severity: 'p2' }];
  const first = harness({ pending: [] as any });
  await first.wake.scan('p');
  const second = harness({ pending });
  await second.wake.scan('p');
  expect(second.prompts).toHaveLength(1);
  expect(second.delivered).toEqual(['e1']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-wake.test.ts --runInBand`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PodEventWake`**

`scan()` 顺序：`pendingWakes` → 逐条判断（`deliveryDelivered(messageId, lead)` → delivered 直接落定；`isPodPaused` / `isSuspended` / `isBusy` → 保留 pending 并 return）；预算计数（按 `now - 1h` 内 `wakeAt` 数量）；未超预算的合成一条简报 `[POD EVENT]\nN 条待处理：...`，一次 `promptAsync`；成功则逐条 `markWakeDelivered` + `commitDelivered`，失败保持 pending 且 `wakeAttempts++`。

- [ ] **Step 4: Wire in `index.ts`**

启动时 `void wake.scan()`；`setInterval(() => void wake.scan(), 60_000).unref()`；`PodEventService.record` 返回 p2 时 `wake.notify()`（一次 microtask 延迟，合并同批）。

- [ ] **Step 5: Run tests**

Run: `cd gateway && npx jest tests/unit/pod/pod-event-wake.test.ts --runInBand`
Expected: PASS（4 个用例）

- [ ] **Step 6: Commit**

```bash
git add gateway/src/core/pod/pod-event-wake.ts gateway/src/index.ts gateway/tests/unit/pod/pod-event-wake.test.ts
git commit -m "feat(gateway): wake lead from p2 events with budget and pause gates"
```

---

### Task 7: 桌面 presence 轮询 + 托盘三层

**Files:**
- Create: `packages/desktop/src/main/presence-model.ts`
- Create: `packages/desktop/src/main/presence-poller.ts`
- Modify: `packages/desktop/src/main/tray.ts`、`packages/desktop/src/main/index.ts`
- Test: `packages/desktop/src/main/presence-model.test.ts`

**Interfaces:**
- Consumes: `GET /api/presence`（Task 4）返回的 `PodPresence`
- Produces:
  - `podPresence(payload: PodPresence | null, prev?: { failures: number }): { trayState: 'idle'|'running'|'attention'; progress: number; tooltip: string; clickTarget: { podId: string; goalId: string } | null }`
  - `startPresencePolling(opts: { getBaseUrl(): string | null; onSnapshot(p: ReturnType<typeof podPresence>, raw: PodPresence | null): void; intervalMs?: number; fetchFn?: typeof fetch }): () => void`
  - `tray.updateTrayPresence(state, label: string)`、`tray.setTrayClickTarget(target | null)`

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/main/presence-model.test.ts
import { assert } from 'node:assert/strict'
import { podPresence } from './presence-model'

assert.equal(podPresence(null).trayState, 'idle')

const running = {
  running: [{ podId: 'p1', projectId: 'a', projectName: 'mafw', goalId: 'g1', title: '冒烟', phase: 'EXECUTING', node: 'execute', progress: { current: 2, total: 3 }, startedAt: 't', updatedAt: 't' }],
  attention: { count: 0, items: [] },
  unreadResults: { count: 0, latest: null },
}
const p = podPresence(running)
assert.equal(p.trayState, 'running')
assert.equal(p.progress, 2 / 3)
assert.match(p.tooltip, /冒烟 · execute 2\/3/)

assert.equal(podPresence({ ...running, attention: { count: 1, items: [{ id: 'x' }] } }).trayState, 'attention')
assert.equal(podPresence({ ...running, running: [], unreadResults: { count: 1, latest: running.running[0] } }).trayState, 'attention')
assert.equal(podPresence({ ...running, running: [{ ...running.running[0], progress: null }] }).progress, 2) // indeterminate
assert.equal(podPresence(null, { failures: 3 }).trayState, 'idle')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/presence-model.test.ts`
Expected: FAIL — cannot find `./presence-model`

- [ ] **Step 3: Implement `presence-model.ts`**

`trayState`：`attention.count > 0 || unreadResults.count > 0` → `'attention'`；否则 `running.length > 0` → `'running'`；否则 `'idle'`。`progress`：任一 running 有 `{current,total}` → `current/total`；有 running 但都无进度 → `2`（Electron 不确定态）；否则 `-1`。`tooltip`：`MAFW — <n> 个 Goal 在跑 · <title> <node> <cur>/<total> · <n> pending approval`（空段省略，单 Goal 省计数）。

- [ ] **Step 4: Implement poller + tray updates**

`presence-poller.ts` 复制 `tray-status.ts` 的 raw-fetch + `AbortSignal.timeout(5000)` 模式；连续 3 次失败 → `onSnapshot(podPresence(null,{failures:3}), null)`。
`tray.ts`：新增模块级 `presenceState` / `presenceLabel` / `clickTarget`；`applyStatus()` 改用 `trayTooltip(pendingCount, presenceLabel)`；`buildMenu()` 顶部插入状态行（`clickTarget` 存在时 `click: () => openGoal(clickTarget)`，否则 `enabled:false`），并保留既有 Open / close-to-tray / Quit；左键 `handleTrayClick` **不动**。
**图标态**：在 `packages/desktop/resources/` 新增 `tray-running.png` 与 `tray-attention.png`（16/32px，复用现有 `tray-icon` 母版加角点），`createTray` 时预载三张 `nativeImage`，`applyStatus()` 按 `presenceState` 选图（`tray.setImage`）。图标缺失时回退现有单图并 log warn——不要让托盘创建失败。
`index.ts`：启动 poller，`onSnapshot` 里调 `updateTrayPresence` + `win.setProgressBar(...)` + `win.setOverlayIcon(...)`。

- [ ] **Step 5: Run tests + typecheck**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/presence-model.test.ts && npx tsgo --noEmit -p tsconfig.json`
Expected: PASS + rc=0

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/presence-model.ts packages/desktop/src/main/presence-poller.ts packages/desktop/src/main/presence-model.test.ts packages/desktop/src/main/tray.ts packages/desktop/src/main/index.ts
git commit -m "feat(desktop): poll cross-project presence and drive tray/taskbar"
```

---

### Task 8: attention 通知差集与通知去重

**Files:**
- Create: `packages/desktop/src/main/attention-diff.ts`
- Create: `packages/desktop/src/main/notify-state.ts`
- Modify: `packages/desktop/src/main/index.ts`、`packages/desktop/src/main/mafw-ipc.ts`
- Test: `packages/desktop/src/main/attention-diff.test.ts`

**Interfaces:**
- Produces:
  - `diffAttention(prev: readonly string[], next: ReadonlyArray<{ id: string }>): { added: Array<{ id: string }>; removed: string[] }`
  - `class NotifyState { constructor(file?: string); hasAttention(id): boolean; markAttention(id): void; pruneAttention(alive: string[]): void; hasResult(goalId, revision): boolean; markResult(goalId, revision): void; pruneResult(alive: Array<[string, number]>): void }`
  - IPC：`mafw-navigate-goal`

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/main/attention-diff.test.ts
import { assert } from 'node:assert/strict'
import { diffAttention } from './attention-diff'

assert.deepEqual(diffAttention(['a'], [{ id: 'a' }, { id: 'b' }]).added, [{ id: 'b' }])
assert.deepEqual(diffAttention(['a', 'b'], [{ id: 'b' }]).removed, ['a'])
assert.deepEqual(diffAttention([], [{ id: 'x' }]).added, [{ id: 'x' }])
assert.deepEqual(diffAttention(['x'], []).removed, ['x'])
// revision 变更算新 id，因为 id 里带 r<n>
assert.deepEqual(diffAttention(['g1:plan_approval:r1'], [{ id: 'g1:plan_approval:r2' }]).added, [{ id: 'g1:plan_approval:r2' }])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/attention-diff.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `attention-diff.ts` + `notify-state.ts`**

`NotifyState` 用 `electron-store("mafw-notify")` 存两个数组：`attentionIds`、`resultKeys`（`<goalId>:r<revision>`）。构造时可注入文件路径便于测试。

- [ ] **Step 4: Wire notifications**

presence 快照回调里：`diffAttention(prevIds, payload.attention.items)`；对每个 `added` 若 `!notify.hasAttention(id)` → `new Notification({ title: '需要你', body: item.title })` + `show()` + `markAttention(id)`；`pruneAttention(alive)`。
结果通知：`unreadResults.latest` 且 `!notify.hasResult(goalId, revision)` → `new Notification({ title: '<title> · <verdict>', body: 'Goal 已完成' })` + 提示音（`shell.beep()` fail-open）；`pruneResult(aliveKeys)`。
IPC `mafw-navigate-goal`：`ipcMain.handle("mafw-navigate-goal", (_e, t) => { showOrCreateWindow(); win?.webContents.send("mafw-navigate-goal", t) })`。

- [ ] **Step 5: Run tests**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/main/attention-diff.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/main/attention-diff.ts packages/desktop/src/main/notify-state.ts packages/desktop/src/main/attention-diff.test.ts packages/desktop/src/main/index.ts packages/desktop/src/main/mafw-ipc.ts
git commit -m "feat(desktop): notify new attention and results exactly once"
```

---

### Task 9: 桌面事件 store、inbox 与 `viewedResults` 双读迁移

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-events.ts`
- Modify: `packages/desktop/src/renderer/mafw/pod-rail-badge.ts`、`pod-model.ts`、`MafwShell.tsx`、`components/PodResultView.tsx`、`sse/handlers/dock.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-events.test.ts`

**Interfaces:**
- Consumes: `window.api.mafw.pod.events.*`（Task 5）、`pod.event` SSE
- Produces:
  - `interface PodEventItem { id; goalId; revision; kind; severity; title; summary; state; createdAt }`
  - `isResultViewed(key: string, events: PodEventItem[], legacy: readonly string[]): boolean`
  - `shouldMarkSeen(result: { status: 'fulfilled' | 'rejected' | 'pending' }): boolean`
  - `listUnread(events): PodEventItem[]`（p1 优先，再按 createdAt 倒序）

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/renderer/mafw/pod-events.test.ts
import { assert } from 'node:assert/strict'
import { isResultViewed, listUnread, shouldMarkSeen } from './pod-events'

assert.equal(isResultViewed('g1:r1', [{ id: 'e', goalId: 'g1', revision: 1, state: 'seen', kind: 'goal.result', severity: 'p1', title: '', summary: null, createdAt: '' }], []), true)
assert.equal(isResultViewed('g1:r2', [{ id: 'e', goalId: 'g1', revision: 1, state: 'seen', kind: 'goal.result', severity: 'p1', title: '', summary: null, createdAt: '' }], []), false)
assert.equal(isResultViewed('g1:r2', [], ['g1:r2']), true) // legacy localStorage 仍生效

const items = [
  { id: 'a', goalId: 'g', revision: 1, kind: 'goal.result', severity: 'p3', title: '', summary: null, state: 'unread', createdAt: '2' },
  { id: 'b', goalId: 'g', revision: 1, kind: 'goal.result', severity: 'p1', title: '', summary: null, state: 'unread', createdAt: '1' },
]
assert.deepEqual(listUnread(items).map((i) => i.id), ['b', 'a'])

// 结果接口失败时绝不能标 seen（否则角标清了但用户什么都没看到）
assert.equal(shouldMarkSeen({ status: 'fulfilled' }), true)
assert.equal(shouldMarkSeen({ status: 'rejected' }), false)
assert.equal(shouldMarkSeen({ status: 'pending' }), false)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/desktop && node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/pod-events.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `pod-events.ts` + dual-read**

`isResultViewed` = events 中存在同 goal+revision 且 `state === 'seen'` → true；否则 legacy key 命中 → true；否则 false。
把四个消费点改成双读：`MafwShell.podResultDot`、`pod-model.latestUnviewedResult`、`MafwShell.openPendingResult`、`PodResultView.markResultViewedAfterLoad`（后者改为**结果数据加载成功后**调 `pod.events.seenAll({ goalId, revision })`，不再写 localStorage）。

- [ ] **Step 4: Wire SSE + inbox**

`pod.event` → `pod-events` store 追加并 `refresh()`；工作台「工作」面 `result_ready` 分组里未查看行加「未查看」标记；进 Goal 详情后（结果加载成功）清标记。

- [ ] **Step 5: Run desktop full suite + typecheck**

Run: `cd packages/desktop && npm test && npx tsgo --noEmit -p tsconfig.json`
Expected: 全绿；相比基线 2821 只增不减

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/mafw/pod-events.ts packages/desktop/src/renderer/mafw/pod-events.test.ts packages/desktop/src/renderer/mafw/pod-rail-badge.ts packages/desktop/src/renderer/mafw/pod-model.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/PodResultView.tsx packages/desktop/src/renderer/mafw/sse/handlers/dock.ts
git commit -m "feat(desktop): pod event inbox with dual-read result viewed state"
```

---

### Task 10: 契约、文档与真机验收

**Files:**
- Modify: `AGENTS.md`（新增批次小节）、`packages/gateway-sdk/src/client.ts`（`pod.events.*`、`presence.get`）
- Test: `gateway/tests/unit/api-contract`（既有）、`packages/gateway-sdk/tests/contract.test.ts`（既有）

- [ ] **Step 1: SDK 方法 + 契约**

`packages/gateway-sdk/src/client.ts` 增 `presence.get()`、`pod.events.list/seen/seenAll`；`packages/gateway-sdk/tests/contract.test.ts` 增对应用例（每个方法打一次假 fetch，断言 method+path）。

- [ ] **Step 2: Run contract tests**

Run: `cd packages/gateway-sdk && npm test`
Expected: 199 + 4 全绿

- [ ] **Step 3: 真机验收（按 spec §9 的 14 条）**

至少跑：跨项目完成通知、FAIL 路径、revision 2、Lead 唤醒 + 10min 去重、忙时合并、Pod 暂停、gateway 重启补发、p0 attention 通知与重启不重发。

- [ ] **Step 4: 更新 `AGENTS.md`**

新增 `### 5.29 Pod 事件层与常驻注意力（2026-11-04）`，记录：`pod_events` 模型、分级规则、`GET /api/presence`、Lead 唤醒闸门、托盘三层与去重键、真实测试数、真机验收结论、已知边界（托盘被 Windows 折叠、A2A 不外投事件、`reindex` 重置 state）。

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md packages/gateway-sdk/src packages/gateway-sdk/tests
git commit -m "docs: record pod event layer and ambient presence batch"
```
