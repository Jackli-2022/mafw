import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { WorkOverview } from "./WorkOverview"
import { PodGoalComposer } from "./PodGoalComposer"
import { podShortTime, type GoalDetailFocus } from "../pod-model"
import { formatRailTitle } from "./rail-display"

type Discussion = { id: string; title?: string; time?: { updated?: number } }

function projectName(dir: string | null): string {
  if (!dir) return "当前项目"
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean)
  return parts[parts.length - 1] || dir
}

function discussionTime(time?: { updated?: number }): string {
  const ms = time?.updated
  if (typeof ms !== "number" || !Number.isFinite(ms)) return ""
  return podShortTime(new Date(ms).toISOString(), Date.now())
}

function friendlyWorkError(error: unknown): string {
  const text = String((error as any)?.message ?? error ?? "")
  if (/404|pod not found|没有鲸群/i.test(text)) {
    return "这个项目还没有鲸群。打开 Lead 或把讨论交给 Lead 执行时会创建。"
  }
  return text || "工作概览加载失败"
}

/** Project workspace: Lead conversation entry + one complete work overview. */
export function WorkspaceHome(props: {
  projectDir: string | null
  discussions?: Discussion[]
  /** Welcome / command palette ask for the Goal composer; seq consumes repeats. */
  composerRequest?: number
  onOpenLead: () => Promise<boolean> | boolean
  onNewDiscussion: () => void
  onOpenDiscussion: (sessionID: string) => void
  onGoalCreated?: (goalId: string) => void
  onOpenGoal: (goal: PodGoal, focus?: GoalDetailFocus) => void
}) {
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
      // 显式点击「新建 Goal」才创建 Pod；工作概览轮询永远不创建。
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
    <div class="mafw-workspace">
      <header class="mafw-workspace-head">
        <div>
          <div class="mafw-work-kicker">项目工作空间</div>
          <h1 class="mafw-workspace-title">{projectName(props.projectDir)}</h1>
        </div>
        <div class="mafw-workspace-actions">
          <ButtonV2 variant="contrast" icon="user" onClick={() => void props.onOpenLead()}>
            打开 Lead 对话
          </ButtonV2>
          <ButtonV2 variant="outline" icon="edit" onClick={() => props.onNewDiscussion()}>
            新话题
          </ButtonV2>
          <ButtonV2 variant="outline" icon="target" onClick={() => setComposerOpen((open) => !open)}>
            新建 Goal
          </ButtonV2>
        </div>
      </header>

      <div class="mafw-workspace-grid">
        <section class="mafw-workspace-lead" aria-label="Lead 项目对话">
          <div class="mafw-workspace-lead-head">
            <div class="mafw-work-kicker">Lead · 项目对话</div>
            <span class="mafw-workspace-lead-mark" aria-hidden="true">L</span>
          </div>
          <h2>把工作交代给 Lead</h2>
          <p>
            讨论方向、补充上下文、接收结果。Lead 会创建 Goal，并交给 Tech Lead 决定如何执行；
            你不需要管理底层会话。
          </p>
          <ButtonV2
            variant="ghost"
            icon="arrow-right"
            class="mafw-workspace-lead-cta"
            onClick={() => void props.onOpenLead()}
          >
            继续项目对话
          </ButtonV2>
        </section>

        <WorkOverview
          overview={overview()}
          loading={loading()}
          error={error()}
          onOpenGoal={(goal, focus) => props.onOpenGoal(goal, focus)}
          onOpenAll={() => void load()}
        />
      </div>

      <Show when={composerOpen()}>
        <section class="mafw-workspace-composer" aria-label="新建 Goal">
          <PodGoalComposer
            busy={creating()}
            activeGoalId={activeGoalId()}
            autofocus
            onCreate={createGoal}
          />
        </section>
      </Show>

      <Show when={(props.discussions?.length ?? 0) > 0}>
        <section class="mafw-workspace-discussions" aria-label="自由讨论">
          <div class="mafw-workspace-section-head">
            <div>
              <div class="mafw-work-kicker">自由讨论</div>
              <div class="mafw-work-total">想聊一个新话题时，不必先创建 Goal</div>
            </div>
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onNewDiscussion()}>新话题</ButtonV2>
          </div>
          <div class="mafw-workspace-discussion-list">
            <For each={props.discussions}>
              {(discussion) => (
                <ButtonV2
                  variant="ghost"
                  size="small"
                  class="mafw-workspace-discussion-row"
                  onClick={() => props.onOpenDiscussion(discussion.id)}
                >
                  <span class="mafw-workspace-discussion-mark" aria-hidden="true" />
                  <span class="mafw-workspace-discussion-main">
                    <span class="mafw-work-item-title">{formatRailTitle(discussion.title)}</span>
                  </span>
                  <Show when={discussionTime(discussion.time)}>
                    <span class="mafw-workspace-discussion-time">{discussionTime(discussion.time)}</span>
                  </Show>
                  <Icon name="chevron-right" size="small" class="mafw-workspace-discussion-chevron" />
                </ButtonV2>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}
