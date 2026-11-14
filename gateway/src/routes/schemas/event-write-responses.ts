/**
 * E10h-R4：event 域写接口（7 个 op）的 200 响应 schema（`RouteDef.response`）。
 *
 * 只声明 OpenAPI 元数据，不做运行时校验；handler 是事实源：
 *   - `routes/event-publish.ts`（event.publish）
 *   - `routes/events.ts`（sources.create / sources.patch / threads.close /
 *     threads.subscriptions.create / subscriptions.delete / webhook.receive）
 *
 * 复用的读侧 DTO（不写第二份转写）：
 *   - `EventSourceViewSchema` —— `GET /api/event-sources` 的 item（同一个
 *     `sourceView()` 投影，`events.sources.create` 直接返回它）；
 *   - `EventSubscriptionRowSchema` —— `events.threads.subscriptions.list` 的 item
 *     （`events.threads.subscriptions.create` 返回 store 行本体，未做窄投影）。
 *
 * 错误体（400 / 401 / 404 / 503，含 layer 关闭的 `{error:'event layer disabled'}`）
 * 不属于 200 形态，不在此建模。
 */
import { Type } from '@sinclair/typebox'
import { EventSourceViewSchema, EventSubscriptionRowSchema } from './events'
import { OkResponse } from './session-write-responses'

// ── event.publish ───────────────────────────────────────────────────────────

/**
 * `POST /api/events`（handler：`handleEventPublish` 尾行 `send(200, { ok: true })`）。
 * 广播是 fire-and-forget：200 只表示「已入通道」，不回显事件体。
 */
export const EventPublishResponse = OkResponse

// ── events.sources.create ──────────────────────────────────────────────────

/**
 * `POST /api/event-sources`（handler：`handleCreateSource` → `sourceView(row)`）。
 * 与 `events.sources.list` 的 item 严格同形（同一个投影函数）。
 */
export const EventSourceCreateResponse = EventSourceViewSchema

// ── events.sources.patch ───────────────────────────────────────────────────

/**
 * `PATCH /api/event-sources/:id`（handler：`handlePatchSource`）：`setEnabled()`
 * 成功才 200（id 不存在是 404），body 是 `{ok:true}`——不回显更新后的行。
 */
export const EventSourcePatchResponse = OkResponse

// ── events.threads.close ───────────────────────────────────────────────────

/**
 * `POST /api/event-threads/:id/close`（handler：`handleCloseThread` →
 * `deps.threads.close(id)`，实现是 `EventLayerService.closeThread()`）。
 *
 * `closed` 在唯一的实现里恒为 `true`（关闭失败是 404），但路由的端口类型
 * （`EventRouteDeps['threads']['close']`）声明为 boolean，SDK
 * `events.closeThread` 也是 boolean ——这里跟端口/DTO 走，不缩成字面量。
 * 两个计数是本次关闭实际迁移的投递数：`handedBack`（已投递/已读/失败 → 交回）
 * 与 `dropped`（pending → 丢弃）。
 */
export const EventThreadCloseResponse = Type.Object({
  closed: Type.Boolean(),
  handedBack: Type.Number(),
  dropped: Type.Number(),
})

// ── events.threads.subscriptions.create ────────────────────────────────────

/**
 * `POST /api/event-threads/:id/subscriptions`（handler：`handleCreateSubscription`
 * → `deps.subscribe(...)`）。返回 store 行本体（含 `threadId` / `expiresAt` /
 * `droppedAt`），不是 SDK 的手写窄投影 `EventSubscriptionView`。
 */
export const EventSubscriptionCreateResponse = EventSubscriptionRowSchema

// ── events.subscriptions.delete ────────────────────────────────────────────

/**
 * `DELETE /api/event-subscriptions/:id`（handler：`handleDeleteSubscription`）：
 * `unsubscribe()` 成功才 200（id 不存在是 404），body `{ok:true}`。
 */
export const EventSubscriptionDeleteResponse = OkResponse

// ── events.webhook.receive ─────────────────────────────────────────────────

/**
 * `POST /api/event-sources/:id/webhook`（handler：`handleWebhook`）。
 *
 * **请求体是源定义的边界**（`event-write.ts` 的 `EventWebhookReceiveRequest`：
 * GitHub push / generic webhook 任意 JSON，签名与幂等键走 header + 原始 body）。
 * 但 **200 响应不归源所有**：handler 只回网关自己的回执
 * `{accepted:true, duplicate:result.duplicate ?? false}`——`accepted` 恒为 true
 * （未接受是 401/`fail()`），`duplicate` 表示幂等键命中、本次未入库。
 * 因此这里建模确定形状，而不是开放对象。
 */
export const EventWebhookReceiveResponse = Type.Object({
  accepted: Type.Literal(true),
  duplicate: Type.Boolean(),
})
