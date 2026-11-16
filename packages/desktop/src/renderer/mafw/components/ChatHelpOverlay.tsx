import { For, Show, createMemo, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import type { CommandItem } from "./pickers/CommandPicker"
import { KEYBINDING_LABELS, formatCombo, type KeybindingAction } from "../keybindings"
import { allKeybindings } from "../keybinding-store"

export function ChatHelpOverlay(props: { open: boolean; commands: CommandItem[]; onClose: () => void }) {
  const bindingRows = createMemo(() => {
    const bindings = allKeybindings()
    return (Object.keys(KEYBINDING_LABELS) as KeybindingAction[]).map(action => ({
      action,
      label: KEYBINDING_LABELS[action],
      combo: formatCombo(bindings[action]),
    }))
  })

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!props.open) return
      if (e.key === "Escape") {
        e.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  })

  return (
    <Portal>
      <Show when={props.open}>
        <div class="mafw-help-backdrop" onClick={e => { if (e.target === e.currentTarget) props.onClose() }}>
          <div class="mafw-help" role="dialog" aria-modal="true" aria-label="Chat 帮助">
            <div class="mafw-help-header">
              <div>
                <div class="mafw-help-title">Chat 帮助</div>
                <div class="mafw-help-subtitle">命令与快捷键</div>
              </div>
              <ButtonV2 variant="ghost" size="small" onClick={props.onClose}>关闭</ButtonV2>
            </div>
            <div class="mafw-help-body">
              <section class="mafw-help-section">
                <div class="mafw-help-section-title">本地指令</div>
                <Show when={props.commands.length > 0} fallback={<div class="mafw-help-desc">暂无本地指令</div>}>
                  <For each={props.commands}>
                    {(c) => (
                      <div class="mafw-help-row">
                        <code>{c.trigger}</code>
                        <span>{c.title}</span>
                        <span class="mafw-help-desc">{c.description}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </section>
              <section class="mafw-help-section">
                <div class="mafw-help-section-title">快捷键</div>
                <For each={bindingRows()}>
                  {(row) => (
                    <div class="mafw-help-row">
                      <span>{row.label}</span>
                      <kbd>{row.combo}</kbd>
                    </div>
                  )}
                </For>
              </section>
            </div>
          </div>
        </div>
      </Show>
    </Portal>
  )
}
