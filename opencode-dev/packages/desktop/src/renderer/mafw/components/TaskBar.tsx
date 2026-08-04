// @ts-nocheck
import { createSignal, createEffect, createMemo, onCleanup, Show } from "solid-js"

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

export function TaskBar(props: {
  todos: any[]
  tokens: number
  started: number
  open: boolean
  onToggle: () => void
}) {
  const total = () => props.todos.length
  const done = () => props.todos.filter(t => t.status === "completed").length
  const running = () => props.todos.filter(t => t.status === "in_progress")
  const [now, setNow] = createSignal(Date.now())
  const [allDoneHidden, setAllDoneHidden] = createSignal(false)

  const allDone = () => total() > 0 && done() === total()

  // Elapsed ticker: only while a task is running (freezes on complete/interrupt).
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running().length > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  // "✔ 全部完成" shown 3.5s, then auto-hide (delayed hide per design Q4).
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    if (allDone()) {
      setAllDoneHidden(false)
      if (!hideTimer) hideTimer = setTimeout(() => setAllDoneHidden(true), 3500)
    } else if (hideTimer) {
      clearTimeout(hideTimer)
      hideTimer = null
    }
  })
  onCleanup(() => { if (hideTimer) clearTimeout(hideTimer) })

  // No tasks → zero footprint. Reactive (Show) — SolidJS component bodies run once.
  const visible = () => total() > 0 && !(allDone() && allDoneHidden())

  const current = () => running()[0] || [...props.todos].reverse().find(t => t.status === "completed")
  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))
  const pct = () => (total() > 0 ? Math.round((done() / total()) * 100) : 0)

  return (
    <Show when={visible()}>
      <button
        type="button"
        class="mafw-taskbar"
        classList={{ open: props.open }}
        onClick={props.onToggle}
        aria-label="任务列表"
      >
        <Show when={!allDone()} fallback={<span class="mafw-taskbar-check">✔ 全部完成（{done()}/{total()}）</span>}>
          <Show when={running().length > 0} fallback={<span class="mafw-taskbar-spinner" />}>
            <span class="mafw-taskbar-spinner running" />
          </Show>
          <span class="mafw-taskbar-text">{current()?.content || ""}</span>
          <Show when={current()?.priority === "high"}>
            <span class="mafw-taskbar-priority">HIGH</span>
          </Show>
          <span class="mafw-taskbar-num">{done()}/{total()}</span>
          <span class="mafw-taskbar-progress"><span style={{ width: `${pct()}%` }} /></span>
          <span class="mafw-taskbar-time">{formatDuration(elapsedMs())}</span>
        </Show>
        <span class="mafw-taskbar-chevron" classList={{ open: props.open }}>▾</span>
      </button>
    </Show>
  )
}
