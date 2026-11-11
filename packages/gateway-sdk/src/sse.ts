export type SSECallback = (data: any) => void

/** E2-2: 客户端持久化的重连游标（SSE `id:` / event_log seq）。 */
export interface SseCursor {
  get(): number | null
  set(seq: number): void
}

/** E2-2: greeting 元数据（网关 E2-1 起携带 epoch/reset/truncated）。 */
export interface SseReplayInfo {
  headSeq: number
  firstReplayedSeq?: number
  truncated?: boolean
  reset?: boolean
  instanceId?: string
  schemaEpoch?: number
}

/**
 * E2-2: 可恢复订阅选项。两者都可选——不传时与旧行为完全一致（无 since，
 * greeting 只按普通事件分发）。
 */
export interface SseSubscribeOptions {
  /** 重连游标：get() → URL `?since=`；每个带 `id:` 的帧写回 set()。 */
  cursor?: SseCursor
  /** 收到 connected greeting 时回调；客户端据此判定 truncated/reset 后全量重同步。 */
  onReplayInfo?(info: SseReplayInfo): void
}

export class SSEConnection {
  private eventSource: EventSource | null = null
  private listeners: Map<string, Set<SSECallback>> = new Map()
  private _connected = false
  private subscribeOptions: SseSubscribeOptions | null = null

  get connected(): boolean {
    return this._connected
  }

  /**
   * E2-2: 可恢复订阅（connect 的协议化入口）。cursor.get() 非空时 URL 追加
   * `?since=N`；带 `id:` 的帧把 seq 写回 cursor；greeting 经 onReplayInfo 暴露
   * headSeq/truncated/reset/instanceId/schemaEpoch。
   */
  subscribe(baseUrl: string, opts?: SseSubscribeOptions): void {
    this.connect(baseUrl, opts)
  }

  connect(baseUrl: string, opts?: SseSubscribeOptions): void {
    this.disconnect()
    this.subscribeOptions = opts ?? null
    const since = opts?.cursor?.get() ?? null
    const url = since !== null
      ? `${baseUrl}/api/events?since=${since}`
      : `${baseUrl}/api/events`
    this.eventSource = new EventSource(url)
    this.eventSource.onopen = () => { this._connected = true }
    this.eventSource.onerror = () => {
      this._connected = false
    }
    this.setupMessageHandler()
  }

  connectToSession(baseUrl: string, sessionID: string): void {
    this.disconnect()
    this.eventSource = new EventSource(`${baseUrl}/api/events?sessionID=${encodeURIComponent(sessionID)}`)
    this.eventSource.onopen = () => { this._connected = true }
    this.eventSource.onerror = () => {
      this._connected = false
    }
    this.setupMessageHandler()
  }

  private setupMessageHandler(): void {
    if (!this.eventSource) return
    this.eventSource.onmessage = (e: MessageEvent) => {
      try {
        let data = JSON.parse(e.data)
        // gateway Mode A 全局流 wire 格式：{ type: 'mafw_event', data: { type, properties, sessionID } }
        // 剥壳后统一为 { type, properties, sessionID }（desktop 直连不走 SDK，不受影响）
        if (data && data.type === 'mafw_event' && data.data && typeof data.data === 'object') {
          data = data.data
        }
        // E2-2: greeting → replay info（只在显式订阅了 onReplayInfo 时回调）
        const opts = this.subscribeOptions
        if (opts?.onReplayInfo && data?.type === 'connected' && typeof data.headSeq === 'number') {
          opts.onReplayInfo({
            headSeq: data.headSeq,
            firstReplayedSeq: data.firstReplayedSeq,
            truncated: data.truncated,
            reset: data.reset,
            instanceId: data.instanceId,
            schemaEpoch: data.schemaEpoch,
          })
        }
        // E2-2: 仅带 SSE `id:` 的帧推进游标（connected/ping/无 id 帧不写）
        const lastEventId = e.lastEventId
        if (opts?.cursor && typeof lastEventId === 'string' && /^\d+$/.test(lastEventId)) {
          opts.cursor.set(Number(lastEventId))
        }
        const type = data.type || 'message'
        const set = this.listeners.get(type)
        if (set) for (const cb of set) cb(data)
        const wildcard = this.listeners.get('*')
        if (wildcard) for (const cb of wildcard) cb(data)
      } catch {
        // ignore parse errors
      }
    }
  }

  disconnect(): void {
    this.eventSource?.close()
    this.eventSource = null
    this._connected = false
    this.subscribeOptions = null
  }

  on(eventType: string, cb: SSECallback): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(cb)
    return () => {
      this.listeners.get(eventType)?.delete(cb)
    }
  }

  /** @internal For testing: emit an event without a real SSE connection */
  emit(event: any): void {
    const type = event.type || 'message'
    const set = this.listeners.get(type)
    if (set) for (const cb of set) cb(event)
    const wildcard = this.listeners.get('*')
    if (wildcard) for (const cb of wildcard) cb(event)
  }
}
