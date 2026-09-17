// Decides what a single click on the tray icon should do. Pure so it stays
// testable without Electron; the tray itself lives in tray.ts.
// Industry convention (Slack/Discord/Telegram + MS notification-area guidance):
// a click must always produce a visible response, and toggles the window.
export type TrayWindowState = { visible: boolean; focused: boolean }
export type TrayClickAction = "show" | "hide" | "create"

export function trayClickAction(win: TrayWindowState | null): TrayClickAction {
  if (!win) return "create"
  if (win.visible && win.focused) return "hide"
  return "show"
}
