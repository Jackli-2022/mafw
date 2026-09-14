// Decides what a window `close` event should do. Pure so it stays testable
// without Electron; the preference itself lives in tray-prefs.ts.
export type WindowCloseAction = "close" | "hide-to-tray"

export function windowCloseAction(opts: { isQuitting: boolean; closeToTray: boolean }): WindowCloseAction {
  if (opts.isQuitting) return "close"
  return opts.closeToTray ? "hide-to-tray" : "close"
}
