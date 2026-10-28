// packages/desktop/src/renderer/mafw/keybinding-store.ts
// C3 快捷键存储（W3）：localStorage 持久化（与 dock detent/输入历史同先例）+
// Solid signal 失效。多窗口同步 caveat：各窗口独立读，保存后新窗口可见，
// 已开窗口需重开 Config 才刷新（roadmap 原定 ~/.mafw 路径的裁决见 ledger）。
import { createSignal } from "solid-js"
import { KeybindingAction, resolveKeybindings, findConflicts } from "./keybindings"

export interface KbStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

const STORE_KEY = "mafw-keybindings:v1"

let storage: KbStorage | null =
  (globalThis as any).localStorage
  ?? ((globalThis as any).window?.localStorage ?? null)

let stored: Partial<Record<KeybindingAction, string>> = {}
const [rev, setRev] = createSignal(0)

function persist(): void {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(stored))
  } catch { /* fail-open */ }
}

function hydrate(): void {
  try {
    const raw = storage?.getItem(STORE_KEY)
    stored = raw ? (JSON.parse(raw) ?? {}) : {}
  } catch { stored = {} }
}
hydrate()

/** 测试注入（node 无 localStorage）。 */
export function attachKbStorageForTest(s: KbStorage): void {
  storage = s
  hydrate()
  setRev((v) => v + 1)
}

/** 当前生效组合键（默认 + 存储覆盖）。 */
export function keybindingFor(action: KeybindingAction): string {
  void rev()
  return resolveKeybindings(stored)[action]
}

export function allKeybindings(): Record<KeybindingAction, string> {
  void rev()
  return resolveKeybindings(stored)
}

export function storedKeybindings(): Partial<Record<KeybindingAction, string>> {
  void rev()
  return { ...stored }
}

/** combo=undefined 恢复该动作默认键。 */
export function setKeybinding(action: KeybindingAction, combo: string | undefined): void {
  if (combo === undefined) delete stored[action]
  else stored[action] = combo
  persist()
  setRev((v) => v + 1)
}

export function resetAllKeybindings(): void {
  stored = {}
  persist()
  setRev((v) => v + 1)
}

export function keybindingConflicts(): Array<{ combo: string; actions: KeybindingAction[] }> {
  return findConflicts(allKeybindings())
}
