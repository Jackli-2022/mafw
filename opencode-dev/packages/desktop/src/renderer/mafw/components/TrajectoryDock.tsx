// @ts-nocheck
import { createEffect, createSignal, For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

const fmtDur = (ms?: number | null): string => {
  if (ms === null || ms === undefined || ms < 0) return "\u2014"
  if (ms < 1000) return `${Math.round(ms)}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m ${s % 60}s`
}

const fmtTokens = (n: number): string => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n))

const fmtCost = (c: number): string => `$${Number(c).toFixed(4)}`

export function TrajectoryDock(props: {
  sessionID: string
  liveEvents?: any[]
  liveTurn?: any | null
}) {
  const [state, setState] = createStore<{
    turns: any[]
    events: any[]
    expanded: Record<number, boolean>
    error: string | null
    loading: boolean
  }>({ turns: [], events: [], expanded: {}, error: null, loading: false })

  let loadedFor = ""

  const load = async (rebuild?: boolean) => {
    if (!props.sessionID) return
    setState("loading", true)
    try {
      const r = await window.api.mafw.sessions.trajectory(props.sessionID, { limit: 50, rebuild })
      setState("turns", r.turns || [])
      setState("events", r.events || [])
      setState("error", null)
    } catch (e: any) {
      setState("error", e?.message || "\u52a0\u8f7d\u5931\u8d25")
    } finally {
      setState("loading", false)
    }
  }

  createEffect(() => {
    const sid = props.sessionID
    if (!sid) return
    if (loadedFor !== sid) {
      loadedFor = sid
      void load()
    }
  })

  createEffect(() => {
    const live = props.liveEvents
    if (!live || live.length === 0) return
    const sid = props.sessionID
    const filtered = live.filter((e: any) => (e.sessionID || e.session_id) === sid)
    if (filtered.length === 0) return
    setState("events", (prev: any[]) => {
      const seen = new Set(prev.map((e: any) => `${e.turnID ?? e.turn_id ?? 0}:${e.seq}`))
      const merged = [...prev]
      for (const e of filtered) {
        const key = `${e.turnID ?? e.turn_id ?? 0}:${e.seq ?? 0}`
        if (!seen.has(key)) {
          merged.push(e)
          seen.add(key)
        }
      }
      return merged.sort((a: any, b: any) => (a.turnID ?? a.turn_id ?? 0) - (b.turnID ?? b.turn_id ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
    })
  })

  createEffect(() => {
    const t = props.liveTurn
    if (!t) return
    const sid = props.sessionID
    if ((t.sessionID || t.session_id) !== sid) return
    const tid = t.turnID ?? t.turn_id
    setState("turns", (prev: any[]) => {
      const idx = prev.findIndex((x: any) => (x.turnID ?? x.turn_id) === tid)
      if (idx >= 0) return [...prev.slice(0, idx), t, ...prev.slice(idx + 1)]
      return [...prev, t].sort((a: any, b: any) => (b.turnID ?? b.turn_id) - (a.turnID ?? a.turn_id))
    })
  })

  const toggleTurn = (id: number) => setState("expanded", id, (v: boolean) => !v)

  const eventsForTurn = (turnID: number) => state.events.filter((e: any) => (e.turnID ?? e.turn_id) === turnID)

  const totalTools = () => state.turns.reduce((a: number, t: any) => a + (t.toolCount ?? t.tool_count ?? 0), 0)
  const totalCost = () => state.turns.reduce((a: number, t: any) => a + (t.cost || 0), 0)
  const tid = (t: any) => t.turnID ?? t.turn_id ?? 0

  return (
    <div class="mafw-trajectory-dock">
      <div class="mafw-trajectory-summary">
        <span>\u56de\u5408 {state.turns.length}</span>
        <span>\u5de5\u5177 {totalTools()}</span>
        <span>\u6210\u672c {fmtCost(totalCost())}</span>
        <TooltipV2 value="\u5237\u65b0" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-trajectory-refresh" onClick={() => void load(true)} aria-label="\u5237\u65b0">
            ⟳
          </ButtonV2>
        </TooltipV2>
      </div>
      <Show when={state.error}>
        <div class="mafw-trajectory-error">{state.error}</div>
        <ButtonV2 variant="outline" size="small" onClick={() => void load()}>
          \u91cd\u8bd5
        </ButtonV2>
      </Show>
      <Show when={!state.error && state.turns.length === 0 && !state.loading}>
        <div class="mafw-trajectory-empty">
          \u6682\u65e0\u8f68\u8ff9\u6570\u636e
          <br />
          \u53d1\u9001\u6d88\u606f\u540e\u6b64\u5904\u663e\u793a agent \u8f68\u8ff9
        </div>
      </Show>
      <div class="mafw-trajectory-list">
        <For each={[...state.turns].sort((a: any, b: any) => (b.turnID ?? b.turn_id) - (a.turnID ?? a.turn_id))}>
          {(t) => (
            <div class="mafw-trajectory-turn" classList={{ open: !!state.expanded[tid(t)] }}>
              <button type="button" class="mafw-trajectory-turn-head" onClick={() => toggleTurn(tid(t))}>
                <span class="mafw-trajectory-turn-user">{(t.userText ?? t.user_text) || `\u56de\u5408 ${tid(t)}`}</span>
                <span class="mafw-trajectory-turn-kpis">
                  <span>{(t.toolCount ?? t.tool_count ?? 0)} \u5de5\u5177</span>
                  <span>{fmtDur(t.durationMs ?? t.duration_ms)}</span>
                  <span>
                    {fmtTokens((t.tokens?.input || 0) + (t.tokens?.output || 0))} tok
                  </span>
                  <span>{fmtCost(t.cost || 0)}</span>
                </span>
                <Show when={t.finish === "tool-calls" || t.finish === "length"}>
                  <span class="mafw-trajectory-finish-badge">{t.finish}</span>
                </Show>
              </button>
              <Show when={state.expanded[tid(t)]}>
                <div class="mafw-trajectory-events">
                  <For each={eventsForTurn(tid(t))}>
                    {(e) => (
                      <div class={`mafw-trajectory-event mafw-trajectory-${e.eventType ?? e.event_type}`}>
                        <span class="mafw-trajectory-event-icon">
                          {e.eventType === "tool_start" && "\u27f3"}
                          {e.eventType === "tool_end" && (e.toolState === "error" ? "\u2717" : "\u2713")}
                          {(e.eventType === "reasoning_start" || e.eventType === "reasoning_end") && "\uD83E\uDDE0"}
                          {e.eventType === "model_switch" && "\u21C4"}
                          {e.eventType === "agent_switch" && "\u21C4"}
                          {e.eventType === "step_finish" && "\u2211"}
                          {e.eventType === "turn_start" && "\u25B6"}
                          {e.eventType === "turn_end" && "\u25A0"}
                        </span>
                        <span class="mafw-trajectory-event-main">
                          <Show when={e.toolName || e.tool_name}>
                            <span class="mafw-trajectory-tool-name">{e.toolName || e.tool_name}</span>
                          </Show>
                          <Show when={e.model}>
                            <span class="mafw-trajectory-model">{e.model}</span>
                          </Show>
                          <Show when={e.agent}>
                            <span class="mafw-trajectory-agent">Agent: {e.agent}</span>
                          </Show>
                          <Show when={e.outputSummary || e.output_summary || e.error}>
                            <span class="mafw-trajectory-output">{e.error || e.outputSummary || e.output_summary}</span>
                          </Show>
                          <Show when={e.cost !== undefined || e.tokens}>
                            <span class="mafw-trajectory-tokens">
                              {fmtTokens(e.tokens?.input || 0)}/{fmtTokens(e.tokens?.output || 0)} tok
                              <Show when={e.cost !== undefined}>{" \u00b7 "}{fmtCost(e.cost || 0)}</Show>
                            </span>
                          </Show>
                        </span>
                        <Show when={e.durationMs !== undefined && e.durationMs !== null}>
                          <span class="mafw-trajectory-duration">{fmtDur(e.durationMs)}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}
