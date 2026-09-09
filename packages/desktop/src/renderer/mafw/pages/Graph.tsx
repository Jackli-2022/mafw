// @ts-nocheck
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js"

const NODES = ["PLAN", "EXECUTE", "REVIEW", "ARCHIVE_SUCCESS", "ARCHIVE_FAIL", "ARCHIVE_MAX_RETRIES"] as const
const LAYOUT: Record<string, { x: number; y: number }> = {
  PLAN: { x: 250, y: 30 },
  EXECUTE: { x: 250, y: 140 },
  REVIEW: { x: 250, y: 250 },
  ARCHIVE_SUCCESS: { x: 80, y: 380 },
  ARCHIVE_FAIL: { x: 250, y: 380 },
  ARCHIVE_MAX_RETRIES: { x: 420, y: 380 },
}
const COLORS: Record<string, string> = {
  PLAN: "#7698fd", EXECUTE: "#a855f7", REVIEW: "#e8b84b",
  ARCHIVE_SUCCESS: "var(--accent)", ARCHIVE_FAIL: "#e8636b", ARCHIVE_MAX_RETRIES: "#e8636b",
}
const EDGES = [
  { from: "PLAN", to: "EXECUTE", color: "#7698fd" },
  { from: "EXECUTE", to: "REVIEW", color: "#7698fd" },
  { from: "REVIEW", to: "ARCHIVE_SUCCESS", color: "var(--accent)", label: "PASS" },
  { from: "REVIEW", to: "ARCHIVE_FAIL", color: "#e8636b", label: "ERROR" },
  { from: "REVIEW", to: "PLAN", color: "#e8b84b", label: "FAIL (retry)" },
  { from: "REVIEW", to: "ARCHIVE_MAX_RETRIES", color: "#e8636b", label: "max" },
]

export function GraphPage() {
  const [statuses, setStatuses] = createSignal<Record<string, string>>({})
  const [connected, setConnected] = createSignal(false)
  const [currentPhase, setCurrentPhase] = createSignal("")
  const [activeNodeId, setActiveNodeId] = createSignal("")
  const [lastMessage, setLastMessage] = createSignal("")

  onMount(async () => {
    let alive = true
    let eventUnsub: (() => void) | null = null
    onCleanup(() => {
      alive = false
      if (eventUnsub) eventUnsub()
      window.api.mafw.event.unsubscribe().catch((e: any) => console.warn("[mafw]", e))
    })
    let attempts = 0
    const maxAttempts = 10
    let subscribed = false
    while (attempts < maxAttempts && !subscribed && alive) {
      attempts++
      try {
        await window.api.mafw.event.subscribe()
        subscribed = true
        setConnected(true)
        break
      } catch (e) {
        console.warn("[mafw]", e)
        if (alive && attempts < maxAttempts) {
          await new Promise(r => setTimeout(r, 3000))
        }
      }
    }
    if (subscribed) {
      eventUnsub = window.api.mafw.event.onEvent((data: any) => {
        if (data?.phase) setCurrentPhase(data.phase)
        if (data?.nodeId) setActiveNodeId(data.nodeId)
        if (data?.type === "phaseChange" && data.nodeId) {
          const next: Record<string, string> = {}
          const activeIdx = NODES.indexOf(data.nodeId)
          for (const id of NODES) {
            const i = NODES.indexOf(id)
            next[id] = id === data.nodeId ? "running" : i < activeIdx ? "done" : "idle"
          }
          setStatuses(next)
        }
        setLastMessage(JSON.stringify(data).slice(0, 80))
      })
    }
  })

  return (
    <div>
      <h2 style={{ "font-size": 14, "font-weight": 600, "margin-bottom": 16, color: "var(--text-primary)" }}>Execution Graph</h2>
      <div style={{ display: "flex", "align-items": "center", gap: 12, "margin-bottom": 16 }}>
        <div style={{ display: "flex", "align-items": "center", gap: 6 }}>
          <span class="status-dot" classList={{ "bg-success": connected(), "bg-danger": !connected() }} />
          <span style={{ "font-size": 11 }}>{connected() ? "SSE Connected" : "SSE Disconnected"}</span>
        </div>
      </div>
      <div class="panel" style={{ padding: 16 }}>
        <svg viewBox="0 0 500 450" style={{ width: "100%", height: "auto", "min-height": 380 }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="var(--text-4)" />
            </marker>
          </defs>
          <For each={EDGES}>{edge => {
            const f = LAYOUT[edge.from], t = LAYOUT[edge.to]
            const midY = (f.y + t.y) / 2
            const d = edge.from === "REVIEW" && edge.to === "PLAN"
              ? `M ${f.x} ${f.y + 30} C ${f.x + 80} ${midY}, ${f.x + 80} ${midY}, ${t.x} ${t.y - 30}`
              : `M ${f.x} ${f.y + 30} L ${t.x} ${t.y - 30}`
            return (
              <g>
                <path d={d} fill="none" stroke={edge.color} stroke-width="1.5" opacity="0.5" marker-end="url(#arrow)" />
                {edge.label && <text x={(f.x + t.x) / 2} y={midY - 8} fill={edge.color} font-size="10" text-anchor="middle" opacity="0.7">{edge.label}</text>}
              </g>
            )
          }}</For>
          <For each={NODES}>{id => {
            const p = LAYOUT[id], c = COLORS[id]
            const st = statuses()[id] || "idle"
            const isRun = st === "running"
            return (
              <g>
                {isRun && <circle cx={p.x} cy={p.y} r="34" fill={c} opacity="0.1"><animate attributeName="r" values="34;40;34" dur="2s" repeatCount="indefinite" /></circle>}
                <rect x={p.x - 40} y={p.y - 18} width="80" height="36" rx="6" fill={isRun ? `color-mix(in srgb, ${c} 10%, transparent)` : "var(--background-hover, rgba(255,255,255,0.03))"} stroke={isRun ? c : "var(--border-base)"} stroke-width={isRun ? 1.5 : 0.5} />
                <circle cx={p.x - 32} cy={p.y} r="3" fill={isRun ? c : st === "done" ? "var(--accent)" : "var(--text-secondary)"} />
                <text x={p.x} y={p.y + 4} fill={isRun ? c : st === "done" ? "var(--text-primary)" : "var(--text-secondary)"} font-size="11" text-anchor="middle" font-weight="500">{id === "ARCHIVE_SUCCESS" ? "Success" : id === "ARCHIVE_FAIL" ? "Fail" : id === "ARCHIVE_MAX_RETRIES" ? "Max Retries" : id.charAt(0) + id.slice(1).toLowerCase()}</text>
              </g>
            )
          }}</For>
        </svg>
      </div>
      <div class="panel" style={{ padding: 10, "margin-top": 12 }}>
        <div style={{ "font-size": 11, color: "var(--text-secondary)", "margin-bottom": 4 }}>Current Phase: <span style={{ color: "var(--text-primary)" }}>{currentPhase() || "-"}</span></div>
        <div style={{ "font-size": 11, color: "var(--text-secondary)", "margin-bottom": 4 }}>Active Node: <span style={{ color: "var(--text-primary)" }}>{activeNodeId() || "-"}</span></div>
        <div style={{ "font-size": 11, color: "var(--text-secondary)" }}>Last Event: <span style={{ color: "var(--text-primary)" }}>{lastMessage() || "-"}</span></div>
      </div>
    </div>
  )
}