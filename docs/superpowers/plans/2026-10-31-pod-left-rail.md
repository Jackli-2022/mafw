# 鲸群进左栏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在桌面左 rail 加「鲸群」入口，左 dock 提供成员名册 / goal / 计数 / 发消息（贴条 + 立即提醒），并为「待审」「未读」补上真实数据来源。

**Architecture:** 读复用现有 `pod-store` 单例（常驻订阅上移到 `MafwShell`），写复用现有 REST 消息接口并新增 `notify` 强制投递与 `read` 标记；任务投影让 execute 回执先进 `review`，使「待审」有生产者。桌面侧新增两个纯函数模块（badge / 名单行模型）承载全部可测逻辑，组件只做渲染。

**Tech Stack:** TypeScript、SolidJS、Electron（desktop）、Node http 路由（gateway）、Jest（gateway 测试）、bun test（desktop / SDK 测试）、`@a2a-js/sdk` 不涉及。

**Spec:** `docs/superpowers/specs/2026-10-30-pod-left-rail-design.md`

## Global Constraints

- 桌面渲染层禁止裸 `<button>` / `<input>` / `title=`，一律用 `@mafw/ui/v2/*`（ButtonV2 / TextInputV2 / TooltipV2 / ToastV2 / SelectV2）。
- 数字样式必须写成字符串（`"12px"`），不要数字字面量。
- gateway 路由使用正则匹配时必须容忍 query string（`(?:\?|$)` 或先 `url.split('?')[0]`）。
- Pod 身份：UI 一律以 **Lead** 身份操作（`selfMemberId = members.find(role === 'lead')?.id`）。
- 投递语义不得承诺「打断」：`delivery: 'queue'` 是「回合结束后优先送达」。
- 徽标数字必须进入无障碍名（`railAriaLabel`）。
- 不改数据库 schema（`pod_messages.read_at` 已存在）。

## Review Focus

- 同一项目目录下左右两个面板同时消费 `pod-store`：目录口径不一致会让任一方把另一方打回 loading（`open()` 会清空 detail）。
- 旧 gateway（无 `notify` / 无 `delivery` 字段 / 无 read 路由）：UI 必须降级而非报错或假装成功。
- 广播消息（`toMemberId = null`）在未读、立即提醒、成员筛选三处的行为必须一致（未读计入、提醒禁用）。
- `review` 成为常态状态后，右栏任务板与 `reconcileArchive` 的列归属/终态必须仍然正确（不能有任务永远停在 review）。
- 左侧 264px 窄栏内的三张成员卡 + 输入区在 240px 下不溢出、不遮挡（composer 结构护栏 `min-width: 0`）。

---

### Task 1: gateway — execute 回执进 `review`

**Files:**
- Modify: `gateway/src/core/pod/pod-task-service.ts:73-98`（`applyReceipt`）、`:138-146`（`reopenForReview`）
- Test: `gateway/tests/unit/pod/pod-task-service.test.ts`

**Interfaces:**
- Consumes: `PodStore.updateTask(id, patch, now)`、`PodTaskStatus`（`'pending' | 'in_progress' | 'blocked' | 'review' | 'done' | 'failed' | 'reopened'`）
- Produces: `applyReceipt(podId, goalId, receipt)` 对 `status === 'done'` 的回执写入 `status: 'review'`（其余 `'failed'` 不变）；`reopenForReview(podId, goalId)` 的选择集为 `['in_progress', 'review', 'done']`

- [ ] **Step 1: 写失败测试**

在 `gateway/tests/unit/pod/pod-task-service.test.ts` 追加（沿用文件内已有的 `makeService()` 风格建 store/tasks）：

```ts
it('moves done execute receipts to review instead of done', () => {
  const h = makeService();
  h.tasks.projectWaves('pod_1', 'g1', { waves: [{ id: 'w1', tasks: ['a'] }] });
  const external = h.store.listTasks('pod_1', 'g1')[0].externalTaskId!;
  h.tasks.applyReceipt('pod_1', 'g1', { receipts: [{ taskId: external, status: 'done', files: ['r.md'] }] });
  expect(h.store.listTasks('pod_1', 'g1')[0].status).toBe('review');
});

it('reopens review tasks when the reviewer fails', () => {
  const h = makeService();
  h.tasks.projectWaves('pod_1', 'g1', { waves: [{ id: 'w1', tasks: ['a'] }] });
  const external = h.store.listTasks('pod_1', 'g1')[0].externalTaskId!;
  h.tasks.applyReceipt('pod_1', 'g1', { receipts: [{ taskId: external, status: 'done' }] });
  h.tasks.reopenForReview('pod_1', 'g1');
  expect(h.store.listTasks('pod_1', 'g1')[0].status).toBe('reopened');
});

it('closes review tasks when the goal archives as passed', () => {
  const h = makeService();
  h.tasks.projectWaves('pod_1', 'g1', { waves: [{ id: 'w1', tasks: ['a'] }] });
  const external = h.store.listTasks('pod_1', 'g1')[0].externalTaskId!;
  h.tasks.applyReceipt('pod_1', 'g1', { receipts: [{ taskId: external, status: 'done' }] });
  h.tasks.reconcileArchive('pod_1', 'g1', true);
  expect(h.store.listTasks('pod_1', 'g1')[0].status).toBe('done');
});
```

若文件内已有同一场景的旧断言（`done` 直接变 `done`），一并改为新语义。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/pod/pod-task-service.test.ts --runInBand`
Expected: 新用例 FAIL（`expected 'done' to be 'review'`）

- [ ] **Step 3: 改投影**

`applyReceipt` 的映射改为 `const status: PodTaskStatus = item.status === 'done' ? 'review' : 'failed';`；`reopenForReview` 的过滤改为 `(task) => task.status === 'in_progress' || task.status === 'review' || task.status === 'done'`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/pod/pod-task-service.test.ts tests/unit/pod/pod-wiring.test.ts --runInBand`
Expected: 全绿（若 `pod-wiring` 断言旧语义，同步改为 review）

- [ ] **Step 5: 提交**

```bash
git add gateway/src/core/pod/pod-task-service.ts gateway/tests/unit/pod/pod-task-service.test.ts gateway/tests/unit/pod/pod-wiring.test.ts
git commit -m "feat(pod): move execute receipts into review so 待审 has a producer"
```

---

### Task 2: gateway — 消息已读路由

**Files:**
- Modify: `gateway/src/core/pod/pod-message-service.ts:44-50`（`markRead`）
- Modify: `gateway/src/routes/pods.ts`（`PodRouteDeps.messages` 的 Pick、`messages` 路由块）
- Modify: `gateway/src/routes/route-catalog.ts`（登记 `pods.messages.read`）
- Test: `gateway/tests/unit/pod/pod-message-service.test.ts`、`gateway/tests/unit/routes/pods.test.ts`

**Interfaces:**
- Consumes: `PodStore.markMessageRead(id, now)`
- Produces: `PodMessageService.markRead(messageId: string): boolean`（找到并写入返回 `true`，未知返回 `false`，成功时调用 `deps.notify(podId)`）；HTTP `POST /api/pods/:podId/messages/:messageId/read` → `200 { message }` | `404 { error: 'message not found' }`

- [ ] **Step 1: 写失败测试**

`pod-message-service.test.ts`：

```ts
it('marks a message read and notifies the pod', () => {
  const h = makeService();
  const sent = h.service.send({ podId: 'pod_1', fromMemberId: 'm_lead', toMemberId: 'm_builder', kind: 'note', body: 'hi' });
  expect(h.service.markRead(sent.id)).toBe(true);
  expect(h.store.getMessage(sent.id)!.readAt).toBeTruthy();
  expect(h.notify).toHaveBeenCalledWith('pod_1');
  expect(h.service.markRead('nope')).toBe(false);
});
```

`pods.test.ts`（沿用 `makeDeps` / `call`）：

```ts
it('marks a pod message read and 404s unknown ids', async () => {
  const deps = makeDeps();
  deps.messages.markRead = jest.fn((id: string) => id === 'm1');
  const ok = await call('POST', '/api/pods/pod_1/messages/m1/read', deps, {});
  expect(ok.res.status).toBe(200);
  expect(ok.json.message.id).toBe('m1');
  const missing = await call('POST', '/api/pods/pod_1/messages/nope/read', deps, {});
  expect(missing.res.status).toBe(404);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/pod/pod-message-service.test.ts tests/unit/routes/pods.test.ts --runInBand`
Expected: FAIL（`markRead` 返回 `undefined` / 路由 405 或未处理）

- [ ] **Step 3: 实现**

1. `PodMessageService.markRead` 返回 `boolean`：先 `this.deps.store.getMessage(messageId)`，为空 `return false`；否则 `markMessageRead` + `this.deps.notify(message.podId)` + `return true`。
2. `routes/pods.ts`：`messages` 的 Pick 增加 `'markRead'`；在 `messages` 正则块之后（POST 分支内）加 `const readMatch = pathname.match(/^\/api\/pods\/([^/]+)\/messages\/([^/]+)\/read$/); if (readMatch && method === 'POST') { ... requirePod(deps, podId); const ok = deps.messages.markRead(decode(readMatch[2])); if (!ok) throw new PodError(404, 'message not found'); sendJson(res, 200, { message: deps.messages.list(podId).find(m => m.id === decode(readMatch[2])) }); return true; }`（用 `find` 取回该条，避免再开新 Store 方法）。
3. `route-catalog.ts` 在 pod 消息两条之后加 `{ method: 'POST', path: '/api/pods/:podId/messages/:messageId/read', operationId: 'pods.messages.read', tags: ['pods'] }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/pod/pod-message-service.test.ts tests/unit/routes/pods.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/core/pod/pod-message-service.ts gateway/src/routes/pods.ts gateway/src/routes/route-catalog.ts gateway/tests/unit/pod/pod-message-service.test.ts gateway/tests/unit/routes/pods.test.ts
git commit -m "feat(pod): mark message read route with pod broadcast"
```

---

### Task 3: gateway — `notify` 强制投递 + 响应三态

**Files:**
- Modify: `gateway/src/core/pod/pod-message-delivery.ts:5-10`（deps）、`:29-50`（`deliver`）
- Modify: `gateway/src/routes/pods.ts`（send 分支与 deps）
- Modify: `gateway/src/index.ts`（`PodMessageDelivery` 注入 `notify`）
- Test: `gateway/tests/unit/pod/pod-message-delivery.test.ts`、`gateway/tests/unit/routes/pods.test.ts`

**Interfaces:**
- Consumes: `PodStore.markMessageDelivered(id, sessionId, now)`、`PodMessageDeliveryDeps.promptAsync({ sessionID, message, delivery })`
- Produces:
  - `PodMessageDelivery.deliver(messageId: string, opts?: { force?: boolean }): Promise<'delivered' | 'pending' | 'skipped'>`（`force` 时跳过 `decide() === 'push'` 门；成功后调 `deps.notify?.(podId)`）
  - `PodRouteDeps.delivery?: { deliver(id: string, opts?: { force?: boolean }): Promise<'delivered' | 'pending' | 'skipped'> }`
  - `POST /api/pods/:podId/messages` 请求体 `notify?: boolean`；`notify === true && !toMemberId` → 400 `notify requires toMemberId`；响应 `{ message, delivery?: 'delivered' | 'pending' | 'disabled' }`（`skipped` 映射为 `'disabled'`，未传 `notify` 时不带该字段）

- [ ] **Step 1: 写失败测试**

`pod-message-delivery.test.ts`：

```ts
it('force delivers to a pull (goal node) session', async () => {
  const h = makeDelivery(); // 已有 helper：建 pod/members/session(node='execute')
  h.store.insertMessage({ id: 'm1', podId: h.pod.id, fromMemberId: h.lead.id, toMemberId: h.builder.id, kind: 'note', body: 'go', now: NOW });
  expect(await h.delivery.deliver('m1')).toBe('pending');        // 拉取通道
  expect(await h.delivery.deliver('m1', { force: true })).toBe('delivered');
  expect(h.promptAsync).toHaveBeenCalledWith(expect.objectContaining({ delivery: 'queue' }));
  expect(h.store.getMessage('m1')!.deliveredAt).toBeTruthy();
});

it('notifies the pod after a successful push', async () => {
  const h = makeDelivery({ notify: jest.fn() });
  // coordination 会话 → push
  ...
  expect(h.notify).toHaveBeenCalledWith(h.pod.id);
});
```

`pods.test.ts`：

```ts
it('rejects notify on a broadcast message', async () => {
  const deps = makeDeps();
  const res = await call('POST', '/api/pods/pod_1/messages', deps, { fromMemberId: 'm1', kind: 'note', body: 'hi', notify: true });
  expect(res.res.status).toBe(400);
});

it('returns the delivery state when notify is set', async () => {
  const deps = makeDeps();
  deps.delivery = { deliver: jest.fn(async () => 'delivered') };
  const res = await call('POST', '/api/pods/pod_1/messages', deps, { fromMemberId: 'm1', toMemberId: 'm2', kind: 'note', body: 'hi', notify: true });
  expect(res.json.delivery).toBe('delivered');
  const plain = await call('POST', '/api/pods/pod_1/messages', deps, { fromMemberId: 'm1', kind: 'note', body: 'hi' });
  expect(plain.json.delivery).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npx jest tests/unit/pod/pod-message-delivery.test.ts tests/unit/routes/pods.test.ts --runInBand`
Expected: FAIL（`force` 无效 / 400 未出现 / 响应无 `delivery`）

- [ ] **Step 3: 实现**

1. `PodMessageDeliveryDeps` 增加 `notify?(podId: string): void`；`deliver(messageId, opts = {})` 中 `const decision = this.decide(messageId); if (decision !== 'push' && !opts.force) return 'pending';`，成功后 `this.deps.notify?.(message.podId)`。
2. `routes/pods.ts`：`PodRouteDeps` 增加 `delivery?`；send 分支在 `send(...)` 之前判 `if (body.notify === true && !body.toMemberId) throw new PodError(400, 'notify requires toMemberId');`，之后 `const result = body.notify === true && deps.delivery ? await deps.delivery.deliver(message.id, { force: true }) : null;`，响应 `sendJson(res, 200, result ? { message, delivery: result === 'skipped' ? 'disabled' : result } : { message });`
3. `index.ts`：`new PodMessageDelivery({ store, promptAsync, ... })` 处补 `notify: (podId) => this.broadcast({ type: 'pod.updated', properties: { podId, kind: 'message' } })`；`attachPodHandlers`/`handlePods` 依赖对象补 `delivery: this.podMessageDelivery`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd gateway && npx jest tests/unit/pod tests/unit/routes/pods.test.ts --runInBand`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add gateway/src/core/pod/pod-message-delivery.ts gateway/src/routes/pods.ts gateway/src/index.ts gateway/tests/unit/pod/pod-message-delivery.test.ts gateway/tests/unit/routes/pods.test.ts
git commit -m "feat(pod): notify pushes handoff to any active member session"
```

---

### Task 4: SDK + preload + 契约

**Files:**
- Modify: `packages/gateway-sdk/src/types.ts`（`PodNamespace` 方法签名）
- Modify: `packages/gateway-sdk/src/client.ts:1256-1266`（`sendMessage`，新增 `markRead`）
- Modify: `packages/desktop/src/preload/mafw-api.ts:231-232`
- Modify: `packages/gateway-sdk/contract/*`、`src/api-schema.gen.ts`（由脚本生成，不手改）
- Test: `packages/gateway-sdk/src/contract.test.ts`、`packages/desktop/tests/pod-preload-wiring.test.ts`

**Interfaces:**
- Consumes: Task 2/3 的 HTTP 契约
- Produces: `export type PodDeliveryState = 'delivered' | 'pending' | 'disabled'`；`PodNamespace.sendMessage(podID: string, body: { fromMemberId?: string; toMemberId?: string; kind: 'note' | 'request' | 'review' | 'decision' | 'escalation'; body: string; actorSessionID?: string; notify?: boolean }): Promise<{ message: PodMessage; delivery?: PodDeliveryState }>`；`PodNamespace.markRead(podID: string, messageID: string): Promise<{ message: PodMessage }>`

- [ ] **Step 1: 写失败测试**

`contract.test.ts` 追加：

```ts
test('pod read route is registered in the openapi contract', () => {
  const paths = JSON.parse(readFileSync(new URL('../contract/gateway-paths.json', import.meta.url), 'utf8')) as any
  const key = Object.keys(paths.paths ?? paths).find((p) => p.includes('/api/pods/{podId}/messages/{messageId}/read'))
  assert.ok(key, 'missing pods.messages.read in contract')
})
```

`pod-preload-wiring.test.ts` 追加断言：源码含 `markRead: (podID, messageID) => invoke("pod", "markRead"`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd gateway && npm run emit:openapi` → 先看它是否已生成该路径（Task 2 登记后会有）；然后 `cd packages/gateway-sdk && npm test`
Expected: FAIL（若未重生成）或 preload 断言 FAIL

- [ ] **Step 3: 实现**

1. `types.ts` 加 `PodDeliveryState` 并更新 `PodNamespace` 的 `sendMessage` / 新增 `markRead`。
2. `client.ts`：`sendMessage` body 类型加 `notify?: boolean`，返回 `{ message: PodMessage; delivery?: PodDeliveryState }`；新增
   `markRead: async (podID, messageID) => this.request<{ message: PodMessage }>(\`/api/pods/${encodeURIComponent(podID)}/messages/${encodeURIComponent(messageID)}/read\`, { method: 'POST' })`。
3. `preload/mafw-api.ts` 加 `markRead: (podID, messageID) => invoke("pod", "markRead", podID, messageID)`。
4. 重生成契约：`cd gateway && npm run emit:openapi && cd ../packages/gateway-sdk && npm run gen:api`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/gateway-sdk && npm test`；`cd packages/desktop && bun test tests/pod-preload-wiring.test.ts`
Expected: 两者 0 fail

- [ ] **Step 5: 提交**

```bash
git add packages/gateway-sdk/src/types.ts packages/gateway-sdk/src/client.ts packages/gateway-sdk/src/contract.test.ts packages/gateway-sdk/contract packages/gateway-sdk/src/api-schema.gen.ts packages/desktop/src/preload/mafw-api.ts packages/desktop/tests/pod-preload-wiring.test.ts
git commit -m "feat(sdk): pod markRead + notify/delivery plumbing"
```

---

### Task 5: desktop — 徽标纯函数

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-rail-badge.ts`
- Test: `packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts`

**Interfaces:**
- Consumes: `PodMessage` / `PodTask`（`@mafw/sdk` 类型，只读字段）
- Produces:
  - `export function countUnread(messages: Array<{ readAt?: string | null; fromMemberId: string; toMemberId: string | null }>, selfMemberId: string | null): number`
  - `export function podRailBadge(input: { tasks: Array<{ status: string }>; messages: Array<{ readAt?: string | null; fromMemberId: string; toMemberId: string | null }>; selfMemberId: string | null }): number`
  - `export function formatRailBadge(n: number): string`（`n > 9` → `'9+'`）

- [ ] **Step 1: 写失败测试**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { countUnread, formatRailBadge, podRailBadge } from "./pod-rail-badge"

const msg = (over: Partial<{ id: string; readAt: string | null; fromMemberId: string; toMemberId: string | null }>) => ({
  id: "m", readAt: null, fromMemberId: "m_builder", toMemberId: "m_lead", ...over,
})

test("unread counts only messages addressed to me or broadcast, not mine, not read", () => {
  assert.equal(countUnread([msg({})], "m_lead"), 1)
  assert.equal(countUnread([msg({ toMemberId: null })], "m_lead"), 1)
  assert.equal(countUnread([msg({ fromMemberId: "m_lead" })], "m_lead"), 0)
  assert.equal(countUnread([msg({ readAt: "2026-10-30T00:00:00.000Z" })], "m_lead"), 0)
  assert.equal(countUnread([msg({ toMemberId: "m_reviewer" })], "m_lead"), 0)
  assert.equal(countUnread([msg({})], null), 0)
})

test("badge = review tasks + unread messages", () => {
  const tasks = [{ status: "review" }, { status: "review" }, { status: "in_progress" }, { status: "done" }]
  assert.equal(podRailBadge({ tasks, messages: [msg({})], selfMemberId: "m_lead" }), 3)
})

test("badge caps rendering at 9+", () => {
  assert.equal(formatRailBadge(0), "")
  assert.equal(formatRailBadge(3), "3")
  assert.equal(formatRailBadge(10), "9+")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/pod-rail-badge.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `pod-rail-badge.ts`**

三个导出按 Interfaces 签名实现；`countUnread` 中 `selfMemberId == null` 直接 `return 0`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/pod-rail-badge.test.ts`
Expected: 3 pass / 0 fail

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/pod-rail-badge.ts packages/desktop/src/renderer/mafw/pod-rail-badge.test.ts
git commit -m "feat(desktop): pod rail badge counter"
```

---

### Task 6: desktop — 名册行模型 + 左 dock 的 pod 面

**Files:**
- Create: `packages/desktop/src/renderer/mafw/pod-rail-face-model.ts`
- Create: `packages/desktop/src/renderer/mafw/components/PodRailFace.tsx`
- Modify: `packages/desktop/src/renderer/mafw/mafw.css`（`.mafw-pod-rail-face` 与输入区样式）
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`（渲染 `face === "pod"`）
- Test: `packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts`、`packages/desktop/tests/pod-rail-face-wiring.test.ts`、`packages/desktop/tests/pod-rail-face-css.test.ts`

**Interfaces:**
- Consumes: `PodDetail`（`members` / `tasks` / `goals` / `sessions`）、`PodMessage[]`、`countUnread`（Task 5）
- Produces:
  - `export type PodMemberRow = { id: string; role: string; displayName: string; agentName: string; statusLabel: string; dotClass: 'working' | 'available' | 'sleeping' | 'waiting'; sessionId: string | null; action: string }`
  - `export function buildMemberRows(detail: Pick<PodDetail, 'members' | 'sessions'>, titleOf: (sessionId: string) => string | null): PodMemberRow[]`（固定顺序 lead → builder → reviewer；`action` = 有未结束 session 时 `会话中 · ${titleOf(id) ?? "会话中"}`，否则按 status 给 `待命` / `休眠`）
  - `export function podCounts(detail: Pick<PodDetail, 'tasks'>, messages: Array<{ readAt?: string | null; fromMemberId: string; toMemberId: string | null }>, selfMemberId: string | null): { review: number; todo: number; inbox: number }`（`todo` = `pending|in_progress|blocked|reopened`；`inbox` 复用 `countUnread`）
  - `export function canNotify(toMemberId: string | null, hasActiveSession: boolean): boolean`（广播或无会话 → `false`）
  - `export function deliveryToast(delivery: 'delivered' | 'pending' | 'disabled' | undefined): string`（`delivered`→`已提醒`、`pending`→`已发送，对方下次派活时送达`、`disabled` 或 `undefined`→`已发送（投递状态未知）`）
  - `export function podEmptyState(input: { hasPod: boolean; unsupported: boolean; isWorktree: boolean }): 'ready' | 'create' | 'unsupported' | 'worktree'`（优先级 `unsupported → worktree → create → ready`）
  - `export function PodRailFace(props: { detail: PodDetail | null; messages: PodMessage[]; loading: boolean; unsupported: boolean; isWorktree: boolean; selfMemberId: string | null; onOpenSession: (sessionId: string) => void; onOpenGoal: (goalId: string) => void; onOpenPanel: (panel: 'tasks' | 'inbox') => void; onSend: (input: { toMemberId: string | null; kind: string; body: string; notify: boolean }) => Promise<string>; onCreate: () => void })`（`onSend` 返回 toast 文案，组件用 `showToastV2` 呈现）
  - `LeftDockFace` 增加 `"pod"`（类型改动在 Task 7；本任务先按已含 `"pod"` 实现，若类型未改则本任务内一并改）

- [ ] **Step 1: 写失败测试（模型）**

```ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildMemberRows, podCounts } from "./pod-rail-face-model"

const detail = {
  members: [
    { id: "m_b", role: "builder", displayName: "Builder", agentName: "mafw-execute", status: "available" },
    { id: "m_l", role: "lead", displayName: "Lead", agentName: "manager", status: "working" },
    { id: "m_r", role: "reviewer", displayName: "Reviewer", agentName: "mafw-review", status: "sleeping" },
  ],
  sessions: [{ memberId: "m_l", sessionId: "ses_1", endedAt: null }],
  tasks: [{ status: "review" }, { status: "pending" }, { status: "done" }],
} as any

test("member rows keep lead → builder → reviewer order and resolve the current action", () => {
  const rows = buildMemberRows(detail, (id) => (id === "ses_1" ? "Pod 收尾" : null))
  assert.deepEqual(rows.map((r) => r.id), ["m_l", "m_b", "m_r"])
  assert.equal(rows[0].action, "会话中 · Pod 收尾")
  assert.equal(rows[0].dotClass, "working")
  assert.equal(rows[1].sessionId, null)
  assert.equal(rows[1].action, "待命")
  assert.equal(rows[2].dotClass, "sleeping")
})

test("counts split review / todo / unread", () => {
  const messages = [
    { readAt: null, fromMemberId: "m_b", toMemberId: "m_l" },
    { readAt: "2026-10-30T00:00:00.000Z", fromMemberId: "m_b", toMemberId: "m_l" },
  ]
  assert.deepEqual(podCounts(detail, messages, "m_l"), { review: 1, todo: 1, inbox: 1 })
})

test("notify is only offered to a named member with an active session", () => {
  assert.equal(canNotify("m_b", true), true)
  assert.equal(canNotify("m_b", false), false)
  assert.equal(canNotify(null, true), false)
})

test("delivery toast never promises a push it cannot confirm", () => {
  assert.equal(deliveryToast("delivered"), "已提醒")
  assert.equal(deliveryToast("pending"), "已发送，对方下次派活时送达")
  assert.equal(deliveryToast("disabled"), "已发送（投递状态未知）")
  assert.equal(deliveryToast(undefined), "已发送（投递状态未知）")
})

test("empty state prefers unsupported over worktree over create", () => {
  assert.equal(podEmptyState({ hasPod: false, unsupported: true, isWorktree: true }), "unsupported")
  assert.equal(podEmptyState({ hasPod: false, unsupported: false, isWorktree: true }), "worktree")
  assert.equal(podEmptyState({ hasPod: false, unsupported: false, isWorktree: false }), "create")
  assert.equal(podEmptyState({ hasPod: true, unsupported: false, isWorktree: true }), "ready")
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/pod-rail-face-model.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现模型**

`pod-rail-face-model.ts` 按 Interfaces 实现六个导出（状态词映射：`working→工作中`、`available→待命`、`waiting→等待`、`sleeping→休眠`、`retired→已退役`；`dotClass` 与状态同名，`retired` 归 `available` 样式）。

- [ ] **Step 4: 实现组件与样式**

`PodRailFace.tsx`：头部（`鲸群` + 状态 pill）+ 成员行 + goal 卡 + 计数条 + 输入区。输入区用 `TextInputV2`，`onKeyDown` 调 `applyReadlineKey`（Enter 发送、Ctrl+Enter 换行）；`Esc` 在输入有内容时清空并 `stopPropagation()`（阻止 shell 的 overlay 关闭监听），空时不拦截。收件人/kind 用 `SelectV2`；「立即提醒」用 `SwitchV2`，`disabled={!canNotify(...)}` 并用 `TooltipV2` 说明原因。发送成功后 `showToastV2({ description: deliveryToast(result) })`。
`mafw.css` 追加 `.mafw-pod-rail-face`（`display:flex; flex-direction:column; min-height:0`）、`.mafw-pod-rail-face > *`（`min-width:0`）、`.mafw-pod-rail-input`（`width:100%`）。

- [ ] **Step 5: 写组件契约测试并跑**

`packages/desktop/tests/pod-rail-face-wiring.test.ts`（沿用 wiring test 风格，读源码断言）：

```ts
test("pod rail face composes V2 controls and guards narrow width", () => {
  const src = readFileSync(new URL("../src/renderer/mafw/components/PodRailFace.tsx", import.meta.url), "utf8")
  assert.match(src, /SelectV2/)
  assert.match(src, /SwitchV2/)
  assert.match(src, /applyReadlineKey/)
  assert.match(src, /立即提醒/)
  assert.match(src, /mafw-pod-rail-face/)
  assert.match(src, /deliveryToast/)
  assert.doesNotMatch(src, /<button[\s>]/)
  assert.doesNotMatch(src, /title=/)
})
```

`packages/desktop/tests/pod-rail-face-css.test.ts`：

```ts
test("pod rail face styles survive a 240px dock", () => {
  const css = readFileSync(new URL("../src/renderer/mafw/mafw.css", import.meta.url), "utf8")
  const block = css.slice(css.indexOf(".mafw-pod-rail-face"))
  assert.match(block, /min-width:\s*0/)
  assert.match(block, /flex-direction:\s*column/)
})
```

Run: `cd packages/desktop && bun test tests/pod-rail-face-wiring.test.ts tests/pod-rail-face-css.test.ts src/renderer/mafw/pod-rail-face-model.test.ts`
Expected: 全绿

- [ ] **Step 6: 提交**

```bash
git add packages/desktop/src/renderer/mafw/pod-rail-face-model.ts packages/desktop/src/renderer/mafw/pod-rail-face-model.test.ts packages/desktop/src/renderer/mafw/components/PodRailFace.tsx packages/desktop/src/renderer/mafw/mafw.css packages/desktop/tests/pod-rail-face-wiring.test.ts packages/desktop/tests/pod-rail-face-css.test.ts
git commit -m "feat(desktop): pod roster face for the left dock"
```

---

### Task 7: desktop — rail 图标与 face 类型

**Files:**
- Modify: `packages/ui/src/components/icon.tsx`（新增 `team-three`）
- Modify: `packages/desktop/src/renderer/mafw/left-dock.ts:3`（`LeftDockFace` 增加 `"pod"`）
- Modify: `packages/desktop/src/renderer/mafw/components/IconRail.tsx`（新 item + `podBadge` prop）
- Test: `packages/desktop/src/renderer/mafw/left-dock.test.ts`、`packages/desktop/tests/icon-rail-pod-wiring.test.ts`

**Interfaces:**
- Consumes: `railAriaLabel(label, badge)`、`toggleFace`、`formatRailBadge`（Task 5）
- Produces: `LeftDockFace = "sessions" | "search" | "notes" | "pod"`；`IconRailProps` 新增 `podBadge?: number`；`RailItem` 新增 `badgeLabel?: string`（渲染时优先于 `badge`，供 `9+` 用）；rail 项 key `"pod"`，label `鲸群`，icon `team-three`

- [ ] **Step 1: 写失败测试**

`left-dock.test.ts`：

```ts
test("pod face toggles like the other destinations", () => {
  const closed = { face: "sessions" as const, open: false }
  assert.deepEqual(toggleFace(closed, "pod"), { face: "pod", open: true })
  assert.deepEqual(toggleFace({ face: "pod", open: true }, "pod"), { face: "pod", open: false })
})
```

`tests/icon-rail-pod-wiring.test.ts`：

```ts
test("rail exposes the pod destination with a badge in its accessible name", () => {
  const src = readFileSync(new URL("../src/renderer/mafw/components/IconRail.tsx", import.meta.url), "utf8")
  assert.match(src, /"pod"/)
  assert.match(src, /team-three/)
  assert.match(src, /podBadge/)
  assert.match(src, /formatRailBadge/)
  assert.match(src, /badgeLabel/)
  assert.match(src, /railAriaLabel/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/left-dock.test.ts tests/icon-rail-pod-wiring.test.ts`
Expected: FAIL（类型无 `pod` / 源码无 `team-three`）

- [ ] **Step 3: 实现**

1. `icon.tsx` 的 `icons` 表加 `"team-three"`：

```ts
"team-three": `<circle cx="10" cy="6.6" r="2.4" stroke="currentColor"/><path d="M5.4 16.4C5.4 14.1 7.3 12.2 9.6 12.2H10.4C12.7 12.2 14.6 14.1 14.6 16.4" stroke="currentColor" stroke-linecap="square"/><circle cx="4.3" cy="8.9" r="1.6" stroke="currentColor"/><circle cx="15.7" cy="8.9" r="1.6" stroke="currentColor"/>`,
```

2. `left-dock.ts` 的 `LeftDockFace` 加 `"pod"`。
3. `IconRail.tsx`：`IconRailProps` 加 `podBadge?: number`；`RailItem` 加 `badgeLabel?: string`，渲染处改为 `{item.badgeLabel ?? item.badge}`；`destinationItems()` 在 notes 之后加 `{ key: "pod", icon: "team-three", label: props.face === "pod" ? "收起鲸群" : "鲸群", onClick: () => props.onToggleFace("pod"), active: props.face === "pod", badge: props.podBadge, badgeLabel: formatRailBadge(props.podBadge ?? 0) || undefined }`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/left-dock.test.ts tests/icon-rail-pod-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/ui/src/components/icon.tsx packages/desktop/src/renderer/mafw/left-dock.ts packages/desktop/src/renderer/mafw/left-dock.test.ts packages/desktop/src/renderer/mafw/components/IconRail.tsx packages/desktop/tests/icon-rail-pod-wiring.test.ts
git commit -m "feat(desktop): pod destination in the icon rail"
```

---

### Task 8: desktop — pod-store `markRead` + 邮箱点击已读

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/pod-store.ts`（`PodStoreApi` 与 store 方法）
- Modify: `packages/desktop/src/renderer/mafw/components/PodInbox.tsx`（消息行点击 → `onRead`）
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`（透传 `onRead` → `podStore.markRead`）
- Test: `packages/desktop/src/renderer/mafw/pod-store.test.ts`、`packages/desktop/tests/pod-inbox-wiring.test.ts`

**Interfaces:**
- Consumes: `PodStoreApi.markRead(podID, messageID): Promise<{ message: PodMessage }>`
- Produces: `podStore.markRead(messageId: string): Promise<void>`（乐观把该条 `readAt` 置为当前 ISO 时间；失败回滚并 `setError`）

- [ ] **Step 1: 写失败测试**

`pod-store.test.ts`：

```ts
test("markRead patches the message optimistically", async () => {
  const api = makeApi({ markRead: async (_pod, id) => ({ message: { id, readAt: "2026-10-30T00:00:00.000Z" } as any }) });
  const store = createPodStore({ api });
  await store.open("/proj");
  await store.markRead("m1");
  assert.equal(store.messages().find((m) => m.id === "m1")!.readAt !== null, true)
});
```

`pod-inbox-wiring.test.ts` 追加：源码含 `onRead` 与 `mafw-pod-message-row`。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test src/renderer/mafw/pod-store.test.ts tests/pod-inbox-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `PodStoreApi` 加 `markRead(podID: string, messageID: string): Promise<{ message: PodMessage }>`；`createPodStore` 返回对象加 `markRead`（调 api + 乐观 patch）。
2. `PodInbox.tsx`：消息行根节点加 `class="mafw-pod-message-row"` 与 `onClick={() => props.onRead?.(message.id)}`（`onRead?: (id: string) => void`）；未读行加 `classList={{ unread: !message.readAt }}`。
3. `PodDock.tsx`：`<PodInbox ... onRead={(id) => void podStore.markRead(id)} />`。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd packages/desktop && bun test src/renderer/mafw/pod-store.test.ts tests/pod-inbox-wiring.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/pod-store.ts packages/desktop/src/renderer/mafw/pod-store.test.ts packages/desktop/src/renderer/mafw/components/PodInbox.tsx packages/desktop/src/renderer/mafw/components/PodDock.tsx packages/desktop/tests/pod-inbox-wiring.test.ts
git commit -m "feat(desktop): click a pod message to mark it read"
```

---

### Task 9: desktop — MafwShell 接线（常驻订阅 / 徽标 / 导航）

**Files:**
- Modify: `packages/desktop/src/renderer/mafw/MafwShell.tsx`（pod 订阅 effect、badge、IconRail `podBadge`、LeftDock 传参、导航回调）
- Modify: `packages/desktop/src/renderer/mafw/components/LeftDock.tsx`（`face === "pod"` 渲染 `PodRailFace`，新增 props）
- Modify: `packages/desktop/src/renderer/mafw/components/PodDock.tsx`（去掉自己的 `open` effect，改为消费壳层订阅）
- Test: `packages/desktop/tests/pod-left-rail-shell-wiring.test.ts`

**Interfaces:**
- Consumes: Task 5 `podRailBadge/formatRailBadge`、Task 6 `PodRailFace`、Task 7 `podBadge`
- Produces: shell 级 `podSelfMemberId()`、`podBadgeCount()`、`openPodPanel(panel: 'tasks' | 'inbox')`；`LeftDock` 新增 props `podDetail`、`podMessages`、`podLoading`、`podUnsupported`、`podSelfMemberId`、`onPodOpenSession`、`onPodOpenGoal`、`onPodOpenPanel`、`onPodSend`、`onPodCreate`

- [ ] **Step 1: 写失败测试（源码契约）**

```ts
test("shell owns the pod subscription and feeds the rail badge", () => {
  const src = readFileSync(new URL("../src/renderer/mafw/MafwShell.tsx", import.meta.url), "utf8")
  assert.match(src, /podRailBadge\(/)
  assert.match(src, /podBadge=\{/)
  assert.match(src, /podStore\.open\(/)
  assert.match(src, /onPodOpenPanel/)
  assert.match(src, /notify: input\.notify/)
  const dock = readFileSync(new URL("../src/renderer/mafw/components/PodDock.tsx", import.meta.url), "utf8")
  assert.doesNotMatch(dock, /podStore\.open\(/)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd packages/desktop && bun test tests/pod-left-rail-shell-wiring.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `MafwShell` 新增 effect：`const dir = benchRoot() ?? currentProject(); if (dir) void podStore.open(dir)`；连接从非 `connected` 变 `connected` 时 `void podStore.refresh()`。
2. `const podSelfMemberId = () => podStore.detail()?.members.find(m => m.role === "lead")?.id ?? null`；`podBadgeCount = () => podRailBadge({ tasks: podStore.detail()?.tasks ?? [], messages: podStore.messages(), selfMemberId: podSelfMemberId() })`。
3. `<IconRail podBadge={podBadgeCount()} ... />`。
4. `openPodPanel(panel)`：`closeLeftDockIfOverlay(); setShowConfig(false); setShowWelcome(false); openWorkbench('execution','pod')`（复用现有「执行 › 鲸群」入口；现有 API 不支持 tab 参数时就只打开面板）。
5. `onPodSend`：

```ts
const onPodSend = async (input: { toMemberId: string | null; kind: string; body: string; notify: boolean }): Promise<string> => {
  const detail = podStore.detail()
  const lead = detail?.members.find((m) => m.role === "lead")
  if (!detail || !lead) return "鲸群未就绪"
  const res = await window.api.mafw.pod.sendMessage(detail.pod.id, {
    fromMemberId: lead.id,
    toMemberId: input.toMemberId ?? undefined,
    kind: input.kind as any,
    body: input.body,
    notify: input.notify,
  })
  void podStore.refresh()
  return input.notify ? deliveryToast(res?.delivery) : "已发送"
}
```

6. `LeftDock` 透传 §Interfaces 列出的 props（含 `isWorktree={benchRoot() !== currentProject()}`）；`LeftDock` 内 `<Show when={props.face === "pod"}><PodRailFace ... /></Show>`。
7. `PodDock` 删除自己的 `podStore.open(dir)` effect，改为 `props.active` 时 `void podStore.refresh()`（首次加载由壳层负责）。

- [ ] **Step 4: 跑测试并做门禁**

Run:
```
cd packages/desktop && bun test tests/pod-left-rail-shell-wiring.test.ts && bun test
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```
Expected: 测试 0 fail；tsgo rc=0；build rc=0

- [ ] **Step 5: 提交**

```bash
git add packages/desktop/src/renderer/mafw/MafwShell.tsx packages/desktop/src/renderer/mafw/components/LeftDock.tsx packages/desktop/src/renderer/mafw/components/PodDock.tsx packages/desktop/tests/pod-left-rail-shell-wiring.test.ts
git commit -m "feat(desktop): wire pod roster into the left rail and dock"
```

---

### Task 10: 文档与全量门禁

**Files:**
- Modify: `AGENTS.md`（在 Pod 段落补一条：左栏鲸群面 + 徽标口径 + review 投影 + notify/read 契约）
- Modify: `docs/superpowers/specs/2026-10-30-pod-left-rail-design.md`（若实现中出现偏离，回写「实现说明」小节）

**Interfaces:**
- Consumes: Task 1–9 的最终行为
- Produces: 版本可交付状态（测试全绿 + build 通过 + AGENTS 记录）

- [ ] **Step 1: 跑全量门禁**

```
cd gateway && npx tsc --noEmit
npm test --prefix gateway -- --runInBand --forceExit
npm test -w @mafw/desktop
npm test -w @mafw/sdk
cd packages/desktop && npx tsgo --noEmit -p tsconfig.json && npx electron-vite build
```
Expected: 全部 0 fail；tsgo / tsc / build rc=0

- [ ] **Step 2: 更新 AGENTS.md**

在「Pod A2A Handoff」条目后新增一条，写清：左 rail 鲸群入口与徽标公式（review + 未读）、左 dock 面的五项结构、`notify`/`delivery` 三态、`POST .../messages/:id/read`、execute 回执进 `review` 的投影变更，并记录本轮测试数与 commit 区间。

- [ ] **Step 3: 提交**

```bash
git add AGENTS.md docs/superpowers/specs/2026-10-30-pod-left-rail-design.md
git commit -m "docs(pod): record left-rail pod face and review projection"
```

---

## 附：GUI 冒烟清单（执行者手动跑，不属于自动化任务）

1. rail 出现鲸群图标；`review + 未读` 角标数字正确；tooltip/读屏名含数字。
2. 点开 → 左 dock 名册显示三人顺序、状态点、当前动作；`打开会话` 能跳成员会话。
3 贴条（不勾立即提醒）→ 对方消息行显示「待投递」；不产生 token 消耗。
4. 勾「立即提醒」→ 有活跃会话的成员被唤起；消息变「已投递」；角标不虚增。
5. 广播收件人时「立即提醒」禁用并有 tooltip 说明。
6. 右栏邮箱点击消息 → 该条变已读，角标下降。
7. 240px 窄 dock 下输入区不溢出；窗口窄到 overlay 模式时选中会话自动关左 dock。
8. 旧 gateway（无 read/notify 路由）下：发消息成功、无投递承诺；点消息已读静默失败不改本地状态。
