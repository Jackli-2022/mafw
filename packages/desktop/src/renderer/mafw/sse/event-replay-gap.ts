/**
 * E6-1：SSE 开流前的 REST replay 补页（spec 2026-11-13-gateway-e6-interaction-model §3.3）。
 *
 * 断线期间的事件由 gateway 的 `GET /api/events/replay`（E5b-1）按 seq 补齐；
 * 这里把「分页循环 + 形状校验 + 失败回退」抽成纯逻辑（fetch 注入，可单测）：
 *
 *  - `since` 必须是非负安全整数；`limit` 缺省 500、clamp 1..1000；
 *  - 每页把 `{ ...envelope, seq: item.seq }` 交给 `dispatch`（seq 以 item 为准，
 *    不依赖 envelope 自带字段）；
 *  - `hasMore` 继续翻页；`nextSince` 必须单调前进，页数硬上限 100；
 *  - `reset` / `truncated` 返回信号并停止（调用方做全量重同步）；
 *  - 404 / HTML / 503 / 非 ok / 网络异常 / 非法 JSON / 形状不符 → `null`
 *    （调用方回退现有 `open(since)` 路径，由 SSE greeting 分级）。
 */
export interface GapRecovery {
  headSeq: number
  applied: number
  reset?: boolean
  truncated?: boolean
}

export interface RecoverEventGapInput {
  baseUrl: string
  since: number
  limit?: number
  fetchImpl?: typeof fetch
  dispatch: (event: unknown) => void
}

/** 与 gateway `EVENTS_REPLAY_DEFAULT_LIMIT` 对齐。 */
export const REPLAY_GAP_DEFAULT_LIMIT = 500
/** 与 gateway `EVENTS_REPLAY_MAX_LIMIT` 对齐。 */
export const REPLAY_GAP_MAX_LIMIT = 1000
/** 单次恢复的页数硬上限（防服务器异常时无限翻页）。 */
export const REPLAY_GAP_MAX_PAGES = 100

interface ReplayItem {
  seq: number
  envelope: unknown
}

interface ReplayPage {
  events: ReplayItem[]
  headSeq: number
  nextSince: number
  hasMore: boolean
  reset: boolean
  truncated: boolean
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) return REPLAY_GAP_DEFAULT_LIMIT
  return Math.min(REPLAY_GAP_MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

function parsePage(body: unknown, cursor: number): ReplayPage | null {
  if (!body || typeof body !== "object") return null
  const raw = body as Record<string, unknown>
  if (!Array.isArray(raw.events)) return null
  if (!isNonNegativeInt(raw.headSeq)) return null

  const events: ReplayItem[] = []
  for (const item of raw.events) {
    if (!item || typeof item !== "object") return null
    const event = item as Record<string, unknown>
    if (typeof event.seq !== "number" || !Number.isFinite(event.seq)) return null
    events.push({ seq: event.seq, envelope: event.envelope })
  }

  const lastSeq = events.length > 0 ? events[events.length - 1].seq : null
  const nextSince = typeof raw.nextSince === "number" && Number.isFinite(raw.nextSince)
    ? raw.nextSince
    : (lastSeq ?? cursor)

  return {
    events,
    headSeq: raw.headSeq,
    nextSince,
    hasMore: raw.hasMore === true,
    reset: raw.reset === true,
    truncated: raw.truncated === true,
  }
}

/** 递归把 envelope 的 seq 覆盖为 item.seq；非对象 envelope 退化为纯 seq 帧。 */
function withSeq(envelope: unknown, seq: number): unknown {
  if (envelope && typeof envelope === "object") return { ...(envelope as object), seq }
  return { seq }
}

export async function recoverEventGap(input: RecoverEventGapInput): Promise<GapRecovery | null> {
  const { baseUrl, since, dispatch } = input
  if (!isNonNegativeInt(since)) return null

  const base = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : ""
  if (!base) return null

  const limit = normalizeLimit(input.limit)
  const fetchImpl = input.fetchImpl ?? (typeof fetch === "function" ? fetch : null)
  if (!fetchImpl) return null

  let cursor = since
  let headSeq: number | null = null
  let applied = 0

  for (let pageNo = 0; pageNo < REPLAY_GAP_MAX_PAGES; pageNo++) {
    let response: Response
    try {
      response = await fetchImpl(`${base}/api/events/replay?since=${cursor}&limit=${limit}`)
    } catch {
      return null
    }
    if (!response || !response.ok) return null

    let body: unknown
    try {
      body = await response.json()
    } catch {
      return null
    }

    const page = parsePage(body, cursor)
    if (!page) return null

    for (const item of page.events) {
      try {
        dispatch(withSeq(item.envelope, item.seq))
      } catch {
        return null
      }
      applied++
    }

    if (page.reset || page.truncated) {
      const signal: GapRecovery = { headSeq: page.headSeq, applied }
      if (page.reset) signal.reset = true
      if (page.truncated) signal.truncated = true
      return signal
    }

    headSeq = headSeq === null ? page.headSeq : Math.max(headSeq, page.headSeq)
    if (!page.hasMore) return { headSeq, applied }

    // 游标不前进 = 服务器异常/参数被忽略：回退旧路径，绝不无限循环。
    if (page.nextSince <= cursor) return null
    cursor = page.nextSince
  }

  // 页数上限仍未追平：放弃本次补页（回退旧路径）。
  return null
}
