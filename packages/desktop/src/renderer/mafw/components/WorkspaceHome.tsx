import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { PodGoal, PodWorkOverview } from "@mafw/sdk"
import { WorkOverview } from "./WorkOverview"

type Discussion = { id: string; title?: string }

function projectName(dir: string | null): string {
  if (!dir) return "当前项目"
  const parts = dir.replace(/\\/g, "/").split("/").filter(Boolean)
  return parts[parts.length - 1] || dir
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
  onOpenLead: () => Promise<boolean> | boolean
  onNewDiscussion: () => void
  onOpenDiscussion: (sessionID: string) => void
  onNewGoal: () => void
  onOpenGoal: (goal: PodGoal) => void
}) {
  const [overview, setOverview] = createSignal<PodWorkOverview | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)

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
          <ButtonV2 variant="outline" icon="target" onClick={() => props.onNewGoal()}>
            新建 Goal
          </ButtonV2>
        </div>
      </header>

      <div class="mafw-workspace-grid">
        <section class="mafw-workspace-lead" aria-label="Lead 项目对话">
          <div class="mafw-work-kicker">Lead · 项目对话</div>
          <h2>把工作交代给 Lead</h2>
          <p>
            讨论方向、补充上下文、接收结果。Lead 会创建 Goal，并交给 Tech Lead 决定如何执行；
            你不需要管理底层会话。
          </p>
          <ButtonV2 variant="ghost" icon="arrow-right" onClick={() => void props.onOpenLead()}>
            继续项目对话
          </ButtonV2>
        </section>

        <WorkOverview
          overview={overview()}
          loading={loading()}
          error={error()}
          onOpenGoal={(goal) => props.onOpenGoal(goal)}
          onOpenAll={() => void load()}
        />
      </div>

      <Show when={(props.discussions?.length ?? 0) > 0}>
        <section class="mafw-workspace-discussions" aria-label="自由讨论">
          <div class="mafw-work-overview-head">
            <div>
              <div class="mafw-work-kicker">自由讨论</div>
              <div class="mafw-work-total">想聊一个新话题时，不必先创建 Goal</div>
            </div>
            <ButtonV2 variant="ghost" size="small" onClick={() => props.onNewDiscussion()}>新话题</ButtonV2>
          </div>
          <For each={props.discussions}>
            {(discussion) => (
              <ButtonV2
                variant="ghost"
                size="small"
                class="mafw-work-item"
                onClick={() => props.onOpenDiscussion(discussion.id)}
              >
                <span class="mafw-work-item-title">{discussion.title || "未命名讨论"}</span>
                <span class="mafw-work-item-meta">自由讨论</span>
              </ButtonV2>
            )}
          </For>
        </section>
      </Show>
    </div>
  )
}
