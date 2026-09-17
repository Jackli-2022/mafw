import { getStore } from "./store"

const CLOSE_TO_TRAY_KEY = "closeToTray"
const TRAY_ICON_ENABLED_KEY = "trayIconEnabled"
const TRAY_HINT_SHOWN_KEY = "trayHintShown"
const CLOSE_TO_TRAY_WARNING_SHOWN_KEY = "closeToTrayWarningShown"

export function isCloseToTrayEnabled(): boolean {
  return getStore().get(CLOSE_TO_TRAY_KEY, true) as boolean
}

export function setCloseToTray(enabled: boolean): void {
  getStore().set(CLOSE_TO_TRAY_KEY, enabled)
}

// Whether the tray icon exists at all. When disabled, close-to-tray is
// inert (no icon to come back from), so closing a window closes for real.
export function isTrayIconEnabled(): boolean {
  return getStore().get(TRAY_ICON_ENABLED_KEY, true) as boolean
}

export function setTrayIconEnabled(enabled: boolean): void {
  getStore().set(TRAY_ICON_ENABLED_KEY, enabled)
}

// One-time "still running in the tray" hint, shown on the first hide-to-tray.
export function hasTrayHintShown(): boolean {
  return getStore().get(TRAY_HINT_SHOWN_KEY, false) as boolean
}

export function markTrayHintShown(): void {
  getStore().set(TRAY_HINT_SHOWN_KEY, true)
}

// One-time warning that disabling close-to-tray makes the last window's close
// button quit the app (and stop a bundled gateway with it).
export function hasCloseToTrayWarningShown(): boolean {
  return getStore().get(CLOSE_TO_TRAY_WARNING_SHOWN_KEY, false) as boolean
}

export function markCloseToTrayWarningShown(): void {
  getStore().set(CLOSE_TO_TRAY_WARNING_SHOWN_KEY, true)
}
