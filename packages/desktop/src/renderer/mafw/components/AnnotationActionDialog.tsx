import { For, Show, createSignal, onCleanup, onMount } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Icon } from "@mafw/ui/icon"
import type { PodGoal } from "@mafw/sdk"
import type { Annotation } from "../../../shared/annotation-types"
import { chatAcceptsAnnotation, type DiscussionTarget } from "../annotation-discussion"
import { buildNewGoalDraft, canCreateNewGoal, eligibleDelegationGoals } from "../annotation-delegation"
import { PodGoalComposer } from "./PodGoalComposer"

export function AnnotationActionDialog(props: {
  annotations: Annotation[]
  goals: PodGoal[]
  podId: string | null
  currentSessionID: string | null
  currentChatGoalId: string | null
  busy: boolean
  onDiscuss: (target: DiscussionTarget) => Promise<void>
  onNewFreeDiscussion: () => Promise<void>
  onDelegateGoal: (goal: PodGoal) => Promise<void>
  onCreateGoal: (input: {
    title: string
    objective: string
    acceptance: string[]
    boundaries: string[]
    planReview: "auto" | "manual"
  }) => Promise<boolean>
  onClose: () => void
}) {
  const [tab, setTab] = createSignal<"discussion" | "goal">("discussion")
  const [acting, setActing] = createSignal(false)
  const [newGoal, setNewGoal] = createSignal(false)
  const draft = () => buildNewGoalDraft(props.annotations)
  const goals = () => eligibleDelegationGoals(props.goals, props.annotations)

  onMount(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !acting()) props.onClose()
    }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  const currentCompatible = () =>
    !!props.currentSessionID && props.annotations.every((annotation) =>
      chatAcceptsAnnotation(annotation, {
        kind: props.currentChatGoalId ? "techlead" : "free",
        goalId: props.currentChatGoalId,
      }))

  const sourceGoals = () => {
    const ids = [...new Set(props.annotations.flatMap((annotation) =>
      annotation.source?.kind === "goal" ? [annotation.source.goalId] : []))]
    return ids.map((goalId) => ({
      goalId,
      title: props.goals.find((goal) => goal.goalId === goalId)?.title || goalId,
    }))
  }

  const run = async (action: () => Promise<void>) => {
    if (acting() || props.busy) return
    setActing(true)
    try {
      await action()
      props.onClose()
    } catch {
      /* parent shows the transport error and keeps the dialog open */
    } finally {
      setActing(false)
    }
  }

  return (
    <div class="mafw-annotation-action-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !acting()) props.onClose()
    }}>
      <div class="mafw-annotation-action-dialog" role="dialog" aria-label="批注处理方式">
        <header class="mafw-annotation-action-head">
          <div>
            <b>处理 {props.annotations.length} 条批注</b>
            <span>先选择讨论，或交给一个 Goal 负责</span>
          </div>
          <ButtonV2 variant="ghost" size="small" aria-label="关闭" onClick={() => props.onClose()}>
            <Icon name="close" size="small" />
          </ButtonV2>
        </header>

        <div class="mafw-annotation-action-tabs" role="tablist" aria-label="处理方式">
          <ButtonV2
            variant="ghost"
            size="small"
            role="tab"
            aria-selected={tab() === "discussion"}
            onClick={() => setTab("discussion")}
          >
            讨论
          </ButtonV2>
          <ButtonV2
            variant="ghost"
            size="small"
            role="tab"
            aria-selected={tab() === "goal"}
            onClick={() => setTab("goal")}
          >
            Goal
          </ButtonV2>
        </div>

        <Show when={tab() === "discussion"}>
          <div class="mafw-annotation-action-body">
            <p class="mafw-annotation-action-note">只是解释或讨论，不会创建 Goal，也不会生成评审项。</p>
            <Show when={currentCompatible()}>
              <ButtonV2
                variant="contrast"
                size="small"
                disabled={acting() || props.busy}
                onClick={() => void run(() => props.onDiscuss(props.currentChatGoalId
                  ? {
                    kind: "techlead",
                    podId: props.podId ?? "",
                    goalId: props.currentChatGoalId,
                  }
                  : { kind: "free", sessionID: props.currentSessionID! }))}
              >
                {props.currentChatGoalId ? "发给当前 Tech Lead" : "发给当前会话"}
              </ButtonV2>
            </Show>
            <ButtonV2
              variant="contrast"
              size="small"
              disabled={acting() || props.busy}
              onClick={() => void run(() => props.onDiscuss({ kind: "lead", podId: props.podId ?? "" }))}
            >
              发给项目 Lead
            </ButtonV2>
            <For each={sourceGoals()}>
              {(goal) => (
                <ButtonV2
                  variant="ghost"
                  size="small"
                  disabled={acting() || props.busy}
                  onClick={() => void run(() => props.onDiscuss({
                    kind: "techlead",
                    podId: props.podId ?? "",
                    goalId: goal.goalId,
                  }))}
                >
                  发给 Goal「{goal.title}」的 Tech Lead
                </ButtonV2>
              )}
            </For>
            <ButtonV2
              variant="ghost"
              size="small"
              disabled={acting() || props.busy}
              onClick={() => void run(() => props.onNewFreeDiscussion())}
            >
              新建自由讨论
            </ButtonV2>
          </div>
        </Show>

        <Show when={tab() === "goal"}>
          <div class="mafw-annotation-action-body">
            <p class="mafw-annotation-action-note">交给 Goal 会形成持久评审项，并在下一次计划/修改中处理。</p>
            <Show
              when={newGoal()}
              fallback={
                <>
                  <For each={goals()}>
                    {(goal) => (
                      <ButtonV2
                        variant="contrast"
                        size="small"
                        disabled={acting() || props.busy}
                        onClick={() => void run(() => props.onDelegateGoal(goal))}
                      >
                        加入 Goal「{goal.title}」· rev {goal.activeRevision ?? 1}
                      </ButtonV2>
                    )}
                  </For>
                  <Show when={goals().length === 0}>
                    <p class="mafw-annotation-action-empty">
                      {canCreateNewGoal(props.annotations)
                        ? "没有可加入的现有 Goal。"
                        : "这些批注已有 Goal 来源；请打开所属 Goal，或先经 Lead 建立后续工作。"}
                    </p>
                  </Show>
                  <Show when={canCreateNewGoal(props.annotations)}>
                    <ButtonV2
                      variant="ghost"
                      size="small"
                      disabled={acting() || props.busy}
                      onClick={() => setNewGoal(true)}
                    >
                      新建 Goal
                    </ButtonV2>
                  </Show>
                </>
              }
            >
              <ButtonV2 variant="ghost" size="small" onClick={() => setNewGoal(false)}>
                返回现有 Goal
              </ButtonV2>
              <PodGoalComposer
                busy={acting() || props.busy}
                activeGoalId={null}
                heading="为这批批注新建 Goal"
                initialTitle={draft().title}
                initialObjective={draft().objective}
                initialAcceptance={draft().acceptance}
                onCreate={props.onCreateGoal}
              />
            </Show>
          </div>
        </Show>
      </div>
    </div>
  )
}
