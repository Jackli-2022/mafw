// Decides what a window `close` event should do. Pure so it stays testable
// without Electron; the preference itself lives in tray-prefs.ts.
export type WindowCloseAction = "close" | "hide-to-tray"

export function windowCloseAction(opts: {
  isQuitting: boolean
  closeToTray: boolean
  trayAvailable: boolean
}): WindowCloseAction {
  if (opts.isQuitting) return "close"
  // Hiding requires a tray icon to come back from — without one the window
  // would become unreachable, so close for real instead.
  return opts.closeToTray && opts.trayAvailable ? "hide-to-tray" : "close"
}
