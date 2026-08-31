// @ts-nocheck
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js"
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
  const [apiEvents, setApiEvents] = createSignal<any[]>([])
  const [apiTurns, setApiTurns] = createSignal<any[]>([])
  const [error, setError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [expanded, setExpanded] = createStore<Record<number, boolean>>({})

  let loadedFor = ""

  const load = async (rebuild?: boolean) => {
    if (!props.sessionID) return
    setLoading(true)
    try {
      const r = await window.api.mafw.sessions.trajectory(props.sessionID, { limit: 50, rebuild })
      setApiEvents(r.events || [])
      setApiTurns(r.turns || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || "\u52a0\u8f7d\u5931\u8d25")
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    const sid = props.sessionID
    console.log("[TrajectoryDock] sessionID changed:", sid, "loadedFor:", loadedFor)
    if (!sid) return
    if (loadedFor !== sid) {
      loadedFor = sid
      void load()
    }
  })

  createEffect(() => {
    const live = props.liveEvents || []
    console.log("[TrajectoryDock] liveEvents updated:", live.length, "events for session:", props.sessionID)
  })

  createEffect(() => {
    const t = props.liveTurn
    console.log("[TrajectoryDock] liveTurn updated:", t ? `turnID=${t.turnID ?? t.turn_id}` : "null")
  })

  const displayedEvents = createMemo(() => {
    const api = apiEvents()
    const live = props.liveEvents || []
    const sid = props.sessionID
    const filtered = live.filter((e: any) => (e.sessionID || e.session_id) === sid)
    if (filtered.length === 0) return api
    const seen = new Set(api.map((e: any) => `${e.turnID ?? e.turn_id ?? 0}:${e.seq}`))
    const merged = [...api]
    for (const e of filtered) {
      const key = `${e.turnID ?? e.turn_id ?? 0}:${e.seq ?? 0}`
      if (!seen.has(key)) {
        merged.push(e)
        seen.add(key)
      }
    }
    return merged.sort((a: any, b: any) => (a.turnID ?? a.turn_id ?? 0) - (b.turnID ?? b.turn_id ?? 0) || (a.seq ?? 0) - (b.seq ?? 0))
  })

  const displayedTurns = createMemo(() => {
    const api = apiTurns()
    const live = props.liveTurn
    if (!live) return api
    const sid = props.sessionID
    if ((live.sessionID || live.session_id) !== sid) return api
    const tid = live.turnID ?? live.turn_id
    const idx = api.findIndex((x: any) => (x.turnID ?? x.turn_id) === tid)
    if (idx >= 0) return [...api.slice(0, idx), live, ...api.slice(idx + 1)]
    return [...api, live].sort((a: any, b: any) => (b.turnID ?? b.turn_id) - (a.turnID ?? a.turn_id))
  })

  const toggleTurn = (id: number) => setExpanded(id, (v: boolean) => !v)

  const eventsForTurn = (turnID: number) => displayedEvents().filter((e: any) => (e.turnID ?? e.turn_id) === turnID)

  const totalTools = () => displayedTurns().reduce((a: number, t: any) => a + (t.toolCount ?? t.tool_count ?? 0), 0)
  const totalCost = () => displayedTurns().reduce((a: number, t: any) => a + (t.cost || 0), 0)
  const tid = (t: any) => t.turnID ?? t.turn_id ?? 0

  const sortedTurns = createMemo(() =>
    [...displayedTurns()].sort((a: any, b: any) => (b.turnID ?? b.turn_id) - (a.turnID ?? a.turn_id))
  )

  return (
    <div class="mafw-trajectory-dock">
      <div class="mafw-trajectory-summary">
        <span class="mafw-trajectory-kpi">
          <span class="mafw-trajectory-kpi-icon">↻</span>
          <span class="mafw-trajectory-kpi-value">{displayedTurns().length}</span>
          <span>回合</span>
        </span>
        <span class="mafw-trajectory-kpi">
          <span class="mafw-trajectory-kpi-icon">⚙</span>
          <span class="mafw-trajectory-kpi-value">{totalTools()}</span>
          <span>工具</span>
        </span>
        <span class="mafw-trajectory-kpi">
          <span class="mafw-trajectory-kpi-icon">$</span>
          <span class="mafw-trajectory-kpi-value">{fmtCost(totalCost())}</span>
        </span>
        <TooltipV2 value="刷新" openDelay={300}>
          <ButtonV2 variant="ghost" size="small" class="mafw-trajectory-refresh" onClick={() => void load(true)} aria-label="刷新">
            ⟳
          </ButtonV2>
        </TooltipV2>
      </div>
      <Show keyed when={error()}>
        <div class="mafw-trajectory-error">{error()}</div>
        <ButtonV2 variant="outline" size="small" onClick={() => void load()}>
          重试
        </ButtonV2>
      </Show>
      <Show when={!error() && displayedTurns().length === 0 && !loading()}>
        <div class="mafw-trajectory-empty">
          <div class="mafw-trajectory-empty-icon">📊</div>
          <div class="mafw-trajectory-empty-text">暂无轨迹数据</div>
          <div class="mafw-trajectory-empty-hint">发送消息后此处显示 agent 执行轨迹</div>
        </div>
      </Show>
      <div class="mafw-trajectory-list">
        <For each={sortedTurns()}>
          {(t) => (
            <div class="mafw-trajectory-turn" classList={{ open: !!expanded[tid(t)] }}>
              <button type="button" class="mafw-trajectory-turn-head" onClick={() => toggleTurn(tid(t))}>
                <span class="mafw-trajectory-turn-user">{(t.userText ?? t.user_text) || `回合 ${tid(t)}`}</span>
                <Show when={t.assistantText ?? t.assistant_text}>
                  <span class="mafw-trajectory-turn-assistant">{t.assistantText ?? t.assistant_text}</span>
                </Show>
                <span class="mafw-trajectory-turn-kpis">
                  <span>⚙ {(t.toolCount ?? t.tool_count ?? 0)}</span>
                  <span>⏱ {fmtDur(t.durationMs ?? t.duration_ms)}</span>
                  <span>📝 {fmtTokens((t.tokens?.input || 0) + (t.tokens?.output || 0))} tok</span>
                  <span>💰 {fmtCost(t.cost || 0)}</span>
                </span>
                <Show when={t.finish === "tool-calls" || t.finish === "length"}>
                  <span class="mafw-trajectory-finish-badge">{t.finish}</span>
                </Show>
              </button>
              <Show when={expanded[tid(t)]}>
                <div class="mafw-trajectory-events">
                  <For each={eventsForTurn(tid(t))}>
                    {(e) => (
                      <div class={`mafw-trajectory-event mafw-trajectory-${e.eventType ?? e.event_type}${e.toolState === "error" ? " mafw-trajectory-error" : ""}`}>
                        <span class="mafw-trajectory-event-icon">
                          {e.eventType === "tool_start" && "⟳"}
                          {e.eventType === "tool_end" && (e.toolState === "error" ? "✗" : "✓")}
                          {(e.eventType === "reasoning_start" || e.eventType === "reasoning_end") && "🧠"}
                          {e.eventType === "model_switch" && "⇄"}
                          {e.eventType === "agent_switch" && "⇄"}
                          {e.eventType === "step_finish" && "∑"}
                          {e.eventType === "turn_start" && "▶"}
                          {e.eventType === "turn_end" && "■"}
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
                              <Show when={e.cost !== undefined}>{" · "}{fmtCost(e.cost || 0)}</Show>
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
