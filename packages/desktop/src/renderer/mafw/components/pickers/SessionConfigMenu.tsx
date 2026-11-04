// 会话配置菜单（发送旁 pill 的 popover）：Agent / 模型 / Thinking 三行一个域。
// 组件只做布局与交互；徽标派生在 session-config-menu-model.ts（单测覆盖）。
import { createEffect, createSignal, For, Show } from "solid-js"
import type { ThinkingLevel } from "@mafw/sdk"
import { PopoverShell } from "./PopoverShell"
import { THINKING_MENU_OPTIONS } from "../../session-config-menu-model"

export interface SessionConfigMenuProps {
  open: boolean
  trigger: HTMLElement | null
  /** 解析后的 agent（build/plan/lead/mafw-create；null = 默认）。 */
  agentName: string | null
  /** Lead 会话锁定（Agent 行只读展示）。 */
  agentLocked: boolean
  /** 默认/plan/build（plan 不可用时由调用方剔除）。 */
  agentOptions: Array<{ id: string; label: string }>
  /** 当前模型显示名（会话 pill 的默认标签）。 */
  modelLabel: string
  thinkingLevel: ThinkingLevel | null
  thinkingSupported: boolean
  onAgentSelect: (id: "default" | "plan" | "build") => void
  onOpenModelPicker: () => void
  onThinkingSelect: (level: ThinkingLevel | null) => void
  onClose: () => void
}

export function SessionConfigMenu(props: SessionConfigMenuProps) {
  const [expand, setExpand] = createSignal<"agent" | "thinking" | null>(null)
  createEffect(() => {
    if (props.open) setExpand(null)
  })

  const currentAgent = () => {
    const name = (props.agentName ?? "").trim()
    const key = name.toLowerCase()
    if (!key || key === "build") return "default"
    if (key === "plan") return "plan"
    return key
  }
  const agentValue = () => {
    if (props.agentLocked) return props.agentName ?? "lead"
    return props.agentName ?? "默认"
  }
  const thinkingValue = () => (props.thinkingSupported ? (props.thinkingLevel ?? "默认") : "—")

  const rowKey = (e: KeyboardEvent, run: () => void) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      run()
    }
  }

  return (
    <PopoverShell open={props.open} trigger={props.trigger} anchor="tr" onClose={props.onClose} class="mafw-config-menu" width={260}>
      <div class="mafw-config-rows" role="menu" aria-label="会话配置">
        <div
          class="mafw-picker-row mafw-config-row"
          role="menuitem"
          tabindex="0"
          aria-expanded={expand() === "agent"}
          aria-disabled={props.agentLocked}
          onClick={() => { if (!props.agentLocked) setExpand(expand() === "agent" ? null : "agent") }}
          onKeyDown={(e) => rowKey(e, () => { if (!props.agentLocked) setExpand(expand() === "agent" ? null : "agent") })}
        >
          <span class="mafw-picker-row-name">Agent</span>
          <span class="mafw-picker-row-meta">{agentValue()}{props.agentLocked ? " · 锁定" : ""}</span>
        </div>
        <Show when={expand() === "agent" && !props.agentLocked}>
          <For each={props.agentOptions}>
            {(opt) => (
              <div
                class="mafw-picker-row mafw-config-subrow"
                role="menuitemradio"
                tabindex="0"
                aria-checked={currentAgent() === opt.id}
                onClick={() => { props.onAgentSelect(opt.id as "default" | "plan" | "build"); setExpand(null) }}
                onKeyDown={(e) => rowKey(e, () => { props.onAgentSelect(opt.id as "default" | "plan" | "build"); setExpand(null) })}
              >
                <span class="mafw-picker-row-name">{opt.label}</span>
                <Show when={currentAgent() === opt.id}><span class="mafw-picker-row-check">✓</span></Show>
              </div>
            )}
          </For>
        </Show>

        <div
          class="mafw-picker-row mafw-config-row"
          role="menuitem"
          tabindex="0"
          onClick={() => props.onOpenModelPicker()}
          onKeyDown={(e) => rowKey(e, () => props.onOpenModelPicker())}
        >
          <span class="mafw-picker-row-name">模型</span>
          <span class="mafw-picker-row-meta">{props.modelLabel}</span>
        </div>

        <div
          class="mafw-picker-row mafw-config-row"
          role="menuitem"
          tabindex="0"
          aria-expanded={expand() === "thinking"}
          aria-disabled={!props.thinkingSupported}
          onClick={() => { if (props.thinkingSupported) setExpand(expand() === "thinking" ? null : "thinking") }}
          onKeyDown={(e) => rowKey(e, () => { if (props.thinkingSupported) setExpand(expand() === "thinking" ? null : "thinking") })}
        >
          <span class="mafw-picker-row-name">Thinking</span>
          <span class="mafw-picker-row-meta">{thinkingValue()}</span>
        </div>
        <Show when={expand() === "thinking" && props.thinkingSupported}>
          <For each={THINKING_MENU_OPTIONS}>
            {(opt) => (
              <div
                class="mafw-picker-row mafw-config-subrow"
                role="menuitemradio"
                tabindex="0"
                aria-checked={props.thinkingLevel === opt.id}
                onClick={() => { props.onThinkingSelect(opt.id); setExpand(null) }}
                onKeyDown={(e) => rowKey(e, () => { props.onThinkingSelect(opt.id); setExpand(null) })}
              >
                <span class="mafw-picker-row-name">{opt.label}</span>
                <Show when={props.thinkingLevel === opt.id}><span class="mafw-picker-row-check">✓</span></Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="mafw-picker-hint">Esc 关闭 · 模型行打开完整列表</div>
    </PopoverShell>
  )
}
