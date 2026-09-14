import { getStore } from "./store"

const CLOSE_TO_TRAY_KEY = "closeToTray"

export function isCloseToTrayEnabled(): boolean {
  return getStore().get(CLOSE_TO_TRAY_KEY, true) as boolean
}

export function setCloseToTray(enabled: boolean): void {
  getStore().set(CLOSE_TO_TRAY_KEY, enabled)
}
