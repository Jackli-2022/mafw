import { Notification } from "electron"
import { hasTrayHintShown, markTrayHintShown } from "./tray-prefs"

// One-time OS notification the first time a window hides to the tray, so the
// user learns the app is still running (Slack/Discord/Steam convention).
// Kept Electron-only + prefs so windows.ts can call it without importing
// tray.ts (which imports windows.ts — would be a cycle).
export function notifyHiddenToTray(iconPath: string): void {
  if (hasTrayHintShown()) return
  markTrayHintShown()
  if (!Notification.isSupported()) return
  try {
    new Notification({
      title: "MAFW Desktop",
      body: "MAFW is still running in the system tray. Click the tray icon to bring the window back.",
      icon: iconPath,
    }).show()
  } catch {
    // fail-open: the hint is best-effort
  }
}
