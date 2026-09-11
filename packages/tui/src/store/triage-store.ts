import type { Approval, TriageItem } from '@mafw/sdk'

/** TriageItem 的 SDK 类型缺 id 字段（wire 实际有，desktop 用 t.id）。 */
export type TriageRow = TriageItem & { id: string }

export type TriageAction = 'approve' | 'reject' | 'confirm' | 'dismiss'

export class TriageStore {
  readonly approvals: Approval[] = []
  readonly items: TriageRow[] = []
  private stopped = false
  private cleanup?: () => void
  private schedule: (fn: () => void, ms: number) => () => void
  private deps: {
    approvals: { list(): Promise<Approval[]>; respond(id: string, d: 'approve' | 'reject'): Promise<void> }
    triage: { list(): Promise<TriageItem[]>; confirm(id: string): Promise<void>; reject(id: string): Promise<void>; dismiss(id: string): Promise<void> }
    onChange: () => void
    schedule?: (fn: () => void, ms: number) => () => void
  }

  constructor(deps: TriageStore['deps']) {
    this.deps = deps
    this.schedule = deps.schedule ?? ((fn, ms) => {
      const t = setInterval(fn, ms)
      return () => clearInterval(t)
    })
  }

  start(): void {
    this.stopped = false
    void this.poll()
    this.cleanup = this.schedule(() => { if (!this.stopped) void this.poll() }, 10_000)
  }

  stop(): void {
    this.stopped = true
    this.cleanup?.()
  }

  async poll(): Promise<void> {
    try {
      const [a, t] = await Promise.all([this.deps.approvals.list(), this.deps.triage.list()])
      this.approvals.length = 0
      this.approvals.push(...a)
      this.items.length = 0
      this.items.push(...(t as TriageRow[]))
      this.deps.onChange()
    } catch {
      /* 轮询失败保留旧数据 */
    }
  }

  async act(kind: 'approval' | 'triage', id: string, action: TriageAction): Promise<void> {
    if (kind === 'approval') {
      await this.deps.approvals.respond(id, action === 'approve' ? 'approve' : 'reject')
    } else if (action === 'confirm') {
      await this.deps.triage.confirm(id)
    } else if (action === 'dismiss') {
      await this.deps.triage.dismiss(id)
    } else {
      await this.deps.triage.reject(id)
    }
    await this.poll()
  }
}
