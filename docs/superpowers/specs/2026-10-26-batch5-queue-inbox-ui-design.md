# Batch 5 — Queue Inbox UI（Design）

> 日期：2026-10-26 · 状态：已实施（v4.33.0）
> 上游：Batch 0（`session.inbox.*` → `queue.updated`，UI 明示留到 Batch 5）；queue 核心 spec `2026-10-22-session-queue-inbox-design.md`。

## 1. 意图与为什么

Gateway 已有服务端 inbox：`delivery:'queue'` 在 busy 会话入队、回合终态续发、`queue.updated` 全量快照、`GET/DELETE /api/session/:id/queue` 管理面（Batch 0/Queue 批已落地）。但三端仍看不到它：

- desktop `handleQueueEvent` 只写 trace（注释：UI 在 Batch 5）；
- desktop 只有**本地** turn queue（`turn-queue.ts`），与 gateway queue 是两套；
- TUI 的 `/queue` 管理本地队列，gateway queue 只进 `KNOWN_EVENTS`；
- SDK 有 queue client 方法但 `SessionNamespace` 类型/preload 未暴露，桌面无法调用。

本批补 **gateway queue 的可视面**：desktop 在 composer 上方显示「网关队列」条（取消/清空），TUI 状态栏显示 inbound 数；不改本地 turn queue 行为（避免把附件/乐观消息/语音打断一起重写）。收尾全量验证 + 部署。

## 2. 目标 / 非目标

**目标**

1. SDK：`QueueItem` 类型 + `sessions.queueList/queueCancel/queueClear` 类型面；`promptAsync` body 暴露 `delivery/idempotencyKey/expectReply`（gateway 已接收）。
2. Preload：暴露上述 queue 方法与 prompt 字段。
3. Desktop：
   - `queue-store`（per-session 快照；`queue.updated` 全量替换；按 `enqueuedAt` 排序；文本提取纯函数）；
   - dispatcher `queue.updated` → store；
   - ChatPane composer 上方「网关队列」条：文本预览、逐条取消、清空；无条目隐藏；
   - 会话切换/SSE 重连 `fetchQueue` 兜底。
4. TUI：状态栏 `inbox N`（gateway queue 数量），`queue.updated` 更新；切换会话时 `queueList` 拉取。
5. 文档/版本/部署：v4.33.0，Batch 5 spec/plan 状态，全量测试与真机冒烟。

**非目标**

- 不把 desktop 本地 turn queue 迁移到 gateway queue（附件/agent/voice 语义重写风险；本地队列继续服务用户即时消息）。
- 不做 gateway queue 持久化（queue spec 非目标；gateway 重启丢队列）。
- 不做重排、优先级、`resume:false`。
- 不新增事件/词汇；复用 `queue.updated`。
- 不改 gateway queue 核心/TTL/上限。

## 3. 契约

`queue.updated`（canonical，Batch 0 已有）：

```ts
{ type:'queue.updated', sessionID, properties:{ sessionID, items: QueueItem[], action, itemId? } }
```

`QueueItem`（gateway `core/session-queue.ts`）：

```ts
interface QueueItem {
  id: string; sessionID: string;
  text?: string; parts?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  agent?: string; model?: { providerID: string; modelID: string };
  expectReply?: boolean; idempotencyKey?: string;
  enqueuedAt: string; source: string;
}
```

现有 HTTP（已登记 catalog）：

- `GET /api/session/:id/queue` → `{ items: QueueItem[] }`
- `DELETE /api/session/:id/queue/:itemId` → `{ cancelled: string }` / 404
- `DELETE /api/session/:id/queue` → `{ cleared: number }`

SDK 现有 client 方法但类型面缺失；本批补齐，不改 URL。

## 4. 设计

### 4.1 Desktop queue store

`packages/desktop/src/renderer/mafw/queue-store.ts`：

- signal `Record<sessionID, QueueItem[]>`；
- `queueForSession(sid)` 返回排序副本（`enqueuedAt` 升序，坏日期排后）；
- `applyQueueSnapshot(prev, sid, items)` 纯函数（测试）；
- `ingestQueueEvent(fallbackSid, event)` 读 `event.properties ?? event`，`items` 数组才替换；
- `fetchQueue(sid)` / `cancelQueueItem(sid,itemId)` / `clearGatewayQueue(sid)` 走 preload；
- `queueItemText(item)`：`text` 优先，否则 `parts` 里首个 text，否则 `(附件)`；UI 预览 80 字。

失败全部 fail-open（toast 由 UI 做），不阻塞聊天。

### 4.2 Dispatcher / wiring

- `ShellEventDeps` 增 `queue: { onEvent(sid, event): void }`；
- `handleQueueEvent` 先 `deps.queue.onEvent(sid,event)`，再 trace；仍返回 true（消费）。
- `MafwShell` 注入 `ingestQueueEvent`；`reconcileFlowCards()` 顺带 `void fetchQueue(activeSessionId())`（SSE open/60s 兜底）。

### 4.3 Desktop UI

ChatPane 在本地 `queuedItems` 条**上方**增加 gateway 条：

- `Show when={gwQueue().length > 0}`；
- 标题 `⏳ N 条网关队列 · 回合结束自动发送`；
- 每条：`queueItemText` 预览 + source（title）+ 取消按钮（`cancelQueueItem`）；
- 清空按钮；
- 与本地条使用同一 `.mafw-queue-bar` 视觉；加 `mafw-gw-queue` 类便于区分。
- `createEffect` 在 `sidProp()` 变化时 `fetchQueue`；`queue.updated` 已实时。

### 4.4 TUI

- `StatusState.gatewayQueued?: number`；StatusBar 段 `inbox N`（prio 58，窄屏可丢）。
- `app.ts` `onEvent('queue.updated')`：取 `properties`，若 `sessionID` 是当前会话，`setStatus({gatewayQueued: items.length})`。
- `switchToSession` 后 `queueList` 拉一次；初始化 manager session 后同样。
- 不改 `/queue` overlay（本地队列语义保持）。

## 5. 失败模式

- `queue.updated` 缺 `items`：忽略，保留旧快照；不抛。
- 会话切换后旧会话事件到达：按 `sessionID` 键存，不污染当前 UI。
- 取消/清空 HTTP 失败：toast，事件到达后仍以快照为准。
- 队列事件早于首屏：fetchQueue 兜底。
- 同一 item 多条事件：全量替换幂等。
- gateway 重启队列丢失：UI 空态；queue spec 非目标。
- TUI `queue.updated` 无 properties：`data.sessionID/items` 兼容读取。

## 6. 验收

1. SDK 单测：queue list/cancel/clear URL；promptAsync delivery/idempotency body。
2. Desktop 单测：snapshot 排序/替换/文本提取；dispatcher queue dep；tsgo/build。
3. TUI：status-bar `inbox N`；全量测试。
4. 真机：`GET /api/session/:id/queue` 200；desktop 条在 queue.updated 后出现并能取消（用单元/事件注入验证；若无法制造 busy 队列，记录边界）。
5. 全量 gateway/desktop/SDK/session-ui/TUI + 根 build；部署 v4.33.0。

## 7. 实施记录

- SDK `QueueItem` + `sessions.queueList/queueCancel/queueClear` 类型面 + `promptAsync` 的 `delivery/idempotencyKey/expectReply` 透传；preload 同步。
- Desktop `queue-store`（per-session 快照、排序、文本提取、fetch/cancel/clear）；`queue.updated` 经 dispatcher `queue` dep 进入 store；ChatPane composer 上方「网关队列」条，与本地 turn queue 分开显示。
- TUI `StatusState.gatewayQueued` + 状态栏 `inbox N`；`queue.updated` 更新，切换会话/初始化拉取 `queueList`。
- 单测：SDK 146（+2）、desktop 1430（+9）、gateway 2607、session-ui 89、TUI 225（224 pass / 1 smoke skip）。
- 已知边界：本地 turn queue 仍是用户即时消息的主路径；gateway queue 主要服务 `delivery:'queue'` 的跨客户端/通知消息；gateway 重启队列丢失（queue spec 非目标）。
