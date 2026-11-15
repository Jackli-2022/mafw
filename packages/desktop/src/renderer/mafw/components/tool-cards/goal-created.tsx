import { Show, createMemo, createSignal, onMount, onCleanup, type Component } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"
import { goalCreatedActionState, goalCreatedView, type GoalCreatedView, type GoalLiveState } from "./goal-created-model"
import "./goal-created.css"

export type GoalCreatedActions = {
  /** Open the Goal in the workbench and switch Chat to its Tech Lead discussion. */
  open: (goalId: string) => void
  /** Live Pod projection; null when the Goal is gone or cannot be read. */
  status: (goalId: string) => Promise<GoalLiveState | null>
  /** Cancel a still-discussing Goal; true means the Goal is now aborted. */
  cancel: (goalId: string) => Promise<boolean>
}

let actions: GoalCreatedActions | null = null

/** MafwShell owns navigation and cancellation; the card only raises intent. */
export function configureGoalCreatedActions(next: GoalCreatedActions | null): void {
  actions = next
}

const FallbackTool = familyCard(TOOL_SPECS.mafw_create_goal)

function GoalCreatedBody(props: { view: () => GoalCreatedView; status?: string }) {
  const [confirming, setConfirming] = createSignal(false)
  const [busy, setBusy] = createSignal(false)
  const [cancelled, setCancelled] = createSignal(false)
  const [live, setLive] = createSignal<GoalLiveState | null | undefined>(undefined)
  const view = () => props.view()
  const state = () => goalCreatedActionState(view(), live(), cancelled())

  onMount(() => {
    const goalId = view().goalId
    if (!goalId || !actions) {
      setLive(null)
      return
    }
    let alive = true
    void actions.status(goalId)
      .then((next) => { if (alive) setLive(next) })
      .catch(() => { if (alive) setLive(null) })
    onCleanup(() => { alive = false })
  })

  const open = () => {
    const goalId = view().goalId
    if (!goalId) return
    if (!actions) {
      showToastV2({ description: "操作暂不可用，请稍后重试", duration: 2200 })
      return
    }
    actions.open(goalId)
  }

  const cancel = async () => {
    if (busy() || !view().goalId) return
    if (!actions) {
      showToastV2({ description: "操作暂不可用，请稍后重试", duration: 2200 })
      return
    }
    setBusy(true)
    try {
      const done = await actions.cancel(view().goalId)
      if (done) {
        setCancelled(true)
        setConfirming(false)
      }
    } catch (err: any) {
      showToastV2({
        description: `撤销失败：${String(err?.message ?? err).slice(0, 120)}`,
        duration: 3200,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <BasicTool
      icon="checklist"
      trigger={{
        title: "创建 Goal",
        subtitle: view().title || view().goalId,
        action: (
          <span class="mafw-goal-created-badge" data-tone={cancelled() ? "muted" : "accent"}>
            {cancelled() ? "已撤销" : "讨论中"}
          </span>
        ),
      }}
      status={props.status}
      defaultOpen
      animated
    >
      <div class="mafw-tool-box mafw-goal-created">
        <div class="mafw-goal-created-head">
          <span class="mafw-goal-created-title">{view().title || view().goalId}</span>
        </div>
        <div class="mafw-goal-created-meta">
          <span>{state().statusLabel}</span>
          <Show when={state().canCancel && view().hasHandoff}>
            <span> · 已带当前话题快照</span>
          </Show>
          <Show when={view().warning}>
            {(warning) => <span class="mafw-goal-created-warn"> · {warning()}</span>}
          </Show>
        </div>
        <Show when={!cancelled() && (state().canOpen || state().canCancel)}>
          <div class="mafw-goal-created-actions">
            <Show when={state().canOpen}>
              <ButtonV2 variant="contrast" size="small" onClick={open}>
                打开 Tech Lead 讨论
              </ButtonV2>
            </Show>
            <Show
              when={state().canCancel && !confirming()}
              fallback={
                <Show when={state().canCancel}>
                  <ButtonV2 variant="outline" size="small" disabled={busy()} onClick={() => void cancel()}>
                    {busy() ? "撤销中…" : "确认撤销"}
                  </ButtonV2>
                  <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => setConfirming(false)}>
                    取消
                  </ButtonV2>
                </Show>
              }
            >
              <ButtonV2 variant="ghost" size="small" onClick={() => setConfirming(true)}>
                撤销
              </ButtonV2>
            </Show>
          </div>
        </Show>
      </div>
    </BasicTool>
  )
}

/**
 * Lead-created discussion Goal: the transcript carries the next action instead
 * of asking the user to switch a composer mode before sending.
 */
export const MafwGoalCreatedCard: Component<ToolProps> = (props) => {
  const view = createMemo(() => goalCreatedView(props.input, props.output, props.status))
  return (
    <Show when={view().kind === "tech_lead"} fallback={<FallbackTool {...props} />}>
      <GoalCreatedBody view={view} status={props.status} />
    </Show>
  )
}
