/**
 * E6-1：SSE 开流前的 REST replay 补页（spec 2026-11-13-gateway-e6-interaction-model §3.3）。
 *
 * 断线期间的事件由 gateway 的 `GET /api/events/replay`（E5b-1）按 seq 补齐；
 * 这里把「分页循环 + 形状校验 + 失败回退」抽成纯逻辑（fetch 注入，可单测）：
 *
 *  - `since` 必须是非负安全整数；`limit` 缺省 500、clamp 1..1000；
 *  - 每页把事件交给 `dispatch`：canonical `mafw_event` 信封先解包 `data`
 *    （与 live `raw?.data || raw` 一致），再覆盖 `seq: item.seq`（seq 以 item 为准）；
 *  - `hasMore` 继续翻页；`nextSince` 必须单调前进，页数硬上限 100；
 *  - `reset` / `truncated` 返回信号并停止（调用方做全量重同步）。返回前已 dispatch
 *    的行会被随后的全量重同步 invalidate，属于安全冗余；
 *  - 单次请求有超时（`timeoutMs`，缺省 5s）：fetch 永不 settle 也不会挂死重连；
 *  - 404 / HTML / 503 / 非 ok / 网络异常 / 超时 / 非法 JSON / 形状不符 → `null`
 *    （调用方回退现有 `open(since)` 路径，由 SSE greeting 分级）。
 *
 * 注意：页数上限或分页异常导致的「部分补页后回退」可能让已 dispatch 的行在 SSE
 * greeting 回放里再出现一次；消费侧 store 均为幂等 upsert，重复应用是安全的。
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
  /** 单次 replay 请求超时（缺省 5s）；超时 → null（回退旧路径）。 */
  timeoutMs?: number
  fetchImpl?: typeof fetch
  dispatch: (event: unknown) => void
}

/** 与 gateway `EVENTS_REPLAY_DEFAULT_LIMIT` 对齐。 */
export const REPLAY_GAP_DEFAULT_LIMIT = 500
/** 与 gateway `EVENTS_REPLAY_MAX_LIMIT` 对齐。 */
export const REPLAY_GAP_MAX_LIMIT = 1000
/** 单次恢复的页数硬上限（防服务器异常时无限翻页）。 */
export const REPLAY_GAP_MAX_PAGES = 100
/** 单次 replay 请求的超时（网络黑洞不得拖住 SSE 重连）。 */
export const REPLAY_GAP_TIMEOUT_MS = 5000

/** 超时哨兵（fetch 永不 settle 时的 race 结果）。 */
const TIMED_OUT = Symbol("replay-timeout")

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

/**
 * 把 replay item 变成 dispatcher 可直接消费的事件：
 *  - canonical `mafw_event` 信封（event_log 存的就是 broadcast 帧）→ 解包 `data`，
 *    与 live `dispatchShellEvent(raw?.data || raw)` 行为一致；
 *  - 其余（扁平事件 / data 非对象）保持原信封；
 *  - 两种情况都把 seq 覆盖为 item.seq（seq 是 additive 权威，不依赖 envelope）。
 */
function toDispatchEvent(envelope: unknown, seq: number): unknown {
  if (!envelope || typeof envelope !== "object") return { seq }
  const record = envelope as Record<string, unknown>
  if (
    record.type === "mafw_event"
    && record.data !== null
    && typeof record.data === "object"
    && !Array.isArray(record.data)
  ) {
    return { ...(record.data as object), seq }
  }
  return { ...record, seq }
}

/** 单页读取结果：``null`` = 超时/网络异常（回退旧路径）。 */
type PageRead = { ok: false } | { ok: true; body: unknown }

/**
 * 单次 replay 请求（fetch + body 读取共享同一个超时预算）。
 * 真实 fetch 走 AbortSignal；注入的 fetch（测试/永不 settle）由显式 race 兜底——
 * 超时一律返回 `null`，绝不挂住 SSE 重连。
 */
async function readReplayPage(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<PageRead | null> {
  const controller = typeof AbortController === "function" ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => {
        try { controller?.abort() } catch { /* ignore */ }
        resolve(TIMED_OUT)
      }, timeoutMs)
    })
    const response = await Promise.race([
      fetchImpl(url, controller ? { signal: controller.signal } : undefined),
      timeout,
    ])
    if (response === TIMED_OUT) return null
    if (!response || !response.ok) return { ok: false }
    // body 也可能被黑洞卡住：同一个超时 promise 继续兜底。
    const body = await Promise.race([response.json(), timeout])
    if (body === TIMED_OUT) return null
    return { ok: true, body }
  } catch {
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

export async function recoverEventGap(input: RecoverEventGapInput): Promise<GapRecovery | null> {
  const { baseUrl, since, dispatch } = input
  if (!isNonNegativeInt(since)) return null

  const base = typeof baseUrl === "string" ? baseUrl.trim().replace(/\/+$/, "") : ""
  if (!base) return null

  const limit = normalizeLimit(input.limit)
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
    ? Math.max(1, Math.trunc(input.timeoutMs))
    : REPLAY_GAP_TIMEOUT_MS
  const fetchImpl = input.fetchImpl ?? (typeof fetch === "function" ? fetch : null)
  if (!fetchImpl) return null

  let cursor = since
  let headSeq: number | null = null
  let applied = 0

  for (let pageNo = 0; pageNo < REPLAY_GAP_MAX_PAGES; pageNo++) {
    const pageRead = await readReplayPage(
      `${base}/api/events/replay?since=${cursor}&limit=${limit}`,
      fetchImpl,
      timeoutMs,
    )
    if (!pageRead || !pageRead.ok) return null

    const page = parsePage(pageRead.body, cursor)
    if (!page) return null

    for (const item of page.events) {
      try {
        dispatch(toDispatchEvent(item.envelope, item.seq))
      } catch {
        return null
      }
      applied++
    }

    // reset/truncated：行已 dispatch，随后调用方 onFullResync 会 invalidate 全部
    // store，因此这里的顺序是安全的；立即返回信号，不再继续翻页。
    if (page.reset || page.truncated) {
      const signal: GapRecovery = { headSeq: page.headSeq, applied }
      if (page.reset) signal.reset = true
      if (page.truncated) signal.truncated = true
      return signal
    }

    headSeq = headSeq === null ? page.headSeq : Math.max(headSeq, page.headSeq)
    if (!page.hasMore) {
      // 游标倒挂（head 比 since 还旧）且非新纪元：形状不可信 → 回退旧路径。
      if (headSeq < since) return null
      return { headSeq, applied }
    }

    // 游标不前进 = 服务器异常/参数被忽略：回退旧路径，绝不无限循环。
    if (page.nextSince <= cursor) return null
    cursor = page.nextSince
  }

  // 页数上限仍未追平：放弃本次补页（回退旧路径）。
  return null
}
