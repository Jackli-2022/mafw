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

/**
 * AgentPicker — two modes with different selectable sets:
 *  - switch  (agent pill): only primary agents are switchable (the `manager`
 *    agent ships with the gateway install, so it appears as a primary agent);
 *    subagents (running children) are shown read-only.
 *  - mention (@ button): primary + subagent agents are all mentionable
 *    (assign this message to them); running children read-only.
 */
export function AgentPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  mode: "switch" | "mention"
  anchor: "tr" | "bl"
  primaryAgents: AgentEntry[]
  subagentAgents: AgentEntry[]
  subagents: { id: string; title: string }[]
  isRunning: (sessionID: string) => boolean
  lockedManager?: boolean
  currentName?: string
  onSelect: (a: AgentEntry) => void
  onSubagentClick: (s: { id: string; title: string }) => void
  onClose: () => void
}) {
  const [hi, setHi] = createSignal(0)

  const selectableRows = () => {
    if (props.mode === "switch" && props.lockedManager) {
      // Manager sessions can only use the manager agent.
      return props.primaryAgents.filter(a => a.name === "manager")
    }
    if (props.mode === "switch") return props.primaryAgents
    return [...props.primaryAgents, ...props.subagentAgents]
  }

  const readonlyRows = () => props.subagents

  createEffect(() => {
    if (props.open) setHi(0)
  })

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, selectableRows().length - 1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === "Enter") {
      e.preventDefault()
      const a = selectableRows()[hi()]
      if (a) props.onSelect(a)
    }
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor={props.anchor} onClose={props.onClose}>
      <div class="mafw-picker-title">{props.mode === "switch" ? "切换 Agent" : "引用 Agent"}</div>
      <div class="mafw-picker-list">
        <Show when={selectableRows().length > 0}>
          <div class="mafw-picker-group-label">{props.mode === "switch" ? "可用主 Agent" : "可用 Agent"}</div>
          <For each={selectableRows()}>
            {(a, i) => (
              <div
                class="mafw-agent-row"
                classList={{ hi: hi() === i(), current: props.mode === "switch" && a.name === props.currentName }}
                onClick={() => props.onSelect(a)}
              >
                <span class="mafw-agent-avatar" style={{ background: tintOf(a.name), color: "var(--on-accent)" }}>
                  {a.name.charAt(0).toUpperCase()}
                </span>
                <span class="mafw-agent-row-body">
                  <span class="mafw-agent-row-top">
                    <span class="mafw-agent-row-name">{a.name}</span>
                  </span>
                  <Show when={a.description}>
                    <span class="mafw-agent-row-role">{a.description}</span>
                  </Show>
                </span>
                <Show when={props.mode === "switch" && a.name === props.currentName}>
                  <span class="mafw-picker-row-check">✓</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
        <Show when={props.mode === "switch" && props.lockedManager}>
          <div class="mafw-picker-lock-hint">Manager 会话仅使用 manager agent</div>
        </Show>
        <Show when={readonlyRows().length > 0}>
          <div class="mafw-picker-group-label">子代理（本次运行）</div>
          <For each={readonlyRows()}>
            {(s) => (
              <div
                class="mafw-agent-row readonly"
                onClick={() => props.onSubagentClick(s)}
              >
                <span class="mafw-agent-avatar" style={{ background: "var(--bg-overlay)", color: "var(--text-3)" }}>
                  {s.title.charAt(0).toUpperCase()}
                </span>
                <span class="mafw-agent-row-body">
                  <span class="mafw-agent-row-top">
                    <span class="mafw-agent-row-name">{s.title}</span>
                    <span class={`mafw-agent-row-status ${props.isRunning(s.id) ? "running" : ""}`}>
                      <span class="mafw-agent-row-dot" classList={{ running: props.isRunning(s.id) }} />
                      {props.isRunning(s.id) ? "运行中" : "空闲"}
                    </span>
                  </span>
                </span>
              </div>
            )}
          </For>
        </Show>
        <Show when={selectableRows().length === 0 && readonlyRows().length === 0}>
          <div class="mafw-picker-empty">{props.mode === "switch" ? "仅 Manager 可用" : "无可引用 Agent"}</div>
        </Show>
      </div>
      <div class="mafw-picker-hint">↑↓ 选择 · Enter 确认 · Esc 关闭</div>
    </PopoverShell>
  )
}

function tintOf(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}
