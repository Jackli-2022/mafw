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

export function TaskBar(props: {
  todos: any[]
  tokens: number
  started: number
  open: boolean
  onToggle: () => void
  onHoverOpen: () => void
  onHoverLeave: () => void
}) {
  const total = () => props.todos.length
  const done = () => props.todos.filter(t => t.status === "completed").length
  const running = () => props.todos.filter(t => t.status === "in_progress")
  const [now, setNow] = createSignal(Date.now())

  const allDone = () => total() > 0 && done() === total()

  // Elapsed ticker: only while a task is running (freezes on complete/interrupt).
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running().length > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) { clearInterval(tickTimer); tickTimer = null }
  })
  onCleanup(() => { if (tickTimer) clearInterval(tickTimer) })

  // No auto-hide: the bar stays while tasks exist (all-done state persists).
  const hasTasks = () => total() > 0

  const current = () => running()[0] || [...props.todos].reverse().find(t => t.status === "completed")
  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))
  const pct = () => (total() > 0 ? Math.round((done() / total()) * 100) : 0)

  return (
    <div
      role="button"
      tabIndex={0}
      class="mafw-taskbar"
      classList={{ open: props.open, "has-tasks": hasTasks() }}
      onClick={props.onToggle}
      onMouseEnter={props.onHoverOpen}
      onMouseLeave={props.onHoverLeave}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onToggle() } }}
      aria-label="任务列表"
    >
      <Show when={hasTasks()} fallback={<span class="mafw-taskbar-empty">任务</span>}>
        <Show when={!allDone()} fallback={<span class="mafw-taskbar-check">✔ 全部完成（{done()}/{total()}）</span>}>
          <Show when={running().length > 0} fallback={<span class="mafw-taskbar-spinner pending" />}>
            <span class="mafw-taskbar-spinner running" />
          </Show>
          <span class="mafw-taskbar-text">{current()?.content || ""}</span>
          <Show when={current()?.priority === "high"}>
            <span class="mafw-taskbar-priority">HIGH</span>
          </Show>
          <span class="mafw-taskbar-num">{done()}/{total()}</span>
          <span class="mafw-taskbar-time">{formatDuration(elapsedMs())}</span>
        </Show>
      </Show>
      <span class="mafw-taskbar-progress"><span style={{ width: `${pct()}%` }} /></span>
      <span class="mafw-taskbar-chevron" classList={{ open: props.open }}>▾</span>
    </div>
  )
}
