// packages/desktop/src/renderer/mafw/pages/KeybindingsSection.tsx
// C3（W3）：Config「快捷键」节——列表 + 单键录制 + 冲突提示 + 恢复默认。
// 录制：点「录制」捕获下一次按键（Esc 取消）；normalizeCombo 非法组合（纯键/
// Esc/Tab）忽略；保存后即时生效（keybinding-store signal）。
import { createSignal, For, Show, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { showToastV2 } from "@mafw/ui/v2/toast-v2"
import {
  KEYBINDING_LABELS, DEFAULT_KEYBINDINGS, formatCombo, normalizeCombo, isValidCombo,
  type KeybindingAction,
} from "../keybindings"
import {
  allKeybindings, setKeybinding, resetAllKeybindings, keybindingConflicts, storedKeybindings,
} from "../keybinding-store"

export function KeybindingsSection() {
  const [recording, setRecording] = createSignal<KeybindingAction | null>(null)

  const conflictsFor = (action: KeybindingAction) =>
    keybindingConflicts().filter(c => c.actions.includes(action))
  const isCustom = (action: KeybindingAction) =>
    storedKeybindings()[action] !== undefined

  const startRecord = (action: KeybindingAction) => {
    setRecording(action)
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === "Escape") {
        window.removeEventListener("keydown", onKey, true)
        setRecording(null)
        return
      }
      const combo = normalizeCombo(e)
      if (!combo) return // 非法组合（纯键/Tab 等）继续监听
      if (!isValidCombo(combo)) return
      window.removeEventListener("keydown", onKey, true)
      setKeybinding(action, combo)
      setRecording(null)
      const clash = keybindingConflicts().filter(c => c.actions.includes(action))
      if (clash.length > 0) {
        showToastV2({
          title: "快捷键冲突",
          description: `${formatCombo(combo)} 已被 ${clash[0].actions.filter(a => a !== action).map(a => KEYBINDING_LABELS[a]).join("、")} 使用`,
          variant: "error",
          duration: 4000,
        } as any)
      } else {
        showToastV2({ description: `${KEYBINDING_LABELS[action]} → ${formatCombo(combo)}`, duration: 2000 })
      }
    }
    // capture + 一次性：捕获后自摘
    window.addEventListener("keydown", onKey, true)
    onCleanup(() => window.removeEventListener("keydown", onKey, true))
  }

  const actions = Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]

  return (
    <div class="mafw-config-section">
      <div class="mafw-config-section-header">
        <span class="mafw-config-section-icon">⌨️</span>
        <span class="mafw-config-section-title">快捷键</span>
      </div>
      <div class="mafw-config-section-body" style={{ "padding-top": "12px" }}>
        <div class="mafw-config-section-desc">
          应用级动作快捷键（composer 编辑键 Ctrl+A/E/F 等保持固定）。点「录制」后按新组合键；Esc 取消。
        </div>
        <For each={actions}>
          {(action) => {
            const combo = () => allKeybindings()[action]
            const clash = () => conflictsFor(action)
            return (
              <div class="mafw-card mafw-kb-row" style={{ "margin-bottom": "6px" }} classList={{ conflict: clash().length > 0 }}>
                <div style={{ flex: 1, "min-width": 0 }}>
                  <div class="mafw-card-title">{KEYBINDING_LABELS[action]}</div>
                  <div class="mafw-card-meta">
                    <Show when={isCustom(action)} fallback={<span>默认</span>}>
                      <span>已自定义（默认 {formatCombo(DEFAULT_KEYBINDINGS[action])}）</span>
                    </Show>
                    <Show when={clash().length > 0}>
                      <span class="mafw-kb-conflict">⚠ 冲突：{formatCombo(combo())} 与 {clash()[0].actions.filter(a => a !== action).map(a => KEYBINDING_LABELS[a]).join("、")}</span>
                    </Show>
                  </div>
                </div>
                <span class="mafw-kb-combo" classList={{ recording: recording() === action }}>
                  {recording() === action ? "按下新组合键…" : formatCombo(combo())}
                </span>
                <Show
                  when={recording() !== action}
                  fallback={<ButtonV2 variant="ghost" size="small" onClick={() => setRecording(null)}>取消</ButtonV2>}
                >
                  <ButtonV2 variant="outline" size="small" onClick={() => startRecord(action)}>录制</ButtonV2>
                </Show>
                <Show when={isCustom(action)}>
                  <ButtonV2 variant="ghost" size="small" onClick={() => setKeybinding(action, undefined)}>默认</ButtonV2>
                </Show>
              </div>
            )
          }}
        </For>
        <div style={{ display: "flex", gap: "8px", "margin-top": "10px" }}>
          <ButtonV2 variant="ghost" size="small" onClick={() => { resetAllKeybindings(); showToastV2({ description: "已恢复全部默认快捷键", duration: 2000 }) }}>
            全部恢复默认
          </ButtonV2>
        </div>
      </div>
    </div>
  )
}
