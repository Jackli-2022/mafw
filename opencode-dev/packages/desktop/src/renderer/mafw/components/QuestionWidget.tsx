// @ts-nocheck
import { createSignal, createEffect, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { LoaderV2 } from "@opencode-ai/ui/v2/loader-v2"
import { Icon } from "@opencode-ai/ui/icon"

export interface QuestionData {
  type: "user_question"
  goalId: string
  questionId: string
  node?: string
  loop?: number
  questions?: string[]
  askedAt?: string
}

type Props = {
  question: QuestionData
  gatewayUrl: string
  onDismiss: () => void
}

export function QuestionWidget(props: Props) {
  const [answer, setAnswer] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [result, setResult] = createSignal<string | null>(null)
  const [questionText, setQuestionText] = createSignal("")

  createEffect(async () => {
    try {
      const list = await window.api.mafw.approvals.list() as any[]
      const match = list.find((a: any) => a.id === props.question.questionId)
      if (match?.question) setQuestionText(match.question)
    } catch {}
  })

  async function submit(action: "answer" | "cancel") {
    setSubmitting(true)
    try {
      const res = await fetch(
        `${props.gatewayUrl}/api/goals/${props.question.goalId}/questions/${props.question.questionId}/respond`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: action === "cancel" ? "cancel" : "answer",
            answer: answer(),
          }),
        },
      )
      const data = await res.json()
      setResult(data.status)
      if (data.status === "accepted") setTimeout(() => props.onDismiss(), 1500)
    } catch {
      setResult("error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div class="mafw-question-overlay">
      <div class="mafw-question-card">
        <div class="mafw-question-header">
          <Icon name="help-circle" size="small" />
          <span class="mafw-question-title">
            Question{props.question.node ? ` — ${props.question.node}` : ""}
            {props.question.loop != null ? ` (loop ${props.question.loop})` : ""}
          </span>
          <ButtonV2 variant="ghost" size="small" class="mafw-question-close" onClick={props.onDismiss} aria-label="关闭">✕</ButtonV2>
        </div>
        <div class="mafw-question-body">
          {questionText() ? (
            <p class="mafw-question-text">{questionText()}</p>
          ) : (
            <p class="mafw-question-text" style={{ opacity: 0.6 }}>
              Goal: {props.question.goalId}
            </p>
          )}
          <Show when={props.question.questions && props.question.questions.length > 0}>
            <ul class="mafw-question-list">
              {props.question.questions.map((q: string) => <li>{q}</li>)}
            </ul>
          </Show>
          <Show when={!result()}>
            <TextInputV2
              value={answer()}
              onInput={e => setAnswer(e.currentTarget.value)}
              placeholder="Type your answer..."
              class="mafw-question-input"
            />
            <div class="mafw-question-actions">
              <ButtonV2 variant="contrast" size="small" onClick={() => submit("answer")} disabled={submitting() || !answer().trim()}>
                <Show when={submitting()} fallback="Answer">
                  <LoaderV2 width={12} height={12} />
                </Show>
              </ButtonV2>
              <ButtonV2 variant="outline" size="small" onClick={() => submit("cancel")} disabled={submitting()}>
                Cancel Goal
              </ButtonV2>
            </div>
          </Show>
          <Show when={result()}>
            <p class="mafw-question-result">{result() === "accepted" ? "Submitted" : "Error submitting"}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}
