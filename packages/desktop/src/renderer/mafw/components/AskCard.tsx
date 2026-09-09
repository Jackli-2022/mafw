// @ts-nocheck
import { createSignal, createMemo, createEffect, Show, For } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"

export type AskQuestionData = {
  id: string
  title: string
  mode: "single" | "multi"
  options: { id: string; title: string; description?: string; recommended?: boolean }[]
  allowCustom?: boolean
}

export type AskCardData = {
  id: string
  sessionID: string
  agentName: string
  status: "pending" | "answered" | "cancelled" | "expired"
  questions: AskQuestionData[]
  answers?: Record<string, string[]>
  customText?: Record<string, string>
  createdAt: number
  /** The assistant message id whose tool call triggered this request. */
  messageID?: string
}

const CUSTOM_ID = "__custom__"

function StatusBadge(props: { status: string }) {
  if (props.status === "answered") {
    return <span class="mafw-flow-badge mafw-flow-badge-ok">已回答</span>
  }
  if (props.status === "cancelled" || props.status === "expired") {
    return <span class="mafw-flow-badge mafw-flow-badge-muted">{props.status === "expired" ? "已过期" : "已取消"}</span>
  }
  return (
    <span class="mafw-flow-badge mafw-flow-badge-wait">
      <span class="mafw-flow-pulse" />
      等待输入
    </span>
  )
}

export function AskCard(props: {
  data: AskCardData
  keyboardOwner?: boolean
  onSubmit?: (answers: Record<string, string[]>, customText: Record<string, string>) => void
  onCancel?: () => void
}) {
  const [selected, setSelected] = createSignal<Record<string, string[]>>({})
  const [customVals, setCustomVals] = createSignal<Record<string, string>>({})
  const customRefs: Record<string, HTMLInputElement | undefined> = {}

  const questions = () => props.data.questions

  // Auto-focus the custom input when the "其他" option is selected.
  createEffect(() => {
    for (const q of questions()) {
      if ((selected()[q.id] || []).includes(CUSTOM_ID)) {
        const el = customRefs[q.id]
        if (el && document.activeElement !== el) el.focus()
      }
    }
  })

  const answeredCount = createMemo(() =>
    questions().filter(q => {
      const sel = selected()[q.id] || []
      if (sel.length === 0) return false
      if (sel.includes(CUSTOM_ID)) return (customVals()[q.id] || "").trim().length > 0
      return true
    }).length,
  )
  const submittable = createMemo(() => props.data.status === "pending" && answeredCount() === questions().length)

  const toggleOption = (q: AskQuestionData, optId: string) => {
    if (props.data.status !== "pending") return
    setSelected(prev => {
      const cur = prev[q.id] || []
      if (q.mode === "multi") {
        return { ...prev, [q.id]: cur.includes(optId) ? cur.filter(x => x !== optId) : [...cur, optId] }
      }
      return { ...prev, [q.id]: [optId] }
    })
  }

  const submit = () => {
    if (!submittable()) return
    const answers: Record<string, string[]> = {}
    const custom: Record<string, string> = {}
    for (const q of questions()) {
      const sel = selected()[q.id] || []
      if (sel.includes(CUSTOM_ID)) {
        answers[q.id] = [(customVals()[q.id] || "").trim()]
        custom[q.id] = (customVals()[q.id] || "").trim()
      } else {
        answers[q.id] = sel
      }
    }
    props.onSubmit?.(answers, custom)
  }

  // Keyboard: 1-9 select (per in-group index of the first unanswered question),
  // Enter submit, Esc cancel — only while pending, keyboard-owner, no input focused.
  createEffect(() => {
    if (props.data.status !== "pending" || !props.keyboardOwner) return
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return
      if (e.key === "Enter") { e.preventDefault(); submit() }
      else if (e.key === "Escape") { e.preventDefault(); props.onCancel?.() }
      else if (/^[1-9]$/.test(e.key)) {
        const q = questions().find(qq => {
          const sel = selected()[qq.id] || []
          return !(sel.length > 0 && (!sel.includes(CUSTOM_ID) || (customVals()[qq.id] || "").trim().length > 0))
        })
        if (q) {
          const idx = Number(e.key) - 1
          const options = [...q.options]
          if (q.allowCustom !== false) options.push({ id: CUSTOM_ID, title: "其他（输入自定义回答）" })
          if (idx < options.length) toggleOption(q, options[idx].id)
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const summary = createMemo(() => {
    const answers = props.data.answers || {}
    const custom = props.data.customText || {}
    return questions().map(q => {
      const sel = answers[q.id] || []
      const chips = sel.map(s => (s === CUSTOM_ID ? (custom[q.id] || "") : s)).filter(Boolean)
      return { q, chips }
    })
  })

  return (
    <section class="mafw-flow-card" classList={{
      "mafw-flow-card-dimmed": props.data.status === "cancelled" || props.data.status === "expired",
      "mafw-flow-card-resolved": props.data.status !== "pending",
    }}>
      <div class="mafw-flow-leftbar" />
      {/* Header */}
      <header class="mafw-flow-header">
        <span class="mafw-flow-icon">?</span>
        <span class="mafw-flow-title">{props.data.agentName || "Agent"} 需要你的决策</span>
        <div class="mafw-flow-badge-wrap">
          <StatusBadge status={props.data.status} />
        </div>
      </header>

      <Show when={props.data.status === "pending"} fallback={
        /* collapsed summary (answered / cancelled / expired) */
        <div class="mafw-flow-summary">
          <For each={summary()}>
            {(row) => (
              <div class="mafw-flow-summary-row">
                <span class="mafw-flow-summary-check">✓</span>
                <span class="mafw-flow-summary-text">{row.q.title}</span>
                <span class="mafw-flow-summary-chips">
                  <For each={row.chips}>
                    {(c) => <span class="mafw-flow-chip">{c}</span>}
                  </For>
                </span>
              </div>
            )}
          </For>
        </div>
      }>
        {/* Questions */}
        <For each={questions()}>
          {(q) => (
            <div class="mafw-flow-question">
              <h3 class="mafw-flow-qtitle">{q.title}</h3>
              <div class="mafw-flow-opts">
                <For each={q.options}>
                  {(opt) => {
                    const sel = () => selected()[q.id] || []
                    const isSel = () => sel().includes(opt.id)
                    return (
                      <div
                        class="mafw-flow-opt"
                        classList={{ selected: isSel() }}
                        onClick={() => toggleOption(q, opt.id)}
                      >
                        <span
                          class="mafw-flow-mark"
                          classList={{
                            checked: isSel(),
                            "mafw-flow-mark-multi": q.mode === "multi",
                            "mafw-flow-mark-single": q.mode === "single",
                          }}
                        >
                          {q.mode === "multi" && isSel() && (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                              <path d="M2 5.2L4 7.2L8 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                            </svg>
                          )}
                        </span>
                        <span class="mafw-flow-opt-body">
                          <span class="mafw-flow-opt-title">
                            {opt.title}
                            {opt.recommended && <span class="mafw-flow-rec">推荐</span>}
                          </span>
                          <Show when={opt.description}>
                            <span class="mafw-flow-opt-desc">{opt.description}</span>
                          </Show>
                        </span>
                      </div>
                    )
                  }}
                </For>
                <Show when={q.allowCustom !== false}>
                  <div
                    class="mafw-flow-opt"
                    classList={{ selected: (selected()[q.id] || []).includes(CUSTOM_ID) }}
                    onClick={() => toggleOption(q, CUSTOM_ID)}
                  >
                    <span class="mafw-flow-mark mafw-flow-mark-single" classList={{ checked: (selected()[q.id] || []).includes(CUSTOM_ID) }} />
                    <span class="mafw-flow-opt-body">
                      <span class="mafw-flow-opt-title">其他（输入自定义回答）</span>
                    </span>
                  </div>
                  <div
                    class="mafw-flow-custom"
                    style={{ "grid-template-rows": (selected()[q.id] || []).includes(CUSTOM_ID) ? "1fr" : "0fr" }}
                  >
                    <div class="mafw-flow-custom-inner">
                      <input
                        type="text"
                        class="mafw-flow-custom-input"
                        placeholder="输入你的回答…"
                        value={customVals()[q.id] || ""}
                        ref={el => { customRefs[q.id] = el }}
                        onInput={e => setCustomVals(prev => ({ ...prev, [q.id]: e.currentTarget.value }))}
                      />
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          )}
        </For>
        {/* Footer */}
        <footer class="mafw-flow-footer">
          <span class="mafw-flow-keyhint">1-9 选择 · Enter 提交</span>
          <div class="mafw-flow-footer-actions">
            <ButtonV2 variant="ghost" size="small" class="mafw-flow-btn-ghost" onClick={() => props.onCancel?.()}>
              取消
            </ButtonV2>
            <ButtonV2
              variant="contrast"
              size="small"
              class="mafw-flow-btn-primary"
              classList={{ "mafw-flow-btn-disabled": !submittable() }}
              disabled={!submittable()}
              onClick={submit}
            >
              提交
            </ButtonV2>
          </div>
        </footer>
      </Show>
    </section>
  )
}
