// packages/desktop/src/renderer/mafw/keybindings.ts
// C3 自定义快捷键（W3）：纯模块——事件→组合键规范化、默认表、存储合并、冲突检测。
// 存储由 keybinding-store 负责（localStorage，与 dock detent/输入历史同先例）。

export type KeybindingAction =
  | "toggle-terminal"    // Ctrl+`（capture 阶段，terminal-hotkey）
  | "command-palette"    // Ctrl+P
  | "toggle-leftdock"    // Ctrl+B
  | "toggle-rightdock"   // Ctrl+Alt+B
  | "open-search"        // Ctrl+K
  | "toggle-details"     // Ctrl+O（ChatPane）
  | "session-search"     // Ctrl+F（ChatPane）
  | "taskbar"            // Ctrl+J
  // Ctrl+Shift+E（EventInspector）是开发工具，保持硬编码不进用户配置面。

export const KEYBINDING_LABELS: Record<KeybindingAction, string> = {
  "toggle-terminal": "终端开合",
  "command-palette": "命令面板",
  "toggle-leftdock": "左侧栏开合",
  "toggle-rightdock": "右侧面板开合",
  "open-search": "全局搜索",
  "toggle-details": "展开全部细节",
  "session-search": "会话内搜索",
  taskbar: "任务列表",
}

export const DEFAULT_KEYBINDINGS: Record<KeybindingAction, string> = {
  "toggle-terminal": "ctrl+`",
  "command-palette": "ctrl+p",
  "toggle-leftdock": "ctrl+b",
  "toggle-rightdock": "ctrl+alt+b",
  "open-search": "ctrl+k",
  "toggle-details": "ctrl+o",
  "session-search": "ctrl+f",
  taskbar: "ctrl+j",
}

export interface ComboEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/** 不适合做快捷键的键（录入框冲突/无意义）。 */
const EXCLUDED_KEYS = new Set(["Escape", "Enter", "Tab", " ", "Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Backspace", "Delete", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])

const KEY_RE = /^([a-z0-9`]|[fF]\d{1,2})$/

/** 事件 → 规范组合键（"ctrl+alt+shift+<key>"，修饰键排序固定；无 ctrl/meta 或键不可绑定 → null）。 */
export function normalizeCombo(e: ComboEvent): string | null {
  const ctrl = !!(e.ctrlKey || e.metaKey)
  if (!ctrl) return null
  if (EXCLUDED_KEYS.has(e.key)) return null
  let key = e.key.toLowerCase()
  if (e.key.startsWith("F") && /^\d+$/.test(e.key.slice(1))) key = e.key.toLowerCase() // f1..f12
  if (!KEY_RE.test(key)) return null
  const mods: string[] = ["ctrl"]
  if (e.altKey) mods.push("alt")
  if (e.shiftKey) mods.push("shift")
  return [...mods, key].join("+")
}

export function matchesCombo(e: ComboEvent, combo: string | undefined | null): boolean {
  if (!combo) return false
  return normalizeCombo(e) === combo
}

export function isValidCombo(combo: unknown): combo is string {
  if (typeof combo !== "string" || !combo) return false
  const parts = combo.split("+")
  if (parts.length < 2) return false
  if (parts[0] !== "ctrl") return false
  const mods = parts.slice(0, -1)
  const key = parts[parts.length - 1]
  if (!KEY_RE.test(key)) return false
  // 修饰键顺序固定：ctrl → alt → shift
  if (mods.join("+") !== [...mods].sort((a, b) => (a === "ctrl" ? -1 : b === "ctrl" ? 1 : a === "alt" ? -1 : 1)).join("+")) return false
  return true
}

/** 默认表 + 存储覆盖（非法条目丢弃回落默认）。 */
export function resolveKeybindings(stored: Partial<Record<KeybindingAction, string>> | undefined | null): Record<KeybindingAction, string> {
  const out = { ...DEFAULT_KEYBINDINGS }
  if (!stored) return out
  for (const k of Object.keys(DEFAULT_KEYBINDINGS) as KeybindingAction[]) {
    const v = (stored as any)[k]
    if (typeof v === "string" && isValidCombo(v)) out[k] = v
  }
  return out
}

/** 冲突检测：同组合键被多个动作占用。 */
export function findConflicts(bindings: Record<KeybindingAction, string>): Array<{ combo: string; actions: KeybindingAction[] }> {
  const byCombo = new Map<string, KeybindingAction[]>()
  for (const [action, combo] of Object.entries(bindings) as Array<[KeybindingAction, string]>) {
    byCombo.set(combo, [...(byCombo.get(combo) ?? []), action])
  }
  return [...byCombo.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([combo, actions]) => ({ combo, actions: actions.sort() }))
}

/** 显示格式：ctrl+alt+b → Ctrl+Alt+B。 */
export function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((p) => (p === "ctrl" || p === "alt" || p === "shift" ? p[0].toUpperCase() + p.slice(1) : p.length === 1 ? p.toUpperCase() : p.toUpperCase()))
    .join("+")
}
