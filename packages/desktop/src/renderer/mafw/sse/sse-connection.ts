/**
 * SSE 连接管理（E1-9 抽取；E2-3 cursor / 分级重同步）。
 *
 * `connectSse()` 原本内联在 MafwShell 组件闭包里（依赖数十个 signal + Solid
 * 生命周期），无法单测；这里把「打开 / 生命周期 / 重试」抽成 deps 注入的管理器，
 * 组件只负责提供 gateway 信息与事件回调，行为逐字保留。
 *
 * 语义（与抽取前一致）：
 *  - 已连接 → connect() 直接返回；
 *  - open() 返回 null（gateway 未就绪）→ 调度 retry；
 *  - onerror 且 readyState === CLOSED（致命关闭）→ 关闭并调度 retry；
 *  - dispose() 清定时器、关连接。
 *
 * E1-9：并发 connect() 必须共享同一个 in-flight promise（此前在 `await` 之前只
 * 检查 `es`，onMount + gateway-ready 两个调用会双开 EventSource）。
 *
 * E2-3（spec 2026-11-11-gateway-e2-recovery §3 E2-3）：
 *  - 游标：`localStorage['mafw-sse-seq']` + `['mafw-sse-instance']`；只有带 SSE
 *    `id:` 的帧推进 seq（greeting / ping 不写）；
 *  - 重连带 `?since=`；greeting 的 reset / truncated / instanceId 变化触发
 *    `onFullResync`（reset 与 instance 变化同时清游标），干净 resume 不触发；
 *  - 每个非首次连接触发 `onReconnect`（B2：part.delta 从不入 journal，活跃会话
 *    必须强制补拉消息 + REST 对账状态）。
 *  - 无 localStorage（或未注入 storage）→ 退化为 E1-9 现状：每次 open 全量同步。
 *
 * E6-1（spec 2026-11-13-gateway-e6-interaction-model §3）：
 *  - 有持久化游标时，先 `recoverGap(since, 500)` 用 REST replay 补齐缺口；
 *  - 补页成功 → 以 `headSeq` 开流（SSE 零回放），`lastAppliedSeq = headSeq`
 *    并把持久化游标推进到 `headSeq`；
 *  - `reset` / `truncated` → 清游标 + `onFullResync(reason)` + 以 `headSeq` 开流；
 *  - 返回 null / 抛错 → 保持原 since，行为与 E2-3 完全一致；
 *  - 首次连接（无游标）不 replay。
 */
import type { GapRecovery } from "./event-replay-gap"

export const SSE_SEQ_KEY = "mafw-sse-seq"
export const SSE_INSTANCE_KEY = "mafw-sse-instance"

/** 最小 Storage 面（测试可注入；localStorage 不可用时传 null）。 */
export interface SseCursorStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** gateway connected greeting 的 replay 元数据（E2-1 字段全集）。 */
export interface SseReplayInfo {
  headSeq: number
  firstReplayedSeq?: number
  truncated?: boolean
  reset?: boolean
  instanceId?: string
  schemaEpoch?: number
}

export type SseResyncReason = "initial" | "truncated" | "reset" | "instance"

export interface SseConnectionDeps {
  /**
   * 解析并创建流；返回 null = 网关尚未就绪（稍后重试）。
   * `since` 为持久化游标（null = 首次/无游标），调用方负责拼进 URL。
   */
  open(since: number | null): Promise<EventSource | null>
  onOpen(source: EventSource): void
  onError(source: EventSource): void
  /** 原始帧（data 字符串；lastEventId = SSE `id:`，供上层观察）。 */
  onMessage(data: string, lastEventId?: string): void
  /** 观测钩子（trace/测试）；重试调度仍由本类负责。 */
  onRetry?(): void
  /**
   * E2-3：需要全量重同步（列表 invalidate / experience reload / 插件描述符等）。
   * reason=initial 表示无游标的首次连接（保持旧行为）。
   */
  onFullResync?(reason: SseResyncReason, info: SseReplayInfo | null): void
  /**
   * E2-3：非首次连接（含带游标的进程重启首连）。上层在此强制补拉活跃会话
   * 消息并 REST 对账状态——不得依赖「消息桶为空」的假设。
   */
  onReconnect?(): void
  /**
   * E6-1：开流前用 REST replay 补 `(since, headSeq]`。null = 不支持/失败，
   * 按原 since 打开（由 SSE greeting 分级触发全量重同步）。
   */
  recoverGap?: (since: number, limit: number) => Promise<GapRecovery | null>
  retryDelayMs?: number
  /** 注入 storage（测试）；undefined = globalThis.localStorage ?? null。 */
  storage?: SseCursorStorage | null
}

const DEFAULT_RETRY_MS = 5000

function defaultStorage(): SseCursorStorage | null {
  try {
    return (globalThis as any).localStorage ?? null
  } catch {
    return null
  }
}

/** 把 since 追加到 SSE URL（保留已有 query）。 */
export function withSince(url: string, since: number | null): string {
  if (since === null) return url
  return `${url}${url.includes("?") ? "&" : "?"}since=${since}`
}

export class SseConnection {
  private es: EventSource | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** E1-9: shared in-flight open so concurrent callers cannot double-connect. */
  private connecting: Promise<void> | null = null
  private readonly storage: SseCursorStorage | null
  /** 本次连接使用的持久化游标（null = 首次/无游标）。 */
  private resumeFromSeq: number | null = null
  /** 成功建立的连接数（跨 dispose 保留：组件重挂载也算 reconnect 语义）。 */
  private successfulConnects = 0
  /** E2 fix F2b：已应用的最大 seq（回放去重；无 seq 帧不受限）。 */
  private lastAppliedSeq: number | null = null
  /** 当前持久化游标（单调前进；防止 sticky lastEventId 回写旧值）。 */
  private cursorSeq: number | null = null

  constructor(private readonly deps: SseConnectionDeps) {
    this.storage = deps.storage === undefined ? defaultStorage() : deps.storage
  }

  /** 当前连接（null = 未连接）。 */
  get source(): EventSource | null {
    return this.es
  }

  connect(): Promise<void> {
    // dispose() then connect() is a legitimate "recreate" (component remount /
    // fatal-close fallback), so a fresh connect clears the disposed flag.
    this.disposed = false
    if (this.es) return Promise.resolve()
    if (this.connecting) return this.connecting
    this.connecting = this.openOnce().finally(() => { this.connecting = null })
    return this.connecting
  }

  private async openOnce(): Promise<void> {
    let since = this.readSeq()
    // E6-1: 有游标先补页；失败/不支持时保持 E2-3 旧路径（SSE greeting 分级）。
    if (since !== null && this.deps.recoverGap) {
      const gap = await this.deps.recoverGap(since, 500).catch(() => null)
      // 非新纪元（无 reset/truncated）时 headSeq 必须 >= 游标；倒挂的响应不可信，
      // 按 null 处理（回退原 since，让 SSE greeting 决定是否重同步）。
      if (gap && (gap.reset || gap.truncated || gap.headSeq >= since)) {
        if (gap.reset || gap.truncated) {
          this.clearSeq()
          this.lastAppliedSeq = null
          this.deps.onFullResync?.(gap.reset ? "reset" : "truncated", { headSeq: gap.headSeq })
        } else {
          this.lastAppliedSeq = gap.headSeq
          // 持久化游标与去重闸对齐：补页已覆盖到 headSeq，重连不应再从旧值回放。
          this.writeSeq(gap.headSeq)
        }
        since = gap.headSeq
      }
    }
    const source = await this.deps.open(since)
    if (!source) {
      this.scheduleRetry()
      return
    }
    if (this.disposed) {
      try { source.close() } catch { /* already closed */ }
      return
    }
    this.es = source
    this.resumeFromSeq = since
    this.cursorSeq = since
    source.onopen = () => {
      this.deps.onOpen(source)
      const isResume = this.resumeFromSeq !== null
      // E2-3: 无游标 → 保持旧行为（每次 open 全量同步）；带游标 → 等 greeting 分级。
      if (!isResume) {
        this.lastAppliedSeq = null // 新纪元/无游标：seq 可能从头开始
        this.deps.onFullResync?.("initial", null)
      }
      // B2: 非首次连接必须补拉活跃会话（part.delta 不入 journal）。
      const isReconnect = this.successfulConnects > 0 || isResume
      this.successfulConnects++
      if (isReconnect) this.deps.onReconnect?.()
    }
    source.onerror = () => {
      this.deps.onError(source)
      // E2 fix F2a：接管重连。Chromium 原生重连复用 open 时的 URL，`?since=`
      // 会一直回放到旧游标（最多 2000 帧）；关掉它，由本类按当前持久化游标重建。
      if (this.es === source) this.es = null
      try { source.close() } catch { /* already closed */ }
      this.scheduleRetry()
    }
    source.onmessage = (e: MessageEvent) => {
      // E2 fix F1：真 EventSource 的 lastEventId 是 sticky 的——greeting（无 id:）
      // 会继承上一帧的 id。必须先解析再判定 greeting，不能让数字 lastEventId 短路。
      let data: any = null
      try { data = JSON.parse(String(e.data)) } catch { /* 保留旧行为：非 JSON 也透传 */ }
      const isGreeting = !!data && data.type === "connected"
      if (isGreeting) this.handleGreeting(data)
      this.advanceCursor(data, isGreeting, e.lastEventId)
      if (!this.shouldApply(data)) return // E2 fix F2b：按 data seq 去重回放
      this.deps.onMessage(String(e.data), e.lastEventId)
    }
  }

  /** 帧内 seq（envelope 顶层或 mafw_event.data 内层）；无 seq（part.delta）= null。 */
  private static seqOf(data: any): number | null {
    const raw = data?.seq ?? data?.data?.seq
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null
  }

  /**
   * E2 fix F1/F2a：游标只由真实数据帧推进（greeting 的 sticky id 不算），
   * 且单调前进（sticky 旧 id 不得把已持久化的游标写回退）。
   */
  private advanceCursor(data: any, isGreeting: boolean, lastEventId: string | undefined): void {
    if (isGreeting) return
    const seq = SseConnection.seqOf(data)
    if (seq !== null) {
      this.writeSeq(seq)
      return
    }
    if (typeof lastEventId === "string" && /^\d+$/.test(lastEventId)) {
      this.writeSeq(Number(lastEventId))
    }
  }

  /**
   * E2 fix F2b：seq ≤ lastAppliedSeq 的回放帧不再分发（真实副作用不重复），
   * 无 seq 帧（part.delta / 非持久化）永远应用；全量重同步时闸门重置。
   */
  private shouldApply(data: any): boolean {
    const seq = SseConnection.seqOf(data)
    if (seq === null) return true
    if (this.lastAppliedSeq !== null && seq <= this.lastAppliedSeq) return false
    this.lastAppliedSeq = seq
    return true
  }

  private handleGreeting(data: any): void {
    const info: SseReplayInfo = {
      headSeq: typeof data.headSeq === "number" ? data.headSeq : 0,
      firstReplayedSeq: data.firstReplayedSeq,
      truncated: data.truncated,
      reset: data.reset,
      instanceId: data.instanceId,
      schemaEpoch: data.schemaEpoch,
    }
    const persistedInstance = this.readInstance()
    const greetingInstance = typeof data.instanceId === "string" && data.instanceId ? data.instanceId : null
    if (greetingInstance) this.writeInstance(greetingInstance)

    const reset = data.reset === true
    const truncated = data.truncated === true
    // 旧版网关 greeting 无 instanceId：本地已记录实例时无法证明纪元未变 → 保守整表重同步。
    const instanceChanged = persistedInstance !== null
      && (greetingInstance === null || greetingInstance !== persistedInstance)

    if (reset || instanceChanged) this.clearSeq()
    if (this.resumeFromSeq === null) return // 首次连接已在 open 时全量同步
    if (reset) {
      this.lastAppliedSeq = null
      this.deps.onFullResync?.("reset", info)
    } else if (truncated) {
      this.lastAppliedSeq = null
      this.deps.onFullResync?.("truncated", info)
    } else if (instanceChanged) {
      this.lastAppliedSeq = null
      this.deps.onFullResync?.("instance", info)
    }
  }

  private readSeq(): number | null {
    try {
      const raw = this.storage?.getItem(SSE_SEQ_KEY)
      return raw && /^\d+$/.test(raw) ? Number(raw) : null
    } catch {
      return null
    }
  }

  private writeSeq(seq: number): void {
    // 单调前进：sticky lastEventId 可能携带旧值，不能把游标写回退。
    if (this.cursorSeq !== null && seq < this.cursorSeq) return
    this.cursorSeq = seq
    try { this.storage?.setItem(SSE_SEQ_KEY, String(seq)) } catch { /* storage unavailable */ }
  }

  private clearSeq(): void {
    this.cursorSeq = null
    try { this.storage?.removeItem(SSE_SEQ_KEY) } catch { /* storage unavailable */ }
  }

  private readInstance(): string | null {
    try {
      const raw = this.storage?.getItem(SSE_INSTANCE_KEY)
      return raw && raw.length > 0 ? raw : null
    } catch {
      return null
    }
  }

  private writeInstance(instanceId: string): void {
    try { this.storage?.setItem(SSE_INSTANCE_KEY, instanceId) } catch { /* storage unavailable */ }
  }

  /** 调度一次重连（幂等：已有定时器时不叠加）。 */
  scheduleRetry(): void {
    if (this.disposed || this.retryTimer) return
    this.deps.onRetry?.()
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
    }, this.deps.retryDelayMs ?? DEFAULT_RETRY_MS)
  }

  dispose(): void {
    this.disposed = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.es) {
      try { this.es.close() } catch { /* already closed */ }
      this.es = null
    }
  }
}
