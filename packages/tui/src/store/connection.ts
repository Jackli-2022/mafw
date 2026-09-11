export type ConnState = 'ok' | 'reconnecting' | 'down'

export interface ConnectionDeps {
  sessionID: string
  subscribe: (sid: string) => Promise<{ on(e: string, cb: (d: any) => void): () => void }>
  isConnected: () => boolean
  onEvent: (type: string, data: any) => void
  onState: (s: ConnState) => void
  schedule?: (fn: () => void, ms: number) => void
}

const BACKOFF = [1000, 2000, 5000, 15000]
const HEALTH_TICK_MS = 1000
const KNOWN_EVENTS = [
  'message.part.updated',
  'session.idle',
  'session.error',
  'permission.asked',
  'question.asked',
]

/**
 * SSE 连接监督：健康 tick 读 isConnected()，断开时按 BACKOFF 阶梯重订阅。
 * SDK 的 EventSource 自带自动重连——这里是对长断开的兜底 + 状态上报。
 */
export class ConnectionStore {
  private backoffIdx = 0
  private stopped = false
  private unsubs: (() => void)[] = []
  private schedule: (fn: () => void, ms: number) => void
  private deps: ConnectionDeps

  constructor(deps: ConnectionDeps) {
    this.deps = deps
    this.schedule = deps.schedule ?? ((fn, ms) => { setTimeout(fn, ms) })
  }

  start(): void {
    this.stopped = false
    void this.subscribe()
    this.schedule(() => this.healthTick(), HEALTH_TICK_MS)
  }

  stop(): void {
    this.stopped = true
    for (const u of this.unsubs) u()
    this.unsubs = []
  }

  private async subscribe(): Promise<void> {
    if (this.stopped) return
    try {
      const sub = await this.deps.subscribe(this.deps.sessionID)
      const unsubs: (() => void)[] = []
      for (const e of KNOWN_EVENTS) unsubs.push(sub.on(e, (d) => this.deps.onEvent(e, d)))
      unsubs.push(sub.on('*', (d) => {
        if (d?.type && !KNOWN_EVENTS.includes(d.type)) this.deps.onEvent(d.type, d)
      }))
      this.unsubs = unsubs
    } catch {
      this.deps.onState('down')
    }
  }

  private healthTick(): void {
    if (this.stopped) return
    if (this.deps.isConnected()) {
      this.backoffIdx = 0
      this.deps.onState('ok')
      this.schedule(() => this.healthTick(), HEALTH_TICK_MS)
      return
    }
    this.deps.onState('reconnecting')
    const delay = BACKOFF[Math.min(this.backoffIdx, BACKOFF.length - 1)]
    this.backoffIdx++
    this.schedule(() => { void this.resubscribe() }, delay)
  }

  private async resubscribe(): Promise<void> {
    if (this.stopped) return
    for (const u of this.unsubs) u()
    this.unsubs = []
    await this.subscribe()
    this.schedule(() => this.healthTick(), HEALTH_TICK_MS)
  }
}
