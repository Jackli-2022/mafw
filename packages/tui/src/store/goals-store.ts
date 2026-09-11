import type { Goal, QuestionRequest } from '@mafw/sdk'

export type GoalRow = Goal

const TERMINAL_PHASES = ['COMPLETED', 'FAILED', 'ARCHIVED', 'CANCELLED']

/** Goals + 待决问答（QuestionRequest 无 goalId 关联，独立区块展示）。 */
export class GoalsStore {
  readonly rows: GoalRow[] = []
  readonly questions: QuestionRequest[] = []
  private stopped = false
  private cleanup?: () => void
  private schedule: (fn: () => void, ms: number) => () => void
  private deps: {
    goals: { list(): Promise<Goal[]> }
    questions: { list(): Promise<QuestionRequest[]> }
    onChange: () => void
    schedule?: (fn: () => void, ms: number) => () => void
  }

  constructor(deps: GoalsStore['deps']) {
    this.deps = deps
    this.schedule = deps.schedule ?? ((fn, ms) => {
      const t = setInterval(fn, ms)
      return () => clearInterval(t)
    })
  }

  static isActive(g: Goal): boolean {
    return !TERMINAL_PHASES.includes(g.phase)
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
      const [goals, questions] = await Promise.all([
        this.deps.goals.list(),
        this.deps.questions.list().catch(() => [] as QuestionRequest[]),
      ])
      this.rows.length = 0
      const rows = [...goals]
      rows.sort((a, b) => Number(GoalsStore.isActive(b)) - Number(GoalsStore.isActive(a)))
      this.rows.push(...rows)
      this.questions.length = 0
      this.questions.push(...questions)
      this.deps.onChange()
    } catch {
      /* 轮询失败保留旧数据 */
    }
  }
}
