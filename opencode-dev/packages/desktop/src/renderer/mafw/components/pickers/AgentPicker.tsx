// @ts-nocheck
import { createSignal, createEffect, Show, For } from "solid-js"
import { PopoverShell } from "./PopoverShell"

export type AgentEntry = {
  name: string
  description?: string
  mode?: string
  color?: string
  isManager?: boolean
}

const TINTS = ["var(--accent)", "#7698fd", "#e8b84b", "#a855f7"]

export function AgentPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  mode: "switch" | "mention"
  anchor: "tr" | "bl"
  manager: AgentEntry | null
  agents: AgentEntry[]
  subagents: { id: string; title: string }[]
  isRunning: (sessionID: string) => boolean
  currentName?: string
  onSelect: (a: AgentEntry) => void
  onSubagentClick: (s: { id: string; title: string }) => void
  onClose: () => void
}) {
  const [hi, setHi] = createSignal(0)

  const rows = () => {
    const list: ({ kind: "agent"; agent: AgentEntry } | { kind: "sub"; s: { id: string; title: string } })[] = []
    if (props.manager) list.push({ kind: "agent", agent: props.manager })
    for (const a of props.agents) list.push({ kind: "agent", agent: a })
    for (const s of props.subagents) list.push({ kind: "sub", s })
    return list
  }

  createEffect(() => {
    if (props.open) setHi(0)
  })

  const tintOf = (name: string): string => {
    let h = 0
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return TINTS[h % TINTS.length]
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, rows().length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      const r = rows()[hi()]
      if (!r) return
      if (r.kind === "agent") props.onSelect(r.agent)
      else props.onSubagentClick(r.s)
    }
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor={props.anchor} onClose={props.onClose}>
      <div class="mafw-picker-title">{props.mode === "switch" ? "切换 Agent" : "引用 Agent"}</div>
      <div class="mafw-picker-list">
        <For each={rows()}>
          {(r, i) => (
            <div
              class="mafw-agent-row"
              classList={{
                hi: hi() === i(),
                current: r.kind === "agent" && props.mode === "switch" && r.agent.name === props.currentName,
                readonly: r.kind === "sub",
              }}
              onClick={() => {
                if (r.kind === "agent") props.onSelect(r.agent)
                else props.onSubagentClick(r.s)
              }}
            >
              <span class="mafw-agent-avatar" style={{ background: r.kind === "agent" ? tintOf(r.agent.name) : "var(--bg-overlay)", color: r.kind === "agent" ? "var(--on-accent)" : "var(--text-3)" }}>
                {(r.kind === "agent" ? r.agent.name : r.s.title).charAt(0).toUpperCase()}
              </span>
              <span class="mafw-agent-row-body">
                <span class="mafw-agent-row-top">
                  <span class="mafw-agent-row-name">{r.kind === "agent" ? r.agent.name : r.s.title}</span>
                  <Show when={r.kind === "sub"}>
                    <span class={`mafw-agent-row-status ${props.isRunning(r.s.id) ? "running" : ""}`}>
                      <span class="mafw-agent-row-dot" classList={{ running: props.isRunning(r.s.id) }} />
                      {props.isRunning(r.s.id) ? "运行中" : "空闲"}
                    </span>
                  </Show>
                  <Show when={r.kind === "agent" && props.mode === "switch" && r.agent.name === props.currentName}>
                    <span class="mafw-picker-row-check">✓</span>
                  </Show>
                </span>
                <Show when={r.kind === "agent" && r.agent.description}>
                  <span class="mafw-agent-row-role">{r.agent.description}</span>
                </Show>
              </span>
            </div>
          )}
        </For>
        <Show when={rows().length === 0}>
          <div class="mafw-picker-empty">仅 Manager 可用</div>
        </Show>
      </div>
      <div class="mafw-picker-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </PopoverShell>
  )
}
