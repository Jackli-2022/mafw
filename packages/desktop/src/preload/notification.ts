import { contextBridge, ipcRenderer } from "electron"
import type { MafwNotification } from "../shared/notifications"

export interface FloatingNotificationPayload {
  items: MafwNotification[]
  theme: "light" | "dark"
}

contextBridge.exposeInMainWorld("notificationApi", {
  onItems: (cb: (payload: FloatingNotificationPayload) => void) => {
    const handler = (_event: unknown, payload: FloatingNotificationPayload) => cb(payload)
    ipcRenderer.on("notification:items", handler)
    return () => {
      ipcRenderer.removeListener("notification:items", handler)
    }
  },
  dismiss: (id: string) => {
    ipcRenderer.send("notification:dismiss", id)
  },
  hover: (id: string, hovering: boolean) => {
    ipcRenderer.send("notification:hover", id, hovering)
  },
  open: (id: string) => {
    ipcRenderer.send("notification:open", id)
  },
})
