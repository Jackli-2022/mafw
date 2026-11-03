import { Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { WorkOverview } from "./WorkOverview"
import { PodGoalComposer } from "./PodGoalComposer"
import type { GoalDetailFocus } from "../pod-model"

function friendlyWorkError(error: unknown): string {
  const text = String((error as any)?.message ?? error ?? "")
  if (/404|pod not found|没有鲸群/i.test(text)) {
    return "这个项目还没有鲸群。打开 Lead 或把讨论交给 Lead 执行时会创建。"
  }
  return text || "工作概览加载失败"
}

/** Right-workbench `工作` face: one authoritative project work overview plus Goal composer. */
export function ProjectWorkView(props: {
  projectDir: string | null
  refreshTick: () => number
  composerRequest?: number
  onOpenGoal: (goal: PodGoal, focus?: GoalDetailFocus) => void
  onGoalCreated?: (goalId: string) => void
}): JSX.Element {
  const [overview, setOverview] = createSignal<PodWorkOverview | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [creating, setCreating] = createSignal(false)

  const load = async () => {
    const dir = props.projectDir
    if (!dir) {
      setOverview(null)
      setError("尚未选择项目")
      return
    }
    setLoading(true)
    try {
      const next = await window.api.mafw.work.overview(dir)
      setOverview(next as PodWorkOverview)
      setError(null)
    } catch (err) {
      setOverview(null)
      setError(friendlyWorkError(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    props.projectDir
    props.refreshTick()
    void load()
    const timer = setInterval(() => void load(), 15_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const request = props.composerRequest ?? 0
    if (request > 0) setComposerOpen(true)
  })

  const activeGoalId = () => (
    overview()?.groups.in_progress.find((goal) => goal.status === "active")?.goalId
      ?? overview()?.groups.needs_you.find((goal) => goal.status === "active")?.goalId
      ?? null
  )

  const createGoal = async (input: {
    title: string
    objective: string
    acceptance: string[]
    boundaries: string[]
    planReview: "auto" | "manual"
  }): Promise<boolean> => {
    const dir = props.projectDir
    if (!dir || creating()) return false
    setCreating(true)
    try {
      // 显式提交才创建 Pod；工作概览轮询永远不创建。
      const detail = await window.api.mafw.pod.ensure(dir)
      const created = await window.api.mafw.pod.createGoal(detail.pod.id, {
        ...input,
        source: "desktop",
      })
      setComposerOpen(false)
      await load()
      props.onGoalCreated?.(created.goalId)
      return true
    } catch (err) {
      setError(friendlyWorkError(err))
      return false
    } finally {
      setCreating(false)
    }
  }

  return (
    <div class="mafw-project-work" aria-label="项目工作">
      <div class="mafw-project-work-head">
        <div>
          <div class="mafw-work-kicker">项目工作</div>
          <div class="mafw-project-work-hint">Goal 队列、注意力与结果都在这里处理</div>
        </div>
        <ButtonV2
          variant="outline"
          size="small"
          icon="target"
          onClick={() => setComposerOpen((open) => !open)}
        >
          新建 Goal
        </ButtonV2>
      </div>

      <Show when={composerOpen()}>
        <section class="mafw-project-work-composer" aria-label="新建 Goal">
          <PodGoalComposer
            busy={creating()}
            activeGoalId={activeGoalId()}
            autofocus
            onCreate={createGoal}
          />
        </section>
      </Show>

      <WorkOverview
        overview={overview()}
        loading={loading()}
        error={error()}
        onOpenGoal={(goal, focus) => props.onOpenGoal(goal, focus)}
        onOpenAll={() => void load()}
      />
    </div>
  )
}
