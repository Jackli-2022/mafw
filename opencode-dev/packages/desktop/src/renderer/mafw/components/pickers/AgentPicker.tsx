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
 *  - switch  (agent pill): only Manager + primary agents are switchable;
 *    subagents (running children) are shown read-only.
 *  - mention (@ button): Manager + primary + subagent agents are all
 *    mentionable (assign this message to them); running children read-only.
 */
export function AgentPicker(props: {
  open: boolean
  trigger: HTMLElement | null
  mode: "switch" | "mention"
  anchor: "tr" | "bl"
  manager: AgentEntry | null
  primaryAgents: AgentEntry[]
  subagentAgents: AgentEntry[]
  subagents: { id: string; title: string }[]
  isRunning: (sessionID: string) => boolean
  currentName?: string
  onSelect: (a: AgentEntry) => void
  onSubagentClick: (s: { id: string; title: string }) => void
  onClose: () => void
}) {
  const [hi, setHi] = createSignal(0)

  // Selectable rows only (read-only subagent instances are not in the list).
  const selectableRows = () => {
    const list: AgentEntry[] = []
    if (props.manager) list.push(props.manager)
    if (props.mode === "switch") {
      list.push(...props.primaryAgents)
    } else {
      list.push(...props.primaryAgents, ...props.subagentAgents)
    }
    return list
  }

  const readonlyRows = () => props.subagents

  const allRowCount = () => selectableRows().length + readonlyRows().length

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

  const selectableGroupLabel = () => {
    if (props.mode === "switch") return props.manager ? "可用主 Agent" : "可用 Agent"
    return "可用 Agent"
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor={props.anchor} onClose={props.onClose}>
      <div class="mafw-picker-title">{props.mode === "switch" ? "切换 Agent" : "引用 Agent"}</div>
      <div class="mafw-picker-list">
        <Show when={props.manager}>
          <div class="mafw-picker-group-label">当前会话</div>
          <For each={[props.manager!]}>
            {(a, i) => (
              <AgentRow
                a={a}
                hi={hi() === i()}
                current={props.mode === "switch" && a.name === props.currentName}
                onClick={() => props.onSelect(a)}
              />
            )}
          </For>
        </Show>
        <Show when={selectableRows().length > (props.manager ? 1 : 0)}>
          <div class="mafw-picker-group-label">{selectableGroupLabel()}</div>
          <For each={props.mode === "switch" ? props.primaryAgents : [...props.primaryAgents, ...props.subagentAgents]}>
            {(a, i) => (
              <AgentRow
                a={a}
                hi={hi() === (props.manager ? 1 : 0) + i()}
                current={props.mode === "switch" && a.name === props.currentName}
                onClick={() => props.onSelect(a)}
              />
            )}
          </For>
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

function AgentRow(props: { a: AgentEntry; hi: boolean; current: boolean; onClick: () => void }) {
  return (
    <div
      class="mafw-agent-row"
      classList={{ hi: props.hi, current: props.current }}
      onClick={props.onClick}
    >
      <span class="mafw-agent-avatar" style={{ background: tintOf(props.a.name), color: "var(--on-accent)" }}>
        {props.a.name.charAt(0).toUpperCase()}
      </span>
      <span class="mafw-agent-row-body">
        <span class="mafw-agent-row-top">
          <span class="mafw-agent-row-name">{props.a.name}</span>
          <Show when={props.a.isManager && props.current}>
            <span class="mafw-picker-row-check">✓</span>
          </Show>
        </span>
        <Show when={props.a.description}>
          <span class="mafw-agent-row-role">{props.a.description}</span>
        </Show>
      </span>
      <Show when={props.current}>
        <span class="mafw-picker-row-check">✓</span>
      </Show>
    </div>
  )
}

function tintOf(name: string): string {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}
