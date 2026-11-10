import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { GoalRunView, StandingGoalView, StandingRunStatus } from "@mafw/sdk"

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "尚未运行"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
}

const STATE_LABEL: Record<StandingGoalView["state"], string> = {
  active: "运行中",
  paused: "已暂停",
  stopped: "已停止",
}

const RUN_STATUS_LABEL: Record<StandingRunStatus, string> = {
  queued: "排队",
  triaging: "分流中",
  running: "执行中",
  waiting_person: "待你确认",
  done: "完成",
  failed: "失败",
  skipped: "跳过",
}

/**
 * Standing Goals overview for the right workbench. It uses the same run rows as
 * the gateway (`goal_runs`) and never renders raw session ids; the next run is
 * the cron/event projection maintained by the gateway.
 */
export function StandingGoalsPanel(props: {
  projectDir?: string | null
  active?: boolean
  onOpenGoal?: (goalId: string) => void
}) {
  const [goals, setGoals] = createSignal<StandingGoalView[]>([])
  const [runsByGoal, setRunsByGoal] = createSignal<Record<string, GoalRunView[]>>({})
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const [busyGoalId, setBusyGoalId] = createSignal("")
  const [error, setError] = createSignal("")
  const [enabled, setEnabled] = createSignal(true)

  const load = async (): Promise<void> => {
    const dir = props.projectDir
    if (!dir) {
      setGoals([])
      setRunsByGoal({})
      return
    }
    try {
      const result = await window.api.mafw.standingGoals.list({ projectDir: dir })
      setGoals(result.items)
      const entries = await Promise.all(result.items.map(async (goal) => {
        try {
          const runs = await window.api.mafw.standingGoals.runs(goal.id)
          return [goal.id, runs.items] as const
        } catch {
          return [goal.id, []] as const
        }
      }))
      setRunsByGoal(Object.fromEntries(entries))
      setEnabled(true)
      setError("")
    } catch (err: any) {
      const message = String(err?.message ?? err)
      setGoals([])
      setRunsByGoal({})
      if (/\b503\b|disabled|not enabled/i.test(message)) {
        setEnabled(false)
        setError("")
      } else {
        setError(message)
      }
    }
  }

  createEffect(() => {
    props.projectDir
    if (!props.active) return
    void load()
    const timer = setInterval(() => void load(), 30_000)
    onCleanup(() => clearInterval(timer))
  })

  const successRate = (goalId: string): string => {
    const runs = runsByGoal()[goalId] ?? []
    const finished = runs.filter((run) => run.status === "done" || run.status === "failed")
    if (finished.length === 0) return "暂无数据"
    const done = finished.filter((run) => run.status === "done").length
    return `${Math.round((done / finished.length) * 100)}%`
  }

  const waitingCount = (goalId: string): number =>
    (runsByGoal()[goalId] ?? []).filter((run) => run.status === "waiting_person").length

  const toggle = (goalId: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(goalId)) next.delete(goalId)
      else next.add(goalId)
      return next
    })
  }

  const act = async (goalId: string, action: () => Promise<unknown>): Promise<void> => {
    setBusyGoalId(goalId)
    try {
      await action()
      await load()
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusyGoalId("")
    }
  }

  const hasGoals = createMemo(() => goals().length > 0)

  return (
    <Show when={enabled()} fallback={null}>
      <section class="mafw-standing-goals" aria-label="长效目标">
      <div class="mafw-standing-goals-head">
        <div>
          <div class="mafw-work-kicker">长效目标</div>
          <div class="mafw-project-work-hint">定时或事件触发，自动分流为 Goal、报告或动作</div>
        </div>
        <ButtonV2 variant="ghost" size="small" onClick={() => void load()}>
          刷新
        </ButtonV2>
      </div>

      <Show when={error()}>
        <div class="mafw-work-error">{error()}</div>
      </Show>

      <Show when={hasGoals()} fallback={<div class="mafw-work-empty">还没有长效目标</div>}>
        <For each={goals()}>
          {(goal) => (
            <article class="mafw-standing-goal" data-standing-goal-id={goal.id}>
              <div class="mafw-standing-goal-main">
                <div class="mafw-standing-goal-title">{goal.title}</div>
                <div class="mafw-standing-goal-meta">
                  <span class={`mafw-standing-goal-state is-${goal.state}`}>{STATE_LABEL[goal.state]}</span>
                  <Show when={goal.stateReason}>
                    <span class="mafw-standing-goal-reason">{goal.stateReason}</span>
                  </Show>
                  <span aria-label="next run">下次运行 {formatTime(goal.nextRunAt)}</span>
                  <span>上次运行 {formatTime(goal.lastRunAt)}</span>
                  <span>成功率 {successRate(goal.id)}</span>
                  <Show when={waitingCount(goal.id) > 0}>
                    <span class="mafw-standing-goal-attention">待你确认 {waitingCount(goal.id)}</span>
                  </Show>
                </div>
              </div>
              <div class="mafw-standing-goal-actions">
                <Show when={goal.state === "active"}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={busyGoalId() === goal.id}
                    onClick={() => void act(goal.id, () => window.api.mafw.standingGoals.pause(goal.id))}
                  >
                    暂停
                  </ButtonV2>
                </Show>
                <Show when={goal.state === "paused"}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={busyGoalId() === goal.id}
                    onClick={() => void act(goal.id, () => window.api.mafw.standingGoals.resume(goal.id))}
                  >
                    恢复
                  </ButtonV2>
                </Show>
                <Show when={goal.state !== "stopped"}>
                  <ButtonV2
                    variant="ghost"
                    size="small"
                    disabled={busyGoalId() === goal.id}
                    onClick={() => void act(goal.id, () => window.api.mafw.standingGoals.stop(goal.id))}
                  >
                    停止
                  </ButtonV2>
                  <ButtonV2
                    variant="outline"
                    size="small"
                    disabled={busyGoalId() === goal.id}
                    onClick={() => void act(goal.id, () => window.api.mafw.standingGoals.run(goal.id))}
                  >
                    立即运行
                  </ButtonV2>
                </Show>
                <ButtonV2
                  variant="ghost"
                  size="small"
                  onClick={() => toggle(goal.id)}
                >
                  {expanded().has(goal.id) ? "收起记录" : "运行记录"}
                </ButtonV2>
              </div>

              <Show when={expanded().has(goal.id)}>
                <div class="mafw-standing-goal-runs">
                  <Show
                    when={(runsByGoal()[goal.id] ?? []).length > 0}
                    fallback={<div class="mafw-work-empty">还没有运行记录</div>}
                  >
                    <For each={runsByGoal()[goal.id] ?? []}>
                      {(run) => (
                        <div class="mafw-standing-goal-run">
                          <span class="mafw-standing-goal-run-mode">{run.mode ?? "待分流"}</span>
                          <span class={`mafw-standing-goal-run-status is-${run.status}`}>
                            {RUN_STATUS_LABEL[run.status]}
                          </span>
                          <span class="mafw-standing-goal-run-rationale">{run.rationale ?? ""}</span>
                          <Show when={run.costUsd != null}>
                            <span class="mafw-standing-goal-run-cost">${Number(run.costUsd).toFixed(2)}</span>
                          </Show>
                          <Show when={run.status === "waiting_person"}>
                            <ButtonV2
                              variant="outline"
                              size="small"
                              disabled={busyGoalId() === goal.id}
                              onClick={() => void act(goal.id, () => window.api.mafw.standingGoals.approveRun(run.id))}
                            >
                              批准
                            </ButtonV2>
                          </Show>
                          <Show when={run.goalId}>
                            <ButtonV2
                              variant="ghost"
                              size="small"
                              onClick={() => props.onOpenGoal?.(run.goalId!)}
                            >
                              打开 Goal
                            </ButtonV2>
                          </Show>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </Show>
            </article>
          )}
        </For>
      </Show>
      </section>
    </Show>
  )
}
