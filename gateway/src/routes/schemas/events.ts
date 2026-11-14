/**
 * E5b-1 `GET /api/events/replay` 响应 schema（TypeBox）。
 *
 * 形状来源：`events/event-store.ts` `replayAfter` + `routes/events-replay.ts` 的响应体
 * （handler 是事实源）。只做 OpenAPI 投影，不改变 wire；`emit:openapi` 直接把它写成
 * 200 content schema。
 *
 * `envelope` 是 event_log 里的原始事件对象（形状由运行时事件类型决定，schema 只声明
 * "对象" 并放开 additionalProperties）；客户端按 `seq` 幂等消费，不依赖内层字段。
 *
 * Spec: docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md §3.2
 */
import { Type } from '@sinclair/typebox'

export const EventReplayItem = Type.Object({
  /** event_log 单调 seq（AUTOINCREMENT；客户端游标）。 */
  seq: Type.Number(),
  /** append 时的 ISO 时间戳。 */
  ts: Type.String(),
  /** event_log.type 列投影。 */
  type: Type.String(),
  /** event_log.session_id 列投影（无会话事件为 null）。 */
  sessionId: Type.Union([Type.String(), Type.Null()]),
  /** 原始事件对象。 */
  envelope: Type.Object({}, { additionalProperties: true }),
})

export const EventReplayResponse = Type.Object({
  /** `seq > since` 的升序页（reset 时为空）。 */
  events: Type.Array(EventReplayItem),
  /** 当前 MAX(seq)（空表 0）。 */
  headSeq: Type.Number(),
  /** 当前 MIN(seq)（空表 0）；`since + 1 < oldestSeq` 即缺口。 */
  oldestSeq: Type.Number(),
  /** 满页且最后一行 seq < headSeq → 还有下一页。 */
  hasMore: Type.Boolean(),
  /** 下一页游标：最后一行 seq，否则回显 since；`reset` 时为 `headSeq`（防 reset-loop）。 */
  nextSince: Type.Number(),
  /** `since > headSeq`（DB 重置 / 新纪元）→ 客户端全量重同步。 */
  reset: Type.Boolean(),
  /** `since + 1 < oldestSeq`（保留窗口前移）→ 仍有行返回，但缺口无法补齐。 */
  truncated: Type.Boolean(),
})

// ── E10f-C：event layer 读接口 ──────────────────────────────────────────────
//
// 形状来源是 `core/events/event-types.ts` 的行类型 + `routes/events.ts` 的 handler
// （handler 是事实源）：除 `events.sources.list` 外，handler 把 store 行原样下发
// （含 `projectDir` / `createdAt` 等存储列），所以 schema 必须建模完整行；
// SDK `EventThreadView` / `EventTriggerView` / `EventSubscriptionView` /
// `EventDeliveryView` 是**手写窄投影**（不是投影函数，只是声明窄），与 wire 不等价
// → 这四个按 schema-only 处理，只有 sources 加 AssertEq。

/**
 * `routes/events.ts` `EventSourceView`（`sourceView()` 投影：丢掉 projectDir /
 * config / createdAt，只留客户端需要的游标面）。与 SDK `EventSourceView` 逐字段等价。
 */
export const EventSourceViewSchema = Type.Object({
  id: Type.String(),
  kind: Type.Union([
    Type.Literal('github'),
    Type.Literal('cron'),
    Type.Literal('internal'),
    Type.Literal('webhook'),
  ]),
  name: Type.String(),
  enabled: Type.Boolean(),
  /** 每源增量游标（github etag / last event id 等），由各 source adapter 解释。 */
  cursor: Type.Record(Type.String(), Type.Unknown()),
  updatedAt: Type.String(),
})

/** `GET /api/event-sources?projectDir=`（layer 关闭时 503 `{error}`）。 */
export const EventSourcesResponse = Type.Object({
  items: Type.Array(EventSourceViewSchema),
})

/** `core/events/event-types.ts` `EventThreadRow` —— 外部会话（issue / PR / 通知流）聚合。 */
const EventThreadRowSchema = Type.Object({
  id: Type.String(),
  sourceId: Type.String(),
  projectDir: Type.String(),
  /** 源内稳定键（`owner/repo#123` 等）；一个 thread 一条。 */
  externalKey: Type.String(),
  title: Type.String(),
  state: Type.Union([Type.Literal('open'), Type.Literal('closed'), Type.Literal('archived')]),
  lastTriggerAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
})

/** `GET /api/event-threads?projectDir=&sourceId=`。 */
export const EventThreadsResponse = Type.Object({
  items: Type.Array(EventThreadRowSchema),
})

/** `core/events/event-types.ts` `EventTriggerRow` —— 原始事件入站行（幂等键为唯一约束）。 */
const EventTriggerRowSchema = Type.Object({
  id: Type.String(),
  sourceId: Type.String(),
  threadId: Type.String(),
  externalId: Type.String(),
  /** 源侧事件类型（`issues.opened` / `cron.tick` 等），开放字符串。 */
  kind: Type.String(),
  actor: Type.Union([Type.String(), Type.Null()]),
  /** 原始 webhook payload（owner: 各 source adapter，gateway 不改写）。 */
  payload: Type.Record(Type.String(), Type.Unknown()),
  occurredAt: Type.String(),
  receivedAt: Type.String(),
  idempotencyKey: Type.String(),
  disposition: Type.Union([
    Type.Literal('pending'),
    Type.Literal('evaluating'),
    Type.Literal('accepted'),
    Type.Literal('ignored'),
    Type.Literal('fanned_out'),
    Type.Literal('filtered'),
  ]),
})

/** `GET /api/event-threads/:id/triggers`。 */
export const EventTriggersResponse = Type.Object({
  items: Type.Array(EventTriggerRowSchema),
})

/** `core/events/event-types.ts` `EventSubscriptionRow` —— 订阅者（standing goal / goal / lead）。 */
export const EventSubscriptionRowSchema = Type.Object({
  id: Type.String(),
  threadId: Type.String(),
  subscriberType: Type.Union([
    Type.Literal('standing_goal'),
    Type.Literal('goal'),
    Type.Literal('lead'),
  ]),
  subscriberId: Type.String(),
  /** work = 唤醒执行；context = 只注入上下文。 */
  mode: Type.Union([Type.Literal('work'), Type.Literal('context')]),
  createdAt: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  droppedAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/event-threads/:id/subscriptions`。 */
export const EventSubscriptionsResponse = Type.Object({
  items: Type.Array(EventSubscriptionRowSchema),
})

/** `core/events/event-types.ts` `EventDeliveryRow` —— 投递重试状态机行。 */
const EventDeliveryRowSchema = Type.Object({
  id: Type.String(),
  triggerId: Type.String(),
  subscriptionId: Type.String(),
  state: Type.Union([
    Type.Literal('pending'),
    Type.Literal('delivered'),
    Type.Literal('read'),
    Type.Literal('acknowledged'),
    Type.Literal('answered'),
    Type.Literal('handed_back'),
    Type.Literal('failed'),
    Type.Literal('dropped'),
  ]),
  attempts: Type.Number(),
  lastError: Type.Union([Type.String(), Type.Null()]),
  deliveredAt: Type.Union([Type.String(), Type.Null()]),
  readAt: Type.Union([Type.String(), Type.Null()]),
  ackAt: Type.Union([Type.String(), Type.Null()]),
  answeredAt: Type.Union([Type.String(), Type.Null()]),
  nextRetryAt: Type.Union([Type.String(), Type.Null()]),
})

/** `GET /api/event-deliveries?threadId=`（缺 threadId 时 400 `{error}`）。 */
export const EventDeliveriesResponse = Type.Object({
  items: Type.Array(EventDeliveryRowSchema),
})
