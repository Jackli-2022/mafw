// @ts-nocheck
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

const formatDuration = (ms: number): string => {
  if (!ms || ms < 0) return "0s"
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

const formatTokens = (n: number): string =>
  n >= 10000 ? `${(n / 1000).toFixed(1)}k tokens` : `${n} tokens`

function StatusSlot(props: { status: string }) {
  if (props.status === "completed") {
    return (
      <span class="mafw-task-status done">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2.5 6.5L4.8 8.8L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    )
  }
  if (props.status === "in_progress") {
    return <span class="mafw-task-status running" />
  }
  if (props.status === "cancelled") {
    return (
      <span class="mafw-task-status failed">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2.5 2.5L7.5 7.5M7.5 2.5L2.5 7.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </span>
    )
  }
  return <span class="mafw-task-status pending" />
}

export function TaskList(props: {
  todos: any[]
  tokens: number
  started: number
  placement: "popover" | "dock" | "overlay"
  onClose: () => void
  onPin: () => void
  }) {
  const total = () => props.todos.length
  const done = () => props.todos.filter(t => t.status === "completed").length
  const running = () => props.todos.filter(t => t.status === "in_progress")
  const failed = () => props.todos.filter(t => t.status === "cancelled")
  const pending = () => props.todos.filter(t => t.status === "pending")

  const [now, setNow] = createSignal(Date.now())
  const [completedExpanded, setCompletedExpanded] = createSignal(false)
  const [overflowExpanded, setOverflowExpanded] = createSignal(false)

  // Elapsed ticker freezes when the run is not running.
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running().length > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))

  // Density model (§9.1): completed collapsed when >4 total; pending window 2 (running) / 3 (no running).
  const compact = () => total() > 4
  const pendingWindow = () => (running().length > 0 ? 2 : 3)
  const visiblePending = createMemo(() => (compact() ? pending().slice(0, pendingWindow()) : pending()))
  const pendingOverflow = createMemo(() => pending().length - visiblePending().length)
  const completedVisible = createMemo(() => {
    if (!compact() || completedExpanded()) return props.todos.filter(t => t.status === "completed")
    return []
  })
  const completedCount = () => done()

  const visibleRows = createMemo(() => {
    const rows: any[] = []
    if (compact()) {
      rows.push(...completedVisible())
      rows.push(...running(), ...failed(), ...visiblePending())
    } else {
      rows.push(...props.todos)
    }
    return rows
  })

  return (
    <div class={`mafw-tasklist mafw-tasklist-${props.placement}`}>
      <div class="mafw-tasklist-header">
        <span class="mafw-tasklist-title">Tasks</span>
        <span class="mafw-tasklist-metrics">{formatDuration(elapsedMs())} · {formatTokens(props.tokens)}</span>
        <span class="mafw-tasklist-progress">{done()}/{total()}</span>
        <Show when={props.placement === "popover"}>
          <ButtonV2 variant="ghost" size="small" class="mafw-tasklist-pin" onClick={props.onPin} aria-label="钉到右侧 Dock">📌</ButtonV2>
        </Show>
        <ButtonV2 variant="ghost" size="small" class="mafw-tasklist-close" onClick={props.onClose} aria-label="关闭">✕</ButtonV2>
      </div>
      <div class="mafw-tasklist-body">
        <Show when={compact() && completedCount() > 0 && !completedExpanded()}>
          <button type="button" class="mafw-tasklist-collapse" onClick={() => setCompletedExpanded(true)}>
            ✔ {completedCount()} 个已完成
          </button>
        </Show>
        <For each={visibleRows()}>
          {(t) => (
            <div class="mafw-task-row" data-slot="task-row">
              <StatusSlot status={t.status} />
              <p
                class="mafw-task-content"
                classList={{ done: t.status === "completed", failed: t.status === "cancelled" }}
              >
                <span class="mafw-task-text">{t.content}</span>
                <Show when={t.priority === "high"}>
                  <span class="mafw-task-priority">HIGH</span>
                </Show>
              </p>
            </div>
          )}
        </For>
        <Show when={compact() && pendingOverflow() > 0 && !overflowExpanded()}>
          <button type="button" class="mafw-tasklist-collapse" onClick={() => setOverflowExpanded(true)}>
            还有 {pendingOverflow()} 个待执行
          </button>
        </Show>
      </div>
    </div>
  )
}
