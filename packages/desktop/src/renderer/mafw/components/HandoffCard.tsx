// @ts-nocheck
import { Show, For } from "solid-js"
import { Icon } from "@opencode-ai/ui/icon"

interface HandoffGoal {
  goalId: string
  title: string
}

interface HandoffQuestion {
  questionId: string
  goalId: string
}

interface HandoffData {
  handoverAt: string
  activeGoals?: HandoffGoal[]
  pendingQuestions?: HandoffQuestion[]
  userPreferences?: Record<string, string>
  previousSessionId: string
}

type Props = {
  data: HandoffData
}

export function HandoffCard(props: Props) {
  return (
    <div class="mafw-handoff-card">
      <div class="mafw-handoff-card-header">
        <Icon name="fork" size="small" />
        <span>Session Handoff — {new Date(props.data.handoverAt).toLocaleString()}</span>
      </div>
      <div class="mafw-handoff-card-body">
        <div class="mafw-handoff-field">
          <span class="mafw-handoff-field-label">Active Goals</span>
          <span class="mafw-handoff-field-value">{props.data.activeGoals?.length ?? 0}</span>
        </div>
        <div class="mafw-handoff-field">
          <span class="mafw-handoff-field-label">Pending Questions</span>
          <span class="mafw-handoff-field-value">{props.data.pendingQuestions?.length ?? 0}</span>
        </div>
        <Show when={props.data.activeGoals?.length}>
          <div class="mafw-handoff-section">
            <span class="mafw-handoff-section-title">Goals</span>
            <For each={props.data.activeGoals}>{(goal) => (
              <div class="mafw-handoff-goal">{goal.title}</div>
            )}</For>
          </div>
        </Show>
        <details class="mafw-handoff-details">
          <summary>Previous session: {props.data.previousSessionId?.slice(0, 16)}...</summary>
          <pre class="mafw-handoff-previous-id">{props.data.previousSessionId}</pre>
        </details>
      </div>
    </div>
  )
}
