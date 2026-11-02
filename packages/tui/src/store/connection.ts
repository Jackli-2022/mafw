export type ConnState = 'ok' | 'reconnecting' | 'down'

export interface ConnectionDeps {
  sessionID: string
  /** on 可返回 unsubscribe（SDK SSEConnection 实际行为）或 void（EventNamespace 类型标注）。 */
  subscribe: (sid: string) => Promise<{ on(e: string, cb: (d: any) => void): void | (() => void) }>
  isConnected: () => boolean
  onEvent: (type: string, data: any) => void
  onState: (s: ConnState) => void
  schedule?: (fn: () => void, ms: number) => void
}

const BACKOFF = [1000, 2000, 5000, 15000]
const HEALTH_TICK_MS = 1000
/**
 * TUI 精确订阅的白名单（Task 12：**只有真实消费者**的事件才订阅）。
 *
 * - `part.updated` / `part.delta` / `turn.*`：ChatStore 回合渲染、流式增量累积与终态
 * - `permission.asked` / `permission_mode`：审批 overlay 与 🛡 状态
 * - `queue.updated`：gateway inbox 计数
 * - `background.job.updated`：状态栏后台作业计数（MafwBackgroundJob）
 * - `runtime_switched`：Experience 动作面失效（运行时热切换）
 *
 * 其余 canonical 事件（question.asked / session.config / session.checkpoint /
 * run.updated …）TUI 没有消费者，不再订阅；
 * 也不再保留 `'*'` 兜底转发（死订阅会让白名单失去约束力）。
 * tests/event-coverage.test.ts 与 @mafw/sdk 事件 union 交叉校验。
 */
export const KNOWN_EVENTS = [
  'part.updated',
  'part.delta',
  'turn.completed',
  'turn.failed',
  'turn.aborted',
  'permission.asked',
  'permission_mode',
  'queue.updated',
  'background.job.updated',
  'runtime_switched',
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

  /** 切换订阅目标会话（/sessions 切换后重订事件流）。 */
  setSession(sessionID: string): void {
    if (this.stopped || sessionID === this.deps.sessionID) return
    this.deps.sessionID = sessionID
    void this.resubscribe()
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
      const track = (u: void | (() => void)) => { if (typeof u === 'function') unsubs.push(u) }
      for (const e of KNOWN_EVENTS) track(sub.on(e, (d) => this.deps.onEvent(e, d)))
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
