/**
 * E10g-W5：event 写接口的请求体 schema（`RouteDef.request`）。
 *
 * 只有声明，不做运行时校验：字段面逐项来自 handler 的实际读取
 * （`routes/event-publish.ts`、`routes/events.ts`）。条件必填 / 条件生效用
 * description 说明，不伪造 oneOf/anyOf 把契约做得比 handler 更严。
 *
 * 分类（与 W1-W4 同口径）：
 *   - JSON body（`requestRequired` 缺省 true）：`event.publish`、
 *     `events.sources.create`、`events.sources.patch`、
 *     `events.threads.subscriptions.create`；
 *   - 可选 body + 边界对象（`requestRequired:false` + `additionalProperties:true`）：
 *     `events.webhook.receive` —— 见下；
 *   - 空对象 + `requestRequired:false`（`EmptyRequest`，见 `schemas/session-write.ts`）：
 *     `events.threads.close` / `events.subscriptions.delete` 的 handler 只读路径 id。
 */
import { Type } from '@sinclair/typebox'

/** `EventSourceKind`（`core/events/event-types.ts`）：`handleCreateSource` 用 SOURCE_KINDS 收窄。 */
const EventSourceKind = Type.Union([
  Type.Literal('github'),
  Type.Literal('cron'),
  Type.Literal('internal'),
  Type.Literal('webhook'),
])

// ── event.publish ─────────────────────────────────────────────────────────

/**
 * `POST /api/events`（handler：`routes/event-publish.ts` `handleEventPublish`）。
 *
 * 顶层扁平信封 `{ type: 'plugin:<name>:<event>', ...payload }` 原样广播（SSE 通知语义，
 * 无类型注册制）。`type` 必须是**非空字符串**且不是保留名：
 * gateway / runtime 自有事件名（EVENT_FLOW_MATRIX canonical + 扁平名、`mafw_event` 信封、
 * runtime 原生 `sync`）一律 400 —— 契约只声明「非空字符串」，保留名是运行时策略
 * （清单随事件矩阵演进，写进 schema 会立刻过期）。
 *
 * 其余键是自定义负载：`payload` 不是固定字段，因此 `additionalProperties:true`。
 */
export const EventPublishRequest = Type.Object(
  {
    type: Type.String({
      minLength: 1,
      description: "Custom event name; recommended namespace 'plugin:<name>:<event>'. Reserved gateway/runtime names are 400.",
    }),
  },
  {
    additionalProperties: true,
    description: 'Flat envelope: `type` plus arbitrary payload keys (broadcast verbatim).',
  },
)

// ── events.sources.create ─────────────────────────────────────────────────

/**
 * `POST /api/event-sources`（handler：`routes/events.ts` `handleCreateSource`）。
 * `kind` 必须是四类之一、`name` trim 后非空（否则 400）；`config` 是各 source
 * adapter 的配置面（github repo / cron 表达式 …），owner = adapter，gateway 原样落库；
 * `projectDir` 缺省回退 `MAFW_PROJECT_DIR` → cwd（`projectDirOf`），故不声明为必填。
 */
export const EventSourceCreateRequest = Type.Object({
  kind: EventSourceKind,
  name: Type.String({ minLength: 1 }),
  config: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
    description: 'Source-adapter specific config, stored verbatim (owner: each event source adapter).',
  })),
  projectDir: Type.Optional(Type.String({
    description: 'Defaults to MAFW_PROJECT_DIR / cwd when absent (handler projectDirOf).',
  })),
})

// ── events.sources.patch ──────────────────────────────────────────────────

/**
 * `PATCH /api/event-sources/:id`（handler 同上 `handlePatchSource`）。
 * PATCH 只支持开关：`enabled` 必须是 boolean（不是 boolean → 400），
 * 其余 body 键被 handler 忽略（不改 name / config）。id 不存在 → 404。
 */
export const EventSourcePatchRequest = Type.Object({
  enabled: Type.Boolean(),
})

// ── events.threads.close / events.subscriptions.delete ────────────────────

// `events.threads.close` 用 `EmptyRequest` + `requestRequired:false`：
// `handleCloseThread` / `handleDeleteSubscription` 只读路径 id，body 完全不读。
// 使用方见 `route-catalog.ts`。

// ── events.threads.subscriptions.create ───────────────────────────────────

/**
 * `POST /api/event-threads/:id/subscriptions`（handler 同上
 * `handleCreateSubscription`）。handler 合并 `{ id: params.id, ...body }`：
 * `subscriberType` / `subscriberId` trim 后非空、`mode` 必须是 work|context，
 * 否则 400（`subscriberType` 的其余取值由 store 的类型收窄为三类订阅者）。
 */
export const EventSubscriptionCreateRequest = Type.Object({
  subscriberType: Type.Union([
    Type.Literal('standing_goal'),
    Type.Literal('goal'),
    Type.Literal('lead'),
  ]),
  subscriberId: Type.String({ minLength: 1 }),
  mode: Type.Union([Type.Literal('work'), Type.Literal('context')], {
    description: 'work = wake the subscriber; context = inject context only.',
  }),
})

// ── events.webhook.receive ────────────────────────────────────────────────

/**
 * `POST /api/event-sources/:id/webhook`（handler 同上 `handleWebhook`）。
 *
 * **协议透传边界**：body 是**上游源定义**的任意 JSON（GitHub push / generic webhook …），
 * gateway 不解释字段，只把 `body` + 原始字符串 + headers 交给 source adapter 做签名校验
 * 与幂等键提取（`deps.webhook(id, headers, body, rawBody)`）。因此这里只能声明
 * 「任意 JSON 对象」：`additionalProperties:true` 且无 `properties` —— 这是**有意的边界**，
 * 不是遗漏。签名头（`x-hub-signature-256` 等）不是 body 字段，不在 schema 内。
 *
 * body 可缺省：handler 解析失败按空对象继续，由 adapter 的签名/校验决定 401。
 */
export const EventWebhookReceiveRequest = Type.Object({}, {
  additionalProperties: true,
  description: 'Source-defined JSON payload, passed verbatim to the event source adapter (signature / idempotency are header- and raw-body-based).',
})
