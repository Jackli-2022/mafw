// @ts-nocheck
import { createSignal, createEffect, Show, For, onMount, onCleanup } from "solid-js"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"

// Goal drill-down: metadata (goals.get) + orchestration session list
// (goals.sessions, gateway /api/goals/:id/sessions). Clicking a session opens
// it as a chat tab via MafwShell.openSessionTab.
export function GoalDetailOverlay(props: { goalId: string | null; onClose: () => void; onOpenSession: (sid: string) => void }) {
  const [goal, setGoal] = createSignal<any>(null)
  const [sessions, setSessions] = createSignal<any[]>([])
  const [loading, setLoading] = createSignal(false)

  createEffect(() => {
    const id = props.goalId
    if (!id) { setGoal(null); setSessions([]); return }
    setLoading(true)
    void (async () => {
      try {
        const [g, s] = await Promise.all([
          window.api.mafw.goals.get(id),
          window.api.mafw.goals.sessions(id),
        ])
        setGoal(g)
        setSessions(s || [])
      } catch (e) { console.warn("[mafw] goal detail load failed:", e) }
      setLoading(false)
    })()
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <Show when={props.goalId}>
      <div class="mafw-goal-overlay" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
        <div class="mafw-goal-panel">
          <div class="mafw-goal-head">
            <div style={{ "min-width": 0 }}>
              <div class="mafw-card-title">{goal()?.goalId || props.goalId}</div>
              <div class="mafw-card-meta">{goal()?.title || ""}</div>
            </div>
            <button class="mafw-btn" onClick={props.onClose} aria-label="关闭详情">✕</button>
          </div>
          <Show when={!loading()} fallback={
            <div style={{ display: "flex", gap: 8, padding: "32px 0", "justify-content": "center" }}>
              <LoaderV2 width={16} height={16} />
            </div>
          }>
            <div class="mafw-goal-meta">
              <span class="mafw-badge">{goal()?.phase || "UNKNOWN"}</span>
              <span class="mafw-card-meta">Wave {goal()?.currentWave ?? "?"}/{goal()?.totalWaves ?? "?"} · Loop {goal()?.loop ?? 0}</span>
            </div>
            <Show when={goal()?.charter}>
              <div class="mafw-goal-charter">{goal()?.charter}</div>
            </Show>
            <div class="mafw-goal-sessions">
              <div class="mafw-goal-sec-title">编排会话（{sessions().length}）</div>
              <Show when={sessions().length === 0} fallback={
                <For each={sessions()}>
                  {(s) => (
                    <div class="mafw-goal-session" onClick={() => props.onOpenSession(s.sessionID)}>
                      <span class="mafw-goal-session-title">{s.title || s.sessionID}</span>
                      <span class="mafw-card-meta">{s.phase}{s.loop ? ` · Loop ${s.loop}` : ""}</span>
                    </div>
                  )}
                </For>
              }>
                <div class="mafw-empty">暂无会话记录</div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  )
}
