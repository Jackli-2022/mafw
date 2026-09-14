import { Menu, Tray, nativeImage, app } from "electron"
import { getLastFocusedWindow, trayIconPath } from "./windows"
import { isCloseToTrayEnabled, setCloseToTray } from "./tray-prefs"
import { write as writeLog } from "./logging"

let tray: Tray | null = null

export function createTray(): Tray | null {
  if (tray) return tray
  try {
    const icon = nativeImage.createFromPath(trayIconPath())
    if (icon.isEmpty()) {
      writeLog("utility", "tray icon missing, skipping tray", { path: trayIconPath() }, "warn")
      return null
    }
    tray = new Tray(icon)
    tray.setToolTip("MAFW Desktop")
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Show MAFW", click: () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } } },
      { type: "separator" },
      { label: "Close to tray", type: "checkbox", checked: isCloseToTrayEnabled(), click: (item) => setCloseToTray(item.checked) },
      { type: "separator" },
      { label: "Quit", click: () => { app.quit() } },
    ]))
    // Windows/Linux: single (left) click shows the window.
    tray.on("click", () => { const win = getLastFocusedWindow(); if (win) { win.show(); win.focus() } })
    writeLog("utility", "tray created", { path: trayIconPath() })
    return tray
  } catch (err) {
    writeLog("utility", "tray creation failed", { err: String(err) }, "warn")
    return null
  }
}
