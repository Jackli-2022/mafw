/**
 * E5b-1 `GET /api/events/replay` —— event_log 升序分页恢复源（internal）。
 *
 * 与 SSE（live + newest-window）互补：断线客户端带着自己的 `since` 游标逐页补齐。
 *
 * 参数契约：
 *   - `since`：非负整数，缺省 `0`；非法（符号/小数/科学计数/空串/非数字）→ 400
 *     `{error:'invalid since'}`。
 *   - `limit`：整数 1..1000，缺省 `500`；非数字 / `<= 0` / 小数 → 400
 *     `{error:'invalid limit'}`；`> 1000` **clamp** 到 1000（客户端不必先知道上限）。
 *
 * 响应语义（spec §3.2）：
 *   - `reset = since > headSeq`：DB 重置 / 新纪元 → `events:[]`，客户端全量重同步；
 *     `nextSince = headSeq`（不是回显 `since`）——否则客户端把 `nextSince` 持久化成
 *     游标后会继续 `since > headSeq`，每次重连都 reset-loop。
 *   - `truncated = !reset && since + 1 < oldestSeq`：缺口在保留窗口之外，仍返回能读到
 *     的行，但客户端应全量重同步。
 *   - `hasMore = rows.length === limit && lastSeq < headSeq`。
 *   - `nextSince = lastSeq ?? since`（reset 除外，见上；循环游标，单调）。
 *
 * EventStore 为 null（初始化失败降级）→ 503 `{error:'event store unavailable'}`；
 * 与 SSE 的 null store 语义一致，不伪装成空事件页（否则客户端会误以为"已追平"）。
 * 鉴权沿用普通 API（loopback / human / device / service），本模块不新增认证面。
 *
 * 用字面 `attachHandler('event.replay')`（而非 attachTypedRoute）——api-contract 的
 * 可达性守卫按源码字面量扫描 attach 证据；schema 在 catalog def 上。
 *
 * Spec: docs/superpowers/specs/2026-11-12-gateway-e5b-event-recovery-design.md §3
 */
import type { IncomingMessage, ServerResponse } from 'http'
import type { EventStore } from '../events/event-store'
import type { RouteRegistry } from './registry'

/** 缺省页大小（客户端不必传 limit 时的恢复粒度）。 */
export const EVENTS_REPLAY_DEFAULT_LIMIT = 500
/** 单页硬上限（防止一次恢复拖垮重连）。 */
export const EVENTS_REPLAY_MAX_LIMIT = 1000

export interface EventsReplayRouteDeps {
  /** live getter；null = EventStore 初始化失败的降级语义。 */
  eventStore: () => EventStore | null
}

/** 严格非负十进制整数；拒绝符号 / 小数 / 科学计数 / 前后空格 / 空串 / 超安全整数。 */
function parseCount(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

export function attachEventsReplayRoute(registry: RouteRegistry, deps: EventsReplayRouteDeps): void {
  registry.attachHandler('event.replay', async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, `http://${req.headers.host || 'localhost'}`)

    const rawSince = url.searchParams.get('since')
    const since = rawSince === null ? 0 : parseCount(rawSince)
    if (since === null) {
      sendJson(res, 400, { error: 'invalid since' })
      return
    }

    const rawLimit = url.searchParams.get('limit')
    const parsedLimit = rawLimit === null ? EVENTS_REPLAY_DEFAULT_LIMIT : parseCount(rawLimit)
    if (parsedLimit === null || parsedLimit < 1) {
      sendJson(res, 400, { error: 'invalid limit' })
      return
    }
    const limit = Math.min(parsedLimit, EVENTS_REPLAY_MAX_LIMIT)

    const store = deps.eventStore()
    if (!store) {
      sendJson(res, 503, { error: 'event store unavailable' })
      return
    }

    const page = store.replayAfter(since, limit)
    const { headSeq, oldestSeq } = page
    // reset 是"新纪元"：即使 store 异常地返回了行也不能发给客户端（游标已不适用）。
    const reset = since > headSeq
    const truncated = !reset && since + 1 < oldestSeq
    const rows = reset ? [] : page.rows
    const lastSeq = rows.length > 0 ? rows[rows.length - 1].seq : null
    const hasMore = rows.length === limit && lastSeq !== null && lastSeq < headSeq

    sendJson(res, 200, {
      events: rows.map((r) => ({
        seq: r.seq,
        ts: r.ts,
        type: r.type,
        sessionId: r.sessionId,
        envelope: r.envelope,
      })),
      headSeq,
      oldestSeq,
      hasMore,
      // reset = 新纪元：把游标钉到 headSeq，避免客户端持久化 since 后反复 reset-loop。
      nextSince: reset ? headSeq : (lastSeq ?? since),
      reset,
      truncated,
    })
  })
}
