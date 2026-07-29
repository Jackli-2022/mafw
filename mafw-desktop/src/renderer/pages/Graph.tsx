import { createEffect, createSignal, For } from 'solid-js'
import { useGateway } from '../gateway/provider'
import { useGatewaySSE } from '../hooks/useGatewaySSE'

const NODES = ['PLAN', 'EXECUTE', 'REVIEW', 'ARCHIVE_SUCCESS', 'ARCHIVE_FAIL', 'ARCHIVE_MAX_RETRIES'] as const
const LAYOUT: Record<string, { x: number; y: number }> = {
  PLAN: { x: 250, y: 30 },
  EXECUTE: { x: 250, y: 140 },
  REVIEW: { x: 250, y: 250 },
  ARCHIVE_SUCCESS: { x: 80, y: 380 },
  ARCHIVE_FAIL: { x: 250, y: 380 },
  ARCHIVE_MAX_RETRIES: { x: 420, y: 380 },
}
const COLORS: Record<string, string> = {
  PLAN: '#7698fd', EXECUTE: '#a855f7', REVIEW: '#e8b84b',
  ARCHIVE_SUCCESS: '#2bc94a', ARCHIVE_FAIL: '#e8636b', ARCHIVE_MAX_RETRIES: '#e8636b',
}
const EDGES = [
  { from: 'PLAN', to: 'EXECUTE', color: '#7698fd' },
  { from: 'EXECUTE', to: 'REVIEW', color: '#7698fd' },
  { from: 'REVIEW', to: 'ARCHIVE_SUCCESS', color: '#2bc94a', label: 'PASS' },
  { from: 'REVIEW', to: 'ARCHIVE_FAIL', color: '#e8636b', label: 'ERROR' },
  { from: 'REVIEW', to: 'PLAN', color: '#e8b84b', label: 'FAIL (retry)' },
  { from: 'REVIEW', to: 'ARCHIVE_MAX_RETRIES', color: '#e8636b', label: 'max' },
]

export function GraphPage() {
  const gw = useGateway()
  const sse = useGatewaySSE(gw.client().baseUrl)
  const [statuses, setStatuses] = createSignal<Record<string, string>>({})

  createEffect(() => {
    const activeId = sse.activeNodeId()
    if (!activeId) return
    const next: Record<string, string> = {}
    const idx = NODES.indexOf(activeId as any)
    for (const id of NODES) {
      const i = NODES.indexOf(id)
      next[id] = id === activeId ? 'running' : i < idx ? 'done' : 'idle'
    }
    setStatuses(next)
  })

  createEffect(() => { sse.connect() })

  return (
    <div>
      <h2 class="text-13 font-medium mb-4" style="color: var(--text-strong)">Execution Graph</h2>
      <div class="flex items-center gap-3 mb-4">
        <div class="flex items-center gap-1.5">
          <span class="status-dot" classList={{ 'bg-success': sse.connected(), 'bg-danger': !sse.connected() }} />
          <span class="text-11" style="color: var(--text-muted)">{sse.connected() ? 'SSE Connected' : 'SSE Disconnected'}</span>
        </div>
      </div>
      <div class="panel p-4">
        <svg viewBox="0 0 500 450" class="w-full h-auto" style="min-height: 380px">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 Z" fill="rgba(255,255,255,0.25)" />
            </marker>
          </defs>
          <For each={EDGES}>{edge => {
            const f = LAYOUT[edge.from], t = LAYOUT[edge.to]
            const midY = (f.y + t.y) / 2
            const d = edge.from === 'REVIEW' && edge.to === 'PLAN'
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
            const st = statuses()[id] || 'idle'
            const isRun = st === 'running'
            return (
              <g>
                {isRun && <circle cx={p.x} cy={p.y} r="34" fill={c} opacity="0.1"><animate attributeName="r" values="34;40;34" dur="2s" repeatCount="indefinite" /></circle>}
                <rect x={p.x - 40} y={p.y - 18} width="80" height="36" rx="6" fill={isRun ? `${c}18` : 'var(--bg-layer-02)'} stroke={isRun ? c : 'rgba(255,255,255,0.06)'} stroke-width={isRun ? 1.5 : 0.5} />
                <circle cx={p.x - 32} cy={p.y} r="3" fill={isRun ? c : st === 'done' ? '#2bc94a' : 'rgba(255,255,255,0.15)'} />
                <text x={p.x} y={p.y + 4} fill={isRun ? c : st === 'done' ? 'rgba(255,255,255,0.6)' : 'var(--text-muted)'} font-size="11" text-anchor="middle" font-weight="500">{id === 'ARCHIVE_SUCCESS' ? 'Success' : id === 'ARCHIVE_FAIL' ? 'Fail' : id === 'ARCHIVE_MAX_RETRIES' ? 'Max Retries' : id.charAt(0) + id.slice(1).toLowerCase()}</text>
              </g>
            )
          }}</For>
        </svg>
      </div>
      <div class="panel p-3 mt-3 space-y-1">
        <div class="text-11" style="color: var(--text-muted)">Current Phase: <span style="color: var(--text-strong)">{sse.currentPhase() || '-'}</span></div>
        <div class="text-11" style="color: var(--text-muted)">Active Node: <span style="color: var(--text-strong)">{sse.activeNodeId() || '-'}</span></div>
        <div class="text-11" style="color: var(--text-muted)">Last Event: <span style="color: var(--text-strong)">{sse.lastMessage().slice(0, 80) || '-'}</span></div>
      </div>
    </div>
  )
}
