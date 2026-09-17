import { app, dialog, Menu, Tray, nativeImage } from "electron"
import { createMainWindow, getLastFocusedWindow, trayIconImagePath } from "./windows"
import {
  hasCloseToTrayWarningShown,
  isCloseToTrayEnabled,
  isTrayIconEnabled,
  markCloseToTrayWarningShown,
  setCloseToTray,
} from "./tray-prefs"
import { trayClickAction } from "./tray-toggle"
import { trayMenuStatusLabel, trayTooltip } from "./tray-status"
import { write as writeLog } from "./logging"

let tray: Tray | null = null
let pendingCount = 0

function showOrCreateWindow(): void {
  const win = getLastFocusedWindow()
  if (win && !win.isDestroyed()) {
    win.show()
    win.focus()
    return
  }
  // Dead-end guard: no window to show (e.g. all destroyed) — create one
  // instead of leaving the tray entry point unresponsive.
  createMainWindow()
}

function handleTrayClick(): void {
  const win = getLastFocusedWindow()
  const action = trayClickAction(win && !win.isDestroyed() ? { visible: win.isVisible(), focused: win.isFocused() } : null)
  if (action === "hide") {
    win!.hide()
    return
  }
  showOrCreateWindow()
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: trayMenuStatusLabel(pendingCount), enabled: false },
    { label: "Open MAFW", click: showOrCreateWindow },
    { type: "separator" },
    {
      label: "Close to tray",
      type: "checkbox",
      checked: isCloseToTrayEnabled(),
      click: (item) => {
        setCloseToTray(item.checked)
        if (!item.checked) void warnCloseToTrayOffOnce()
      },
    },
    { type: "separator" },
    { label: "Quit MAFW", click: () => app.quit() },
  ])
}

// Disabling close-to-tray turns the last window's close button into a real
// quit — which also stops a bundled gateway. Say so once (P0 silent-kill fix).
async function warnCloseToTrayOffOnce(): Promise<void> {
  if (hasCloseToTrayWarningShown()) return
  markCloseToTrayWarningShown()
  try {
    await dialog.showMessageBox({
      type: "info",
      title: "Close to tray disabled",
      message: "Closing the last window will now quit MAFW Desktop.",
      detail:
        "If the MAFW Gateway is bundled with this app, quitting also stops the gateway and any running agent work. " +
        'Re-enable "Close to tray" from the tray menu or Settings → Desktop to keep the app running in the background.',
      buttons: ["OK"],
    })
  } catch {
    // fail-open
  }
}

function applyStatus(): void {
  if (!tray) return
  tray.setToolTip(trayTooltip(pendingCount))
  // Rebuild the whole menu: Linux requires setContextMenu() for any menu
  // change to take effect (Electron docs), so we never mutate items in place.
  tray.setContextMenu(buildMenu())
}

export function createTray(): Tray | null {
  if (tray) return tray
  if (!isTrayIconEnabled()) return null
  try {
    const icon = nativeImage.createFromPath(trayIconImagePath())
    if (icon.isEmpty()) {
      writeLog("utility", "tray icon missing, skipping tray", { path: trayIconImagePath() }, "warn")
      return null
    }
    // No GUID: with an unsigned executable the GUID binds to the exe path,
    // and a changed path breaks tray creation entirely (Electron docs) —
    // position persistence is not worth that risk.
    tray = new Tray(icon)
    applyStatus()
    // macOS pops the context menu on click when one is set; registering our
    // own click handler there would fire both behaviors at once. Windows and
    // Linux get the industry-standard toggle (click = show/hide).
    if (process.platform !== "darwin") {
      tray.on("click", handleTrayClick)
      // Double-click = the menu's default command (Open), so a double-click
      // on a hidden window can't end in the toggled-off state.
      tray.on("double-click", showOrCreateWindow)
    }
    writeLog("utility", "tray created", { path: trayIconImagePath() })
    return tray
  } catch (err) {
    writeLog("utility", "tray creation failed", { err: String(err) }, "warn")
    return null
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}

// Applies the tray-icon preference live (Config page / future callers), and
// rebuilds the menu so checkbox states mirror the latest prefs.
export function syncTrayPresence(): void {
  if (!isTrayIconEnabled()) {
    destroyTray()
    return
  }
  createTray()
  applyStatus()
}

// Called by the status poller (tray-status.ts) with the pending-approval
// count; refreshes tooltip + menu status line.
export function updateTrayPending(pending: number): void {
  if (pending === pendingCount) return
  pendingCount = pending
  applyStatus()
}
