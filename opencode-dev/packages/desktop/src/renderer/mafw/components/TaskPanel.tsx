// @ts-nocheck
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js"

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
      <span
        class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--accent)", color: "var(--on-accent)" }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path d="M3 7.5L5.5 10L11 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    )
  }
  if (props.status === "cancelled") {
    return (
      <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--surface-base-hover)", color: "var(--text-weak)" }}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 6H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </span>
    )
  }
  return (
    <span class="grid w-4 shrink-0 cursor-grab grid-cols-2 gap-[4px] self-center" style={{ color: "var(--text-weak)" }}>
      <For each={Array(6)}>{() => <i class="h-[2.5px] w-[2.5px] rounded-full bg-current" />}</For>
    </span>
  )
}

export function TaskPanel(props: {
  sessionID: string
  todos: any[]
  tokens: number
  started: number
}) {
  const [collapsed, setCollapsed] = createSignal(false)
  const [now, setNow] = createSignal(Date.now())
  // Collapse state remembered per session: switching tabs keeps a session's
  // auto-collapsed summary collapsed instead of expanding it back.
  const [collapsedBySession, setCollapsedBySession] = createSignal<Record<string, boolean>>({})

  const applyCollapsed = (v: boolean) => {
    setCollapsed(v)
    setCollapsedBySession(prev => ({ ...prev, [props.sessionID]: v }))
  }

  createEffect(() => {
    setCollapsed(collapsedBySession()[props.sessionID] ?? false)
  })

  // Auto-collapse to the one-line summary 5s after all todos are done.
  let collapseTimer: ReturnType<typeof setTimeout> | null = null
  createEffect(() => {
    const allDone = done() === total() && total() > 0
    if (allDone) {
      if (collapseTimer) return
      collapseTimer = setTimeout(() => applyCollapsed(true), 5000)
    } else if (collapseTimer) {
      clearTimeout(collapseTimer)
      collapseTimer = null
    }
  })

  // Elapsed ticker freezes when the run is not running (all done / interrupted).
  let tickTimer: ReturnType<typeof setInterval> | null = null
  createEffect(() => {
    const active = running() > 0
    if (active && !tickTimer) tickTimer = setInterval(() => setNow(Date.now()), 1000)
    else if (!active && tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
  })

  onCleanup(() => {
    if (tickTimer) clearInterval(tickTimer)
    if (collapseTimer) clearTimeout(collapseTimer)
  })

  const elapsedMs = createMemo(() => (props.started ? Math.max(0, now() - props.started) : 0))
  const done = createMemo(() => props.todos.filter(t => t.status === "completed").length)
  const running = createMemo(() => props.todos.filter(t => t.status === "in_progress").length)
  const total = () => props.todos.length

  return (
    <section
      class="mafw-task-panel relative overflow-hidden shrink-0"
      style={{
        background: "var(--bg-float)",
        border: "1px solid var(--border-subtle)",
        "border-radius": "16px",
        "box-shadow": "var(--shadow-float)",
      }}
    >
      {/* decorative glow */}
      <div
        class="pointer-events-none absolute inset-0"
        style={{
          background: "var(--tasks-glow)",
        }}
      />
      <header
        class="relative flex h-10 items-center gap-2 px-4 cursor-pointer select-none"
        onClick={() => applyCollapsed(!collapsed())}
      >
        <svg
          width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"
          class="transition-transform duration-200"
          style={{ transform: collapsed() ? "rotate(-90deg)" : "rotate(0deg)", color: "var(--text-weak)" }}
        >
          <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <h2 class="text-[14px] font-medium" style={{ color: "var(--v2-text-text-base, var(--text-strong))" }}>Tasks</h2>
        <Show
          when={collapsed()}
          fallback={
            <div class="ml-auto flex items-center gap-3">
              <span
                class="rounded-full px-3 py-1 text-[12px] tabular-nums"
                style={{ background: "var(--v2-background-bg-layer-02, var(--surface-base-hover))", color: "var(--v2-text-text-muted, var(--text-base))" }}
              >
                {formatDuration(elapsedMs())} · {formatTokens(props.tokens)}
              </span>
              <span class="text-[13px] tabular-nums" style={{ color: "var(--v2-text-text-base, var(--text-strong))" }}>
                {done()}/{total()}
              </span>
            </div>
          }
        >
          <div class="ml-auto flex items-center gap-3">
            <span class="text-[12px] tabular-nums" style={{ color: "var(--accent-text)" }}>
              ✓ {done()} tasks · {formatDuration(elapsedMs())}
            </span>
          </div>
        </Show>
      </header>
      <div
        class="grid transition-[grid-template-rows] duration-200"
        style={{ "grid-template-rows": collapsed() ? "0fr" : "1fr" }}
      >
        <div class="overflow-hidden">
          <div class="relative flex flex-col px-2 pb-2">
            <For each={props.todos}>
              {(t) => {
                const completed = t.status === "completed"
                return (
                  <div
                    class="flex min-h-[38px] items-center gap-3 rounded-lg px-2 transition-colors"
                    data-slot="task-row"
                    style={{ "background": "transparent" }}
                  >
                    <StatusSlot status={t.status} />
                    <p
                      class="flex min-w-0 items-center gap-2 text-[13px] leading-[1.4]"
                      style={{
                        color: completed
                          ? "var(--v2-text-text-faint, var(--text-weak))"
                          : t.status === "cancelled"
                            ? "var(--v2-text-text-faint, var(--text-weak))"
                            : "var(--v2-text-text-base, var(--text-strong))",
                        "text-decoration": completed ? "line-through" : "none",
                        "text-decoration-color": completed ? "color-mix(in srgb, var(--v2-text-text-faint, var(--text-weak)) 70%, transparent)" : undefined,
                      }}
                    >
                      <span class="truncate">{t.content}</span>
                      <Show when={t.priority && t.priority !== "medium"}>
                        <span
                          class="shrink-0 rounded-full px-1.5 text-[10px] uppercase"
                          style={{
                            background: t.priority === "high"
                              ? "color-mix(in srgb, var(--icon-warning-base, #e8b84b) 18%, transparent)"
                              : "var(--v2-background-bg-layer-02, var(--surface-base-hover))",
                            color: t.priority === "high"
                              ? "var(--icon-warning-base, #e8b84b)"
                              : "var(--v2-text-text-faint, var(--text-weak))",
                          }}
                        >
                          {t.priority}
                        </span>
                      </Show>
                    </p>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </div>
    </section>
  )
}
