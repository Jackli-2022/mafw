// Ctrl+` / Cmd+` 终端开合判定（VS Code/Zed 肌肉记忆，2026-10-27）。
// capture 阶段消费：xterm 聚焦时也要先生效（否则 Ctrl+` 会以 \x00 落进 PTY）。
export type TerminalToggleKeyEvent = {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export function isTerminalToggleKey(e: TerminalToggleKeyEvent): boolean {
  if (e.shiftKey || e.altKey) return false
  if (!(e.ctrlKey || e.metaKey)) return false
  return e.key === "`" || e.code === "Backquote"
}
