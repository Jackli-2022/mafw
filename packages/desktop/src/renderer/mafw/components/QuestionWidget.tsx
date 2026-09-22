// @ts-nocheck
import { createSignal, createEffect, onMount, onCleanup, Show, For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TextInputV2 } from "@mafw/ui/v2/text-input-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"

// 业界 question 模式（Claude Code AskUserQuestion 式）：
// 问题文本是视觉焦点 → 选项为全宽可选中行（radio 点 + 数字快选）→ 单一主操作。
// 有选项时不显示自由文本框（一条回答路径，重点突出）。

export interface QuestionData {
  type: "user_question"
  goalId?: string
  questionId: string
  node?: string
  loop?: number
  question?: string
  options?: string[]
  questions?: string[]
  askedAt?: string
}

type Props = {
  question: QuestionData
  onDismiss: () => void
}

export function QuestionWidget(props: Props) {
  const [selected, setSelected] = createSignal<number | null>(null)
  const [answer, setAnswer] = createSignal("")
  const [submitting, setSubmitting] = createSignal(false)
  const [result, setResult] = createSignal<string | null>(null)
  const [approvalText, setApprovalText] = createSignal("")

  const hasOptions = () => !!props.question.options && props.question.options.length > 0
  const questionText = () => props.question.question || approvalText()
  const canSubmit = () => (hasOptions() ? selected() !== null : answer().trim().length > 0)

  // 问题文本：优先用 SSE 事件直带的 question（gateway ask-user 2026-09-22+），
  // 否则回退 approvals 列表按 questionId 查找
  createEffect(async () => {
    if (props.question.question) return
    try {
      const list = await window.api.mafw.approvals.list() as any[]
      const match = list.find((a: any) => a.id === props.question.questionId)
      if (match?.question) setApprovalText(match.question)
    } catch {}
  })

  async function submit(action: "answer" | "cancel") {
    if (submitting()) return
    setSubmitting(true)
    try {
      const answerText = hasOptions() && selected() !== null
        ? props.question.options![selected()!]
        : answer()
      if (props.question.goalId) {
        const data = await window.api.mafw.goals.respondQuestion(
          props.question.goalId,
          props.question.questionId,
          { type: action === "cancel" ? "cancel" : "answer", answer: answerText },
        )
        setResult(data.status)
      } else {
        // 无 goal 的 MCP ask_user：写 user-questions JSON（approvals.respond）
        if (action === "cancel") {
          await window.api.mafw.approvals.respond(props.question.questionId, "reject")
        } else {
          await window.api.mafw.approvals.respond(props.question.questionId, { answer: answerText })
        }
        setResult("accepted")
      }
      if (result() === "accepted") setTimeout(() => props.onDismiss(), 1200)
    } catch {
      setResult("error")
    } finally {
      setSubmitting(false)
    }
  }

  // 键盘：Esc 关闭 · 1-9 快选 · Enter 提交（有输入框时原生回车不抢）
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (result()) return
      if (e.key === "Escape") { e.preventDefault(); props.onDismiss(); return }
      const inInput = (e.target as HTMLElement)?.closest?.("input,textarea")
      if (hasOptions() && /^[1-9]$/.test(e.key) && !inInput) {
        const idx = Number(e.key) - 1
        if (idx < props.question.options!.length) { e.preventDefault(); setSelected(idx) }
        return
      }
      if (e.key === "Enter" && canSubmit() && !inInput) { e.preventDefault(); void submit("answer") }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <div class="mafw-question-overlay">
      <div class="mafw-question-card">
        <div class="mafw-question-header">
          <span class="mafw-question-chip">Agent 提问</span>
          <Show when={props.question.node || props.question.loop != null}>
            <span class="mafw-question-meta">
              {props.question.node || ""}{props.question.loop != null ? ` · loop ${props.question.loop}` : ""}
            </span>
          </Show>
          <ButtonV2 variant="ghost" size="small" class="mafw-question-close" onClick={props.onDismiss} aria-label="关闭">✕</ButtonV2>
        </div>
        <div class="mafw-question-body">
          {questionText() ? (
            <p class="mafw-question-q">{questionText()}</p>
          ) : (
            <p class="mafw-question-q mafw-question-q-dim">Goal: {props.question.goalId || props.question.questionId}</p>
          )}
          <Show when={hasOptions()}>
            <div class="mafw-question-opts" role="radiogroup">
              <For each={props.question.options}>
                {(opt: string, i) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected() === i()}
                    class="mafw-question-opt"
                    classList={{ sel: selected() === i() }}
                    disabled={submitting()}
                    onClick={() => setSelected(i())}
                  >
                    <span class="mafw-question-opt-dot" />
                    <span class="mafw-question-opt-label">{opt}</span>
                    <span class="mafw-question-opt-key">{i() + 1}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
          <Show when={props.question.questions && props.question.questions.length > 0}>
            <ul class="mafw-question-list">
              {props.question.questions!.map((q: string) => <li>{q}</li>)}
            </ul>
          </Show>
          <Show when={!result()}>
            <Show
              when={hasOptions()}
              fallback={
                <TextInputV2
                  value={answer()}
                  onInput={e => setAnswer(e.currentTarget.value)}
                  placeholder="输入你的回答…"
                  class="mafw-question-input"
                />
              }
            />
            <div class="mafw-question-actions">
              <ButtonV2 variant="contrast" size="small" onClick={() => submit("answer")} disabled={submitting() || !canSubmit()}>
                <Show when={submitting()} fallback="确认">
                  <LoaderV2 width={12} height={12} />
                </Show>
              </ButtonV2>
              <ButtonV2 variant="ghost" size="small" onClick={props.onDismiss} disabled={submitting()}>忽略</ButtonV2>
              <Show when={props.question.goalId}>
                <span class="mafw-question-actions-spacer" />
                <ButtonV2 variant="ghost" size="small" class="mafw-question-cancel-goal" onClick={() => submit("cancel")} disabled={submitting()}>取消 Goal</ButtonV2>
              </Show>
            </div>
            <p class="mafw-question-hint">Esc 关闭{hasOptions() ? " · 数字键快选 · " : " · "}Enter 确认</p>
          </Show>
          <Show when={result()}>
            <p class="mafw-question-result">{result() === "accepted" ? "已提交" : "提交失败"}</p>
          </Show>
        </div>
      </div>
    </div>
  )
}
