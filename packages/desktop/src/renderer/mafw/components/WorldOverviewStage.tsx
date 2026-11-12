import { Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { WorkOverview } from "./WorkOverview"
import { WorkPriorityList } from "./WorkPriorityList"
import { PodGoalComposer } from "./PodGoalComposer"
import { StandingGoalsPanel } from "./StandingGoalsPanel"
import { ProjectTeamStrip } from "./ProjectTeamStrip"
import { PodDock } from "./PodDock"
import { buildAttentionList, buildWorkPriority, type WorkFilter } from "../work-overview-model"
import { goalRevisionOf, type GoalDetailFocus } from "../pod-model"
import { isPodResultViewed } from "../pod-result-store"
import { podEvents } from "../pod-events"
import type { PodDetail } from "@mafw/sdk"

/** Composer 请求序列的会话级消费游标：remount 不重放已处理请求。 */
let lastConsumedComposerRequest = 0

const WORK_BUCKETS = ["needs_you", "queued", "in_progress", "result_ready", "ended"] as const

function friendlyWorkError(error: unknown): string {
  const text = String((error as any)?.message ?? error ?? "")
  if (/pod not found|没有鲸群|no pod/i.test(text)) {
    return "这个项目还没有鲸群。打开 Lead 或把讨论交给 Lead 执行时会创建。"
  }
  return text || "工作概览加载失败"
}

export type WorldTeamProps = {
  detail: PodDetail | null
  loading: boolean
  error: string | null
  unsupported: boolean
  isWorktree: boolean
  onRefresh: () => void
  onOpenLead: () => void
  onOpenTechLead: (goalId: string) => void
  onOpenPanel: (tab: "team" | "memory", target?: "members" | "inbox") => void
  onCreate: () => void
}

/** 世界总览：继续 / 需要你 / 全部 Goal / standing / 团队 / New Goal。 */
export function WorldOverviewStage(props: {
  projectDir: string | null
  projectName?: string | null
  refreshTick: () => number
  composerRequest?: number
  composerInitial?: { title: string; objective?: string } | null
  onComposerToggle?: () => void
  active: boolean
  team?: WorldTeamProps
  teamFocusRequest?: number
  podPanelRequest?: { tab: "team" | "memory"; seq: number; target?: "members" | "inbox" }
  onOpenPodSession?: (sid: string, title?: string) => void
  onOpenGoal: (goal: PodGoal, focus?: GoalDetailFocus) => void
  onGoalCreated?: (goalId: string, goal?: PodGoal) => void
}): JSX.Element {
  const [overview, setOverview] = createSignal<PodWorkOverview | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [composerOpen, setComposerOpen] = createSignal(false)
  const [creating, setCreating] = createSignal(false)
  const [filter, setFilter] = createSignal<WorkFilter>("all")
  const [podOpen, setPodOpen] = createSignal(false)
  let lastPodPanelSeq = 0

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
    if (!props.active) return
    void load()
    const timer = setInterval(() => void load(), 15_000)
    onCleanup(() => clearInterval(timer))
  })

  createEffect(() => {
    const request = props.composerRequest ?? 0
    if (request > lastConsumedComposerRequest && props.active) {
      lastConsumedComposerRequest = request
      setComposerOpen(true)
    }
  })

  createEffect(on(() => props.projectDir, () => {
    setComposerOpen(false)
    setCreating(false)
    setPodOpen(false)
    lastPodPanelSeq = 0
  }, { defer: true }))

  createEffect(() => {
    const seq = props.podPanelRequest?.seq ?? 0
    if (seq <= lastPodPanelSeq) return
    lastPodPanelSeq = seq
    setPodOpen(true)
  })

  const overviewGoals = createMemo<PodGoal[]>(() => {
    const current = overview()
    if (!current) return []
    return WORK_BUCKETS.flatMap((bucket) => current.groups[bucket] ?? [])
  })

  const activeGoalId = () => (
    overview()?.groups.in_progress.find((goal) => goal.status === "active")?.goalId
      ?? overview()?.groups.needs_you.find((goal) => goal.status === "active")?.goalId
      ?? null
  )

  const isViewed = (goal: PodGoal): boolean => {
    const podId = overview()?.podId
    if (!podId) return true
    // 事件列表还没拉回来时先不标「未查看」（避免冷启动闪一下）。
    if (podEvents.supported() && !podEvents.loaded()) return true
    return isPodResultViewed(podId, goal.goalId, goalRevisionOf(goal) ?? 1)
  }

  const priority = createMemo(() => buildWorkPriority({
    goals: overviewGoals(),
    events: podEvents.items(),
    isResultViewed: isViewed,
  }))

  const attention = createMemo(() => buildAttentionList({
    goals: overviewGoals(),
    attention: [],
    isResultViewed: isViewed,
  }))

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
      props.onGoalCreated?.(created.goalId, created.goal)
      return true
    } catch (err) {
      setError(friendlyWorkError(err))
      return false
    } finally {
      setCreating(false)
    }
  }

  let teamRef: HTMLDivElement | undefined
  createEffect(() => {
    const request = props.teamFocusRequest ?? 0
    if (request <= 0 || !props.active) return
    queueMicrotask(() => teamRef?.scrollIntoView({ block: "nearest", behavior: "smooth" }))
  })

  return (
    <div class="mafw-project-work" aria-label="世界总览">
      <div class="mafw-project-work-overview">
        <div class="mafw-project-work-head">
          <div>
            <div class="mafw-work-kicker mafw-project-home-title">世界总览</div>
            <Show when={props.projectName?.trim()}>
              <div class="mafw-project-work-hint">{props.projectName}</div>
            </Show>
            <div class="mafw-project-work-hint">继续 / 需要你 / 全部 Goal / 团队都在这里</div>
          </div>
          <ButtonV2
            variant="outline"
            size="small"
            icon="target"
            onClick={() => {
              setComposerOpen((open) => !open)
              props.onComposerToggle?.()
            }}
          >
            新建 Goal
          </ButtonV2>
        </div>

        <Show when={props.team}>
          <div class="mafw-project-team-slot" ref={teamRef}>
            <ProjectTeamStrip {...props.team!} />
          </div>
        </Show>

        <Show when={podOpen()}>
          <section class="mafw-world-pod-panel" aria-label="团队与记忆">
            <div class="mafw-world-pod-head">
              <span>团队与记忆</span>
              <ButtonV2
                variant="ghost"
                size="small"
                aria-label="关闭团队与记忆"
                onClick={() => setPodOpen(false)}
              >
                <Icon name="close" size="small" />
              </ButtonV2>
            </div>
            <PodDock
              projectDir={props.projectDir}
              active={props.active}
              onOpenSession={(sid, title) => props.onOpenPodSession?.(sid, title)}
              panelRequest={props.podPanelRequest}
            />
          </section>
        </Show>

        <Show when={composerOpen()}>
          <section class="mafw-project-work-composer" aria-label="新建 Goal">
            <PodGoalComposer
              busy={creating()}
              activeGoalId={activeGoalId()}
              autofocus
              projectName={props.projectName ?? props.projectDir ?? "当前项目"}
              initial={props.composerInitial ?? undefined}
              onCreate={createGoal}
            />
          </section>
        </Show>

        <StandingGoalsPanel
          projectDir={props.projectDir}
          active={props.active}
          onOpenGoal={(goalId) => {
            const goal = overviewGoals().find((item) => item.goalId === goalId)
            if (goal) props.onOpenGoal(goal)
          }}
        />

        <WorkPriorityList
          items={priority()}
          attention={attention()}
          onOpen={(goal, focus) => props.onOpenGoal(goal, focus)}
        />

        <WorkOverview
          goals={overviewGoals()}
          loading={loading()}
          error={error()}
          filter={filter()}
          onFilter={setFilter}
          onOpenGoal={(goal, focus) => props.onOpenGoal(goal, focus)}
          isViewed={isViewed}
        />
      </div>
    </div>
  )
}
