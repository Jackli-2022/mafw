import { Show, createMemo, createSignal, type Component } from "solid-js"
import { BasicTool } from "@mafw/session-ui/basic-tool"
import type { ToolProps } from "@mafw/session-ui/message-part"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TOOL_SPECS } from "./extract"
import { familyCard } from "./shared"
import { goalCreatedView, type GoalCreatedView } from "./goal-created-model"
import "./goal-created.css"

export type GoalCreatedActions = {
  /** Open the Goal in the workbench and switch Chat to its Tech Lead discussion. */
  open: (goalId: string) => void
  /** Cancel a Goal created by mistake; true means the Goal is now aborted. */
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
  const view = () => props.view()

  const open = () => {
    const goalId = view().goalId
    if (goalId) actions?.open(goalId)
  }

  const cancel = async () => {
    if (busy() || !view().goalId) return
    setBusy(true)
    try {
      const done = await actions?.cancel(view().goalId)
      if (done) {
        setCancelled(true)
        setConfirming(false)
      }
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
          <Show when={!cancelled()} fallback={<span>Goal 已撤销，讨论记录保留。</span>}>
            <Show
              when={view().sessionID}
              fallback={<span>Goal 已创建 · Tech Lead 会话待启动</span>}
            >
              <span>Tech Lead 已就绪 · 尚未执行</span>
            </Show>
            <Show when={view().hasHandoff}>
              <span> · 已带当前话题快照</span>
            </Show>
            <Show when={view().warning}>
              {(warning) => <span class="mafw-goal-created-warn"> · {warning()}</span>}
            </Show>
          </Show>
        </div>
        <Show when={!cancelled()}>
          <div class="mafw-goal-created-actions">
            <ButtonV2 variant="contrast" size="small" onClick={open}>
              打开 Tech Lead 讨论
            </ButtonV2>
            <Show
              when={!confirming()}
              fallback={
                <>
                  <ButtonV2 variant="outline" size="small" disabled={busy()} onClick={() => void cancel()}>
                    {busy() ? "撤销中…" : "确认撤销"}
                  </ButtonV2>
                  <ButtonV2 variant="ghost" size="small" disabled={busy()} onClick={() => setConfirming(false)}>
                    取消
                  </ButtonV2>
                </>
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
