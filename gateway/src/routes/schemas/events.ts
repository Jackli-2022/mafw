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
  /** 下一页游标：最后一行 seq，否则回显 since。 */
  nextSince: Type.Number(),
  /** `since > headSeq`（DB 重置 / 新纪元）→ 客户端全量重同步。 */
  reset: Type.Boolean(),
  /** `since + 1 < oldestSeq`（保留窗口前移）→ 仍有行返回，但缺口无法补齐。 */
  truncated: Type.Boolean(),
})
