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
 */
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
    const since = this.readSeq()
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
    source.onopen = () => {
      this.deps.onOpen(source)
      const isResume = this.resumeFromSeq !== null
      // E2-3: 无游标 → 保持旧行为（每次 open 全量同步）；带游标 → 等 greeting 分级。
      if (!isResume) this.deps.onFullResync?.("initial", null)
      // B2: 非首次连接必须补拉活跃会话（part.delta 不入 journal）。
      const isReconnect = this.successfulConnects > 0 || isResume
      this.successfulConnects++
      if (isReconnect) this.deps.onReconnect?.()
    }
    source.onerror = () => {
      this.deps.onError(source)
      if (source.readyState === EventSource.CLOSED) {
        // Fatal close (server gone / non-SSE response): EventSource won't
        // retry on its own — recreate on a short delay.
        this.es = null
        try { source.close() } catch { /* already closed */ }
        this.scheduleRetry()
      }
    }
    source.onmessage = (e: MessageEvent) => {
      this.observeFrame(e)
      this.deps.onMessage(String(e.data), e.lastEventId)
    }
  }

  /**
   * E2-3: 只从带 `id:` 的帧推进游标；connected greeting 参与 epoch/truncated
   * 分级（不写游标）。
   */
  private observeFrame(e: MessageEvent): void {
    const rawId = e.lastEventId
    if (typeof rawId === "string" && /^\d+$/.test(rawId)) {
      this.writeSeq(Number(rawId))
      return
    }
    let data: any
    try { data = JSON.parse(String(e.data)) } catch { return }
    if (!data || data.type !== "connected") return
    this.handleGreeting(data)
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
    if (reset) this.deps.onFullResync?.("reset", info)
    else if (truncated) this.deps.onFullResync?.("truncated", info)
    else if (instanceChanged) this.deps.onFullResync?.("instance", info)
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
    try { this.storage?.setItem(SSE_SEQ_KEY, String(seq)) } catch { /* storage unavailable */ }
  }

  private clearSeq(): void {
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
