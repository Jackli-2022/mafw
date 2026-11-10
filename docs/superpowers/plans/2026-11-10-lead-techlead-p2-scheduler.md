# Lead / Tech Lead P2：调度器与 COW fork 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把人的注意力当 CPU 调度：person 事项优先、健康状态不打扰、多个 Goal 可并发且新工作不抢占人类介入；新 Goal 从当前话题 COW 分叉；话题边界自动提议但可撤销。

**Architecture:** P2 在现有 Pod / Goal / NodeDriver 之上加三层纯逻辑：`attention.ts`（从 `PodGoalView` 派生 person/team/system stage）、`pod-scheduler.ts`（槽位 + 人类介入槽 + 队列排序）、`topic-boundary.ts` / `topic-fork.ts`（边界检测与 COW 引用计划）。服务层只做持久化与编排：attention 复用现有投影，不新建第二套状态；`topic_boundary` / `topic_fork` 是新表；fork 复用 P1 的 topic summary + `sourceRef`，不复制 transcript；调度开关默认关闭，COW fork 默认开。

**Tech Stack:** TypeScript、better-sqlite3、jest（gateway）、node:test + `@mafw/test-shim`（desktop）、SolidJS、`@mafw/ui` v2、opencode 宿主插件 hooks。

**Spec:** `docs/superpowers/specs/2026-11-10-lead-techlead-p2-scheduler-design.md`（父设计 `docs/superpowers/specs/2026-11-10-lead-techlead-thread-handoff-design.md`，前置 P0/P1）

> 测试片段里的 `view()` / `goal()` / `msg()` / `topic()` 是各测试文件内的 fixture helper，字段与本计划 Interfaces 一致；不要求跨文件共享。

## Global Constraints

- **person 只在「没有人就无法继续」时出现**：answer / plan approval / review ready / blocked / failed；reviewing 中的 Goal 是 team/working，健康状态绝不进 person。
- **count = list 长度**：任何 stage/attention 的计数必须等于它链接的列表长度，不得另算。
- **新 Goal 不抢占**：普通队列先来先服务 + priority；人类介入槽固定 **1** 个，只保护已在运行且进入 person 阶段的 Goal，新 Goal 不能占用。
- **Pause 不硬中断运行中的 turn**；Stop 撤销授权、不再接收后续；Retry 在同一 session / worktree / branch 上结束当前 assignment 并开新 assignment。
- **COW fork 只带引用**：源 transcript 只读；新 Goal 写新记录；超过预算只带 summary + 关键决策 + 未结事项；不复制整段历史。
- **边界检测不阻塞回复**，失败 fail-open；进行中的 Goal 不自动切分；所有自动边界都有 `proposed/accepted/merged/split/undone` 状态。
- 开关：`MAFW_LEAD_SCHEDULER` 默认 **关**（灰度）、`MAFW_LEAD_AUTO_BOUNDARY` 默认 **observe**（只记录不提议）、`MAFW_LEAD_COW_FORK` 默认 **开**。
- 所有新路由进 `gateway/src/routes/route-catalog.ts`；契约产物用 `emit:openapi` + SDK `gen:api` 重新生成。
- 桌面 UI 只用 `@mafw/ui` v2；不新增裸 `<button>` / `<input>` / `title`；不显示 session id。

## Review Focus

- **健康状态不得冒充 person**：reviewing / implementing / queued 的 Goal 即使有进度也不能出现在 attention 列表。
- **新 Goal 不占人类槽**：3 个 Goal 并发 + 1 个人类介入时，人必须能继续已有关注的 Goal，新 Goal 只能排队。
- **fork 不改源**：源 topic transcript / summary / state 在 fork 后逐字不变；新 Goal 只拿到引用范围与摘要。
- **边界不切断进行中的 Goal**：Goal 活跃时只允许 observe；终态后才允许 propose。
- **Pause/Stop/Retry 不混**：Pause 后恢复继续；Stop 后不再接收；Retry 不新建 Goal / revision。

---

### Task 1: Attention v2 投影 + `GET /api/attention`

**Files:**
- Modify: `gateway/src/core/pod/pod-stage.ts`（`PodAttentionItem.kind` 增加 `review` / `failed`）
- Create: `gateway/src/core/lead/attention.ts`
- Create: `gateway/src/routes/attention.ts`
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Test: `gateway/tests/unit/lead/attention.test.ts`、`gateway/tests/unit/routes/attention-route.test.ts`

**Interfaces:**
- Produces:
```ts
export type AttentionKind =
  | 'answer' | 'plan_approval' | 'review' | 'blocked' | 'failed' | 'direction_review';
export interface AttentionItem {
  id: string; goalId: string; revision: number; kind: AttentionKind;
  priority: number; coalesceKey: string; title: string;
  action: { type: string; goalId: string; questionId?: string };
}
export function deriveAttention(views: PodGoalView[]): AttentionItem[];
```
- 优先级：plan_approval 100、direction_review 90、answer 80、review 70、failed 60、blocked 50；同 goal+kind 只保留一条（`coalesceKey`），按 priority 降序、`enqueuedAt` 升序。

- [ ] **Step 1: Write the failing test**

```ts
test('person/team/system classification and coalescing', () => {
  const items = deriveAttention([
    view({ goalId: 'g1', stage: { owner: 'person', kind: 'plan_approval' }, revision: 1 }),
    view({ goalId: 'g1', stage: { owner: 'person', kind: 'plan_approval' }, revision: 1 }),
    view({ goalId: 'g2', stage: { owner: 'person', kind: 'reviewing' }, revision: 1, resultReady: true }),
    view({ goalId: 'g3', stage: { owner: 'team', kind: 'working' }, revision: 1 }),
    view({ goalId: 'g4', stage: { owner: 'person', kind: 'blocked' }, revision: 1, lastError: 'worktree_unavailable' }),
  ]);
  expect(items.map((item) => `${item.goalId}:${item.kind}`)).toEqual([
    'g1:plan_approval', 'g2:review', 'g4:failed',
  ]);
  expect(items.every((item) => item.coalesceKey.includes(item.goalId))).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/lead/attention.test.ts tests/unit/routes/attention-route.test.ts --runInBand --forceExit`
Expected: FAIL（module / handler not found）。

- [ ] **Step 3: Implement projection + route**

`deriveAttention` 只看 `PodGoalView.stage.owner/kind`、`resultReady`、`lastError`：person stage 映射 answer/plan_approval/review/blocked；`resultReady && stage.kind==='result_notified'` → review；`lastError` 且 stage 为 blocked → failed。`GET /api/attention?projectDir=` 返回 `{ items }`，按项目 Pod 的 `views()` 计算；count 由数组长度即时计算，不另存。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/core/lead/attention.ts gateway/src/core/pod/pod-stage.ts gateway/src/routes/attention.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/lead/attention.test.ts gateway/tests/unit/routes/attention-route.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(lead): derive person-first attention list"
```

---

### Task 2: 多 Goal 槽位 + 人类介入槽

**Files:**
- Create: `gateway/src/core/pod/pod-scheduler.ts`
- Modify: `gateway/src/core/pod/pod-store.ts`（`listActiveGoals`）
- Modify: `gateway/src/core/pod/pod-goal-service.ts`（`promote` / `maxConcurrentGoals` / `startQueued`）
- Create: `gateway/src/routes/scheduler.ts`
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Test: `gateway/tests/unit/pod/pod-scheduler.test.ts`、`gateway/tests/unit/pod/pod-goal-service.test.ts`、`gateway/tests/unit/routes/scheduler-route.test.ts`

**Interfaces:**
- Produces:
```ts
export interface SchedulerCandidate {
  goalId: string; active: boolean; priority: number;
  enqueuedAt: string; humanAttention: boolean;
}
export interface SchedulerPlan { start: string[]; waiting: string[]; humanSlot: boolean; capacity: number; }
export function planPromotions(input: {
  active: SchedulerCandidate[];
  queued: SchedulerCandidate[];
  maxConcurrent: number; // default 1
}): SchedulerPlan;
```
- 规则：`capacity = maxConcurrent + (active.some(c => c.humanAttention) ? 1 : 0)`；queued 按 priority 降序、enqueuedAt 升序；新 Goal 永远不能把 capacity 从 `maxConcurrent` 抬到 `maxConcurrent+1`（人类槽只由已 active 的 person Goal 触发）。

- [ ] **Step 1: Write the failing test**

```ts
test('fills normal slots and reserves the human slot for active person goals', () => {
  const base = { active: false, priority: 0, enqueuedAt: '2026-11-10T00:00:00.000Z', humanAttention: false };
  const normal = planPromotions({
    active: [{ ...base, goalId: 'a1', active: true }],
    queued: [{ ...base, goalId: 'q1' }, { ...base, goalId: 'q2' }, { ...base, goalId: 'q3' }],
    maxConcurrent: 2,
  });
  expect(normal.start).toEqual(['q1']);
  expect(normal.capacity).toBe(2);

  const human = planPromotions({
    active: [{ ...base, goalId: 'a1', active: true, humanAttention: true }],
    queued: [{ ...base, goalId: 'q1' }, { ...base, goalId: 'q2' }],
    maxConcurrent: 2,
  });
  expect(human.capacity).toBe(3);
  expect(human.start).toEqual(['q1', 'q2']);
  expect(human.humanSlot).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/pod/pod-scheduler.test.ts tests/unit/pod/pod-goal-service.test.ts tests/unit/routes/scheduler-route.test.ts --runInBand --forceExit`
Expected: FAIL（module/handler not found）。

- [ ] **Step 3: Implement slots + promote loop**

`PodStore.listActiveGoals(podId)`（`status='active'` 按 started_at 升序）。`PodGoalService` 新 deps `maxConcurrentGoals?: () => number`（env `MAFW_POD_MAX_GOALS`，默认 1）。`promote` 取 active/queued → `planPromotions` → 逐个 `startQueued`；`startQueued` 只在 `activeGoalId` 为空时写 pod 指针。`GET /api/scheduler/status` 返回 `{ capacity, active, queued, plan }`（诊断，不写库）。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/core/pod/pod-scheduler.ts gateway/src/core/pod/pod-store.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/routes/scheduler.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/pod/pod-scheduler.test.ts gateway/tests/unit/pod/pod-goal-service.test.ts gateway/tests/unit/routes/scheduler-route.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(pod): schedule multiple goals with a human slot"
```

---

### Task 3: Pause / Stop / Retry 三档语义

**Files:**
- Create: `gateway/src/routes/goal-control.ts`
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Test: `gateway/tests/unit/routes/goal-control.test.ts`

**Interfaces:**
- 路由：`POST /api/goals/:id/pause`、`POST /api/goals/:id/stop`、`POST /api/goals/:id/retry`；body 可选 `{ revision?, runId? }`。
- 行为：
  - Pause → `patchState(nextAction:'PAUSED')`，Pod 状态不变；返回 `{ status:'paused' }`。
  - Stop → `destroyAllSessions` + `patchState(nextAction:'FAILED', planApproval:null)` + archive `CANCELLED`；返回 `{ status:'stopped' }`。
  - Retry → 只允许存在 active assignment / 最近失败 run；`retryNodeRun` 或 `startGoalDirect` 在同一 worktree/branch 重试；不新建 revision。

- [ ] **Step 1: Write the failing test**

```ts
test('pause/stop/retry are distinct and do not mint revisions', async () => {
  const deps = controlDeps();
  expect((await handleGoalControl({ id: 'g1', action: 'pause' }, deps)).body).toEqual({ status: 'paused' });
  expect(deps.patchState).toHaveBeenCalledWith('g1', { nextAction: 'PAUSED' });
  expect((await handleGoalControl({ id: 'g1', action: 'stop' }, deps)).body).toEqual({ status: 'stopped' });
  expect(deps.destroySessions).toHaveBeenCalledWith('g1');
  expect((await handleGoalControl({ id: 'g1', action: 'retry' }, deps)).body).toEqual({ status: 'retried' });
  expect(deps.openNextRevision).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix gateway -- tests/unit/routes/goal-control.test.ts --runInBand --forceExit`
Expected: FAIL（handler not found）。

- [ ] **Step 3: Implement routes + wiring**

复用现有 control 分支的 `patchState` / `destroyAllSessions` / `archiveGoal` / `retryNodeRun`；retry 先查当前 run，没 run 时调用 `startGoalDirect(goalId)`（仍同一 revision）。所有 handler 返回 `{ status }`，错误用 `PodError` 状态码。

- [ ] **Step 4: Run test to verify it passes**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/routes/goal-control.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts gateway/tests/unit/routes/goal-control.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(pod): add pause/stop/retry goal semantics"
```

---

### Task 4: COW fork 数据模型 + `planFork`

**Files:**
- Modify: `gateway/src/core/lead/lead-topic-store.ts`（`forked_from` / `forked_at` / `inherited_message_range`）
- Create: `gateway/src/core/lead/topic-fork.ts`
- Create: `gateway/src/core/lead/topic-fork-store.ts`
- Test: `gateway/tests/unit/lead/topic-fork.test.ts`、`gateway/tests/unit/lead/topic-fork-store.test.ts`

**Interfaces:**
- Produces:
```ts
export interface ForkPlan {
  sourceTopicId: string;
  inheritedFrom: string; inheritedTo: string;
  mode: 'reference' | 'summary';
  summary: string;
  handoffText: string;
}
export function planFork(input: {
  topic: LeadTopicRow;
  messages: MafwMessage[];
  summary: string;
  budgetTokens?: number; // default 1200
}): ForkPlan;
export interface TopicForkRow {
  id: string; sourceTopicId: string; targetGoalId: string;
  inheritedFrom: string; inheritedTo: string; mode: string; createdAt: string;
}
export class TopicForkStore {
  constructor(db: Database);
  insert(row: TopicForkRow): void;
  listBySource(sourceTopicId: string): TopicForkRow[];
  getByGoal(goalId: string): TopicForkRow | null;
}
```
- `planFork` 取 `messageRange` 或 topic `start/end`；摘要超出预算时截断到 1200 chars；`handoffText` 只含 `<forked-topic>` 引用 + summary + 最近 5 条 user 原话，不复制完整 transcript。

- [ ] **Step 1: Write the failing test**

```ts
test('fork plan references the source range and never copies the transcript', () => {
  const plan = planFork({
    topic: topic({ id: 't1', startMessageId: 'm1', endMessageId: 'm3' }),
    messages: [msg('m1', 'user', '决定：A'), msg('m2', 'assistant', 'ok'), msg('m3', 'user', '继续 B')],
    summary: '决定：A',
    budgetTokens: 40,
  });
  expect(plan).toMatchObject({
    sourceTopicId: 't1', inheritedFrom: 'm1', inheritedTo: 'm3', mode: 'reference',
  });
  expect(plan.handoffText).toContain('<forked-topic');
  expect(plan.handoffText).toContain('Source: t1');
  expect(plan.handoffText).not.toContain('Assistant: ok');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/topic-fork.test.ts tests/unit/lead/topic-fork-store.test.ts --runInBand --forceExit`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement store + plan**

`LeadTopicStore` 增加 `forked_from` / `forked_at` / `inherited_message_range`（`ensureColumn`，旧行 null）。`topic_fork` 表 + `(source_topic_id)` / `(target_goal_id)` 索引。`planFork` 只读，不写库。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/lead-topic-store.ts gateway/src/core/lead/topic-fork.ts gateway/src/core/lead/topic-fork-store.ts gateway/tests/unit/lead/topic-fork.test.ts gateway/tests/unit/lead/topic-fork-store.test.ts
git commit -m "feat(lead): add COW fork plan and provenance store"
```

---

### Task 5: Fork 端到端（`mafw_create_goal` + handoff 引用）

**Files:**
- Modify: `gateway/src/mcp/tool-registry.ts`、`gateway/src/mcp/handlers/create-goal.ts`
- Modify: `gateway/src/core/pod/pod-tech-lead-service.ts`
- Modify: `gateway/src/core/lead/lead-handoff-service.ts`
- Modify: `gateway/src/index.ts`
- Test: `gateway/tests/unit/mcp/create-goal-fork.test.ts`、`gateway/tests/unit/pod/pod-tech-lead-fork.test.ts`

**Interfaces:**
- `mafw_create_goal` args 增加 `forkFromTopicId?: string`；`PodTechLeadGoalInput` 增加 `forkFromTopicId?: string`。
- `LeadHandoffService.buildForkForGoal(input: { projectDir; goalId; goalDir; title; sourceTopicId }): Promise<LeadHandoffPrepared | null>`：读源 topic + index rows，`planFork`，写 `<goalDir>/context/lead-handoff.md`（引用块），`sourceRef.topicId` 指向**新** topic（fork 后新 topic 行），并返回 `fork` 元数据。
- 新 topic 行写 `forkedFrom=sourceTopicId`、`forkedAt`、`inheritedMessageRange`；源 topic 行不变。

- [ ] **Step 1: Write the failing tests**

```ts
test('create_goal with forkFromTopicId writes a reference handoff and leaves the source untouched', async () => {
  const before = JSON.stringify(topics.get('t1'));
  const created = await service.createGoal({
    podId: 'pod_1', projectDir: dir, title: 'Fork', objective: 'O',
    createdBy: 'ses_lead', forkFromTopicId: 't1',
  });
  expect(JSON.parse(fs.readFileSync(created.requestPath, 'utf8')).sourceRef.topicId).toBeTruthy();
  expect(fs.readFileSync(path.join(created.goalDir!, 'context', 'lead-handoff.md'), 'utf8'))
    .toContain('<forked-topic');
  expect(JSON.stringify(topics.get('t1'))).toBe(before);
  expect(forks.getByGoal(created.goalId)?.sourceTopicId).toBe('t1');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/mcp/create-goal-fork.test.ts tests/unit/pod/pod-tech-lead-fork.test.ts --runInBand --forceExit`
Expected: FAIL（args 未透传 / fork 未写）。

- [ ] **Step 3: Implement fork path**

`handleCreateGoal` 把 `forkFromTopicId` 传给 `techLead.createGoal`；`PodTechLeadService.createGoal` 在有 fork 时走 `buildForkForGoal`（而不是当前话题 handoff），`sourceRef.topicId` 用新 topic id，`sourceRef.snapshot` 仍是 summary（≤4000）；`commit` 后写 `topic_fork`。`MAFW_LEAD_COW_FORK=0` 时忽略 fork 参数，回退 P0 handoff。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/mcp/tool-registry.ts gateway/src/mcp/handlers/create-goal.ts gateway/src/core/pod/pod-tech-lead-service.ts gateway/src/core/lead/lead-handoff-service.ts gateway/src/index.ts gateway/tests/unit/mcp/create-goal-fork.test.ts gateway/tests/unit/pod/pod-tech-lead-fork.test.ts
git commit -m "feat(lead): fork new goals from a source topic"
```

---

### Task 6: 自动边界检测 + `topic_boundary` store

**Files:**
- Create: `gateway/src/core/lead/topic-boundary.ts`
- Create: `gateway/src/core/lead/topic-boundary-store.ts`
- Test: `gateway/tests/unit/lead/topic-boundary.test.ts`、`gateway/tests/unit/lead/topic-boundary-store.test.ts`

**Interfaces:**
- Produces:
```ts
export type BoundaryTrigger = 'explicit' | 'semantic' | 'idle' | 'goal_closed' | 'keyword';
export interface BoundarySignal {
  text: string;
  previousUserText?: string;
  lastActiveAt?: string;
  now: string;
  goalActive: boolean;
  goalJustClosed?: boolean;
}
export interface BoundaryProposal {
  trigger: BoundaryTrigger; confidence: number;
  reason: string;
}
export function detectBoundary(signal: BoundarySignal): BoundaryProposal | null;
export interface TopicBoundaryRow {
  id: string; projectDir: string; leadSessionId: string;
  fromTopicId: string; toTopicId: string | null;
  trigger: BoundaryTrigger; confidence: number;
  status: 'proposed' | 'accepted' | 'merged' | 'split' | 'undone';
  createdAt: string;
}
```
- 规则：explicit 0.9；goal_closed 0.8；idle（>30min）0.6；semantic（与上一轮 user 词的 token 重叠 <20%）0.4；keyword 0.3。**goalActive 时只允许 explicit/idle，且 confidence 降到 ≤0.4（observe-only）**；`goalJustClosed` 才允许 0.8。阈值默认 0.7 才 propose。

- [ ] **Step 1: Write the failing test**

```ts
test('does not propose a boundary while a goal is active', () => {
  expect(detectBoundary({ text: '换个话题，聊 UI', now: NOW, goalActive: true })).toBeNull();
  expect(detectBoundary({ text: '换个话题，聊 UI', now: NOW, goalActive: false }))
    .toMatchObject({ trigger: 'explicit', confidence: 0.9 });
  expect(detectBoundary({ text: '好了', now: NOW, goalActive: false, goalJustClosed: true }))
    .toMatchObject({ trigger: 'goal_closed', confidence: 0.8 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/topic-boundary.test.ts tests/unit/lead/topic-boundary-store.test.ts --runInBand --forceExit`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement detector + store**

`topic_boundary` 表 + `(project_dir, created_at)` 索引；store 提供 `insert/listByTopic/updateStatus`。`detectBoundary` 纯函数，不做 IO；显式词表 `换个话题|另外|先到这|换个方向|new topic`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/topic-boundary.ts gateway/src/core/lead/topic-boundary-store.ts gateway/tests/unit/lead/topic-boundary.test.ts gateway/tests/unit/lead/topic-boundary-store.test.ts
git commit -m "feat(lead): detect topic boundaries conservatively"
```

---

### Task 7: Boundary 服务 + API + 异步 observe

**Files:**
- Create: `gateway/src/core/lead/lead-boundary-service.ts`
- Create: `gateway/src/routes/lead-boundaries.ts`
- Modify: `gateway/src/routes/route-catalog.ts`、`gateway/src/index.ts`
- Create: `src/hooks/lead-boundary.ts`、Modify `src/plugin.ts`
- Test: `gateway/tests/unit/lead/lead-boundary-service.test.ts`、`gateway/tests/unit/routes/lead-boundaries.test.ts`、`tests/lead-boundary-hook.test.ts`

**Interfaces:**
- `LeadBoundaryService.observe(input: { projectDir; leadSessionId; fromTopicId; text; previousUserText?; now; goalActive; goalJustClosed? }): BoundaryProposal | null`：`MAFW_LEAD_AUTO_BOUNDARY=off` 时只记录 observe 日志；`observe` 模式写 `status='proposed'` 但不发通知；`on` 模式发 `topic.boundary.proposed`。
- API：
```ts
GET  /api/lead/topics/:id/boundaries        → { items: TopicBoundaryRow[] }
POST /api/lead/topics/:id/boundaries/:bid/accept → { status: 'accepted', toTopicId }
POST /api/lead/topics/:id/boundaries/:bid/merge  → { status: 'merged' }
POST /api/lead/topics/:id/boundaries/:bid/undo   → { status: 'undone' }
```
- 宿主 hook `leadBoundaryHook(input, deps?)`：prompt hook 里 fire-and-forget `POST /api/lead/boundaries/observe`，100ms 超时，失败静默。

- [ ] **Step 1: Write the failing tests**

```ts
test('observe mode writes a proposal but does not notify', () => {
  const svc = serviceWithMode('observe');
  const proposal = svc.observe({ ...base, text: '换个话题，聊 UI' });
  expect(proposal?.trigger).toBe('explicit');
  expect(store.listByTopic('t1')).toHaveLength(1);
  expect(broadcast).not.toHaveBeenCalled();
});

test('undo is idempotent and never deletes the boundary row', () => {
  expect(handleUndo({ id: 't1', bid: 'b1' }, deps).body.status).toBe('undone');
  expect(handleUndo({ id: 't1', bid: 'b1' }, deps).body.status).toBe('undone');
  expect(store.get('b1')?.status).toBe('undone');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/lead-boundary-service.test.ts tests/unit/routes/lead-boundaries.test.ts --runInBand --forceExit`
Expected: FAIL（service / handlers not found）。

- [ ] **Step 3: Implement service + routes + hook**

`observe` 串行化同 topic；只有 `confidence >= 0.7` 才写行；`toTopicId` 在 accept 前为 null，accept 时创建新 topic 行（`resumedFrom` 不设，`title` 用首条用户消息截断）。`merge` 把 proposal 标记 merged，不创建新 topic；`undo` 只改状态。插件 hook 在 `prompt` hook 里调用，不 await 回复。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上 + `npx jest tests/lead-boundary-hook.test.ts --runInBand --forceExit`。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add gateway/src/core/lead/lead-boundary-service.ts gateway/src/routes/lead-boundaries.ts gateway/src/routes/route-catalog.ts gateway/src/index.ts src/hooks/lead-boundary.ts src/plugin.ts gateway/tests/unit/lead/lead-boundary-service.test.ts gateway/tests/unit/routes/lead-boundaries.test.ts tests/lead-boundary-hook.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(lead): propose and manage topic boundaries"
```

---

### Task 8: 桌面 Attention-first 面板

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/work-overview-model.ts`、`components/WorkPriorityList.tsx`、`components/WorkOverview.tsx`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Test: `packages/desktop/src/renderer/mafw/attention-model.test.ts`、`packages/desktop/tests/attention-panel-wiring.test.ts`

**Interfaces:**
- `buildAttentionList(input: { goals; attention; isResultViewed }): AttentionListItem[]`，person 优先，review/blocked/failed 归类；健康 Goal 不进列表。
- 面板标题「需要你处理」；空态「现在没有需要你处理的事项」；每条一个主行动（回答 / 批准计划 / 查看结果 / 重试）。
- 复用 `WorkPriorityList` 的卡片样式，不新建第二套 UI。

- [ ] **Step 1: Write the failing tests**

```ts
test('health never appears in the attention list', () => {
  const items = buildAttentionList({ goals: [goal({ stage: { owner: 'team', kind: 'working' } })], attention: [], isResultViewed: () => false });
  expect(items).toEqual([]);
});
test('person items sort before result-ready', () => {
  const items = buildAttentionList({ goals: [readyGoal, blockedGoal], attention: [], isResultViewed: () => false });
  expect(items[0].kind).toBe('blocked');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run（`packages/desktop` 下）：`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/attention-model.test.ts tests/attention-panel-wiring.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement model + panel**

`buildAttentionList` 使用 P2 attention 规则（与 gateway 同序），但只读本地 `podStore.detail().goals/attention`；`WorkPriorityList` 增加 person/result 分组；`MafwShell` 传给面板。健康 Goal 只在「全部 Goal」列表出现。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/mafw/work-overview-model.ts packages/desktop/src/renderer/mafw/attention-model.test.ts packages/desktop/src/renderer/mafw/components/WorkPriorityList.tsx packages/desktop/src/renderer/mafw/components/WorkOverview.tsx packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/attention-panel-wiring.test.ts
git commit -m "feat(desktop): add attention-first work panel"
```

---

### Task 9: 桌面 Topic map（fork / boundary）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/components/TopicIndexPanel.tsx`、`lead-topics.ts`
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`
- Modify: `packages/gateway-sdk/src/client.ts`、`types.ts`、preload
- Test: `packages/desktop/src/renderer/mafw/lead-topics.test.ts`、`packages/desktop/tests/topic-map-wiring.test.ts`

**Interfaces:**
- SDK/preload 增加：`lead.topics.fork(id, { goalTitle })`、`lead.topics.boundaries(id)`、`lead.boundaries.accept/merge/undo(topicId, id)`、`goals.pause/stop/retry`。
- `TopicIndexPanel` 每行增加「分叉」按钮（fork），底部显示边界提议（`检测到新话题` + 接受/合并/撤销）。
- fork 成功 → `openSessionTab` 新 Goal 的 Tech Lead；项目/话题 id 不出现在用户文案。

- [ ] **Step 1: Write the failing tests**

```ts
test('topic map exposes fork and boundary actions without session ids', () => {
  assert.match(panel, /onFork/)
  assert.match(panel, /边界/)
  assert.match(shell, /lead\.topics\.fork|forkTopic/)
  assert.doesNotMatch(panel, /ses_[a-zA-Z0-9]+/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run（`packages/desktop` 下）：`node --conditions=browser --import tsx --import ../../packages/test-shim/register.mjs --test src/renderer/mafw/lead-topics.test.ts tests/topic-map-wiring.test.ts`
Expected: FAIL（props/handlers missing）。

- [ ] **Step 3: Implement SDK/preload/panel**

SDK 方法走 `this.request`；preload 透传；`MafwShell` 的 `forkTopic(id)` 调 `lead.topics.fork` → `openPodSession`；`boundaryAction` 调 accept/merge/undo 后刷新话题列表。面板只显示标题/摘要/状态/操作。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Regenerate contract + commit**

```bash
cd gateway && npx ts-node --project tsconfig.json scripts/emit-openapi.ts
cd ../packages/gateway-sdk && npm run gen:api
git add packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/types.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/src/preload/mafw-types.ts packages/desktop/src/renderer/mafw/components/TopicIndexPanel.tsx packages/desktop/src/renderer/mafw/lead-topics.ts packages/desktop/src/renderer/mafw/lead-topics.test.ts packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/tests/topic-map-wiring.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts
git commit -m "feat(desktop): add topic map with fork and boundary actions"
```

---

### Task 10: 跨 topic 记忆提升

**Files:**
- Create: `gateway/src/core/lead/topic-memory.ts`
- Create: `gateway/src/core/lead/topic-memory-service.ts`
- Modify: `gateway/src/core/pod/pod-goal-service.ts`、`gateway/src/index.ts`
- Test: `gateway/tests/unit/lead/topic-memory.test.ts`、`gateway/tests/unit/lead/topic-memory-service.test.ts`、`gateway/tests/unit/pod/pod-goal-service.test.ts`

**Interfaces:**
- Produces:
```ts
export interface TopicMemory { content: string; cueAnchors: string[]; memoryType: 'semantic'; }
export function buildTopicMemory(input: {
  topic: LeadTopicRow; summary: string; goalId: string; projectDir: string;
}): TopicMemory;
export class TopicMemoryService {
  constructor(deps: {
    topics: Pick<LeadTopicStore, 'findByGoal'>;
    addMemory(input: TopicMemory): Promise<void> | void;
    enabled(): boolean;
    now(): string;
    wasPromoted(key: string): boolean;
    markPromoted(key: string): void;
    log?(message: string): void;
  });
  /** Goal terminal → promote its source topic summary. Idempotent by topic+summaryHash. */
  promoteForGoal(goalId: string): Promise<boolean>;
}
```
- 规则：只提升 `summary` 非空且 `summaryHash` 非空的 topic；content 只含结论/决策/未结事项，不写 Tech Lead 原始日志；cueAnchors 必须原样含 `topicId` / `goalId` / `projectDir`；`MAFW_LEAD_WORKING_SET=0` 时跳过。

- [ ] **Step 1: Write the failing tests**

```ts
test('builds a semantic memory with stable anchors', () => {
  const memory = buildTopicMemory({ topic: topic({ id: 't1', goalId: 'g1' }), summary: '决定：A', goalId: 'g1', projectDir: '/p' });
  expect(memory.memoryType).toBe('semantic');
  expect(memory.content).toContain('决定：A');
  expect(memory.cueAnchors).toEqual(expect.arrayContaining(['t1', 'g1', '/p']));
});

test('promotes once per topic summary hash', async () => {
  const svc = service({ wasPromoted: () => false });
  await svc.promoteForGoal('g1');
  expect(addMemory).toHaveBeenCalledTimes(1);
  await svc.promoteForGoal('g1');
  expect(addMemory).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix gateway -- tests/unit/lead/topic-memory.test.ts tests/unit/lead/topic-memory-service.test.ts tests/unit/pod/pod-goal-service.test.ts --runInBand --forceExit`
Expected: FAIL（module not found / hook missing）。

- [ ] **Step 3: Implement memory promotion + completion hook**

`PodGoalService` deps 增加 `onGoalCompleted?: (goalId: string) => void`，在 `onGoalArchived` / `notifyResult` 终态分支调用（fail-open）。`LeadTopicStore` 增加 `findByGoal(goalId)`（按 `last_active_at DESC` 取一条）。`index.ts` 用 gateway kv 实现 `wasPromoted/markPromoted`，`addMemory` 接现有 memory service；`MAFW_LEAD_WORKING_SET=0` 时 `enabled=false`。

- [ ] **Step 4: Run tests to verify they pass**

Run: 同上。Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add gateway/src/core/lead/topic-memory.ts gateway/src/core/lead/topic-memory-service.ts gateway/src/core/pod/pod-goal-service.ts gateway/src/index.ts gateway/tests/unit/lead/topic-memory.test.ts gateway/tests/unit/lead/topic-memory-service.test.ts gateway/tests/unit/pod/pod-goal-service.test.ts
git commit -m "feat(lead): promote completed topic summaries to semantic memory"
```

---

### Task 11: 集成、开关、文档与全量门禁

**Files:**
- Create: `gateway/tests/integration/lead-scheduler.test.ts`
- Modify: `docs/architecture/{pod,goal,desktop}.md`、`docs/releases/2026-11-10-lead-techlead-p2.md`
- Test: 全量

**Interfaces:**
- 场景 1：3 个 Goal + `maxConcurrentGoals=2` + 1 个 person attention → 只启动 2 个；person 事项仍可见；新 Goal 排队。
- 场景 2：fork t1 → 新 Goal `topic_fork` 行、源 t1 逐字不变、handoff 含 `<forked-topic>`。
- 场景 3：boundary observe → 提议 → merge/undo；进行中的 Goal 不产生提议。
- 开关：`MAFW_LEAD_SCHEDULER=0` 回退单 active；`MAFW_LEAD_AUTO_BOUNDARY=off` 不写提议；`MAFW_LEAD_COW_FORK=0` 回退 P0 handoff。

- [ ] **Step 1: Write the failing integration test**

```ts
test('three goals, two slots and a human slot do not starve the human', async () => {
  const plan = planPromotions({ active: [humanActive], queued: [q1, q2, q3], maxConcurrent: 2 });
  expect(plan.capacity).toBe(3);
  expect(plan.start).toEqual(['q1', 'q2']);
  expect(plan.waiting).toEqual(['q3']);
  const fork = planFork({ topic: sourceTopic, messages: sourceMessages, summary: '决定：A' });
  expect(fork.handoffText).toContain('<forked-topic');
  expect(sourceTopic.snapshot).toBe('unchanged');
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix gateway -- tests/integration/lead-scheduler.test.ts --runInBand --forceExit`
Expected: FAIL（wiring / missing behavior）。

- [ ] **Step 3: Wire + document + flags**

`index.ts` 构造 `LeadBoundaryService`、`TopicForkStore`；`mafw_create_goal` 的 fork 参数接入；`attachLeadBoundaryRoutes`。`docs/architecture/pod.md` 追加「P2 调度 / fork / 边界」现状段；`docs/architecture/goal.md` 补 stage/attention 字段；`docs/architecture/desktop.md` 补 attention/topic map。release 记录写清默认开关与灰度方式。

- [ ] **Step 4: Run full gates**

```bash
npm test --prefix gateway -- --runInBand --forceExit
npm test -w @mafw/sdk
npm test --prefix packages/desktop
npx jest --runInBand --forceExit
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
cd ../../gateway && npx tsc --noEmit -p tsconfig.json
```
Expected: 全绿；tsc/tsgo/build rc=0。

- [ ] **Step 5: Commit**

```bash
git add gateway/tests/integration/lead-scheduler.test.ts docs/architecture/pod.md docs/architecture/goal.md docs/architecture/desktop.md docs/releases/2026-11-10-lead-techlead-p2.md
git commit -m "test(lead): cover scheduler, fork and boundaries"
```

---

## Self-Review

- **Spec coverage**：4.1 attention scheduler（Task 1/2/3）、4.2 COW fork（Task 4/5）、4.3 自动边界（Task 6/7）、4.4 多 Goal 并发（Task 2/11）、4.5 跨 topic 记忆提升（Task 10）、5 数据模型（Task 1 复用 attention、Task 2 assignment 复用 NodeDriver、Task 4/6 新表）、6 API/事件（Task 1/3/5/7/9）、7 UI（Task 8/9）、8 失败模式（Review Focus + fail-open）、9 测试（各任务单元 + Task 11 集成）、10 开关（Task 11）。
- **类型一致性**：`AttentionItem` / `SchedulerPlan` / `ForkPlan` / `BoundaryProposal` / `TopicMemory` 在后续任务中名称一致；`topic_fork` 与 `topic_boundary` 字段使用 snake_case DB / camelCase DTO。
- **未决**：embedding 语义信号 P2 用 token 近似，不引入每次 LLM rerank；跨 topic 记忆只提升 summary，不写 Tech Lead 原始日志。
