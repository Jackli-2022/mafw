/**
 * SSE 连接管理（E1-9 抽取）。
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
 */
export interface SseConnectionDeps {
  /** 解析并创建流；返回 null = 网关尚未就绪（稍后重试）。 */
  open(): Promise<EventSource | null>
  onOpen(source: EventSource): void
  onError(source: EventSource): void
  onMessage(data: string): void
  /** 观测钩子（trace/测试）；重试调度仍由本类负责。 */
  onRetry?(): void
  retryDelayMs?: number
}

const DEFAULT_RETRY_MS = 5000

export class SseConnection {
  private es: EventSource | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  /** E1-9: shared in-flight open so concurrent callers cannot double-connect. */
  private connecting: Promise<void> | null = null

  constructor(private readonly deps: SseConnectionDeps) {}

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
    const source = await this.deps.open()
    if (!source) {
      this.scheduleRetry()
      return
    }
    if (this.disposed) {
      try { source.close() } catch { /* already closed */ }
      return
    }
    this.es = source
    source.onopen = () => this.deps.onOpen(source)
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
    source.onmessage = (e: MessageEvent) => this.deps.onMessage(String(e.data))
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
