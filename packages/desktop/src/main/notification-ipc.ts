import {
  isNotificationTarget,
  type NotificationInput,
  type NotificationKind,
  type NotificationPrefs,
  type NotificationSeverity,
  type NotificationSnapshot,
} from "../shared/notifications"
import type { NotificationHub } from "./notification-hub"
import {
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefsStore,
} from "./notification-prefs"

const KINDS = new Set<NotificationKind>(["goal_result", "attention", "permission", "question"])
const SEVERITIES = new Set<NotificationSeverity>(["p1", "p2", "p3"])

export interface NotificationIpcMain {
  handle(channel: string, listener: (event: unknown, ...args: any[]) => any): void
  removeHandler(channel: string): void
}

export interface NotificationIpcDeps {
  ipcMain: NotificationIpcMain
  hub: NotificationHub
  store: NotificationPrefsStore
  broadcast: (snapshot: NotificationSnapshot) => void
  onPrefsChanged?: (prefs: ReturnType<typeof readNotificationPrefs>) => void
  /** 主窗口上报 effective theme → 悬浮窗卡片跟应用主题。 */
  onThemeReported?: (theme: "light" | "dark") => void
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Renderer publishes are fail-closed: malformed input never reaches the hub. */
export function sanitizeNotificationInput(value: unknown): NotificationInput | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  if (!KINDS.has(raw.kind as NotificationKind)) return null
  if (!SEVERITIES.has(raw.severity as NotificationSeverity)) return null
  const title = asString(raw.title)
  const reason = asString(raw.reason)
  if (!title || !reason) return null

  const input: NotificationInput = {
    kind: raw.kind as NotificationKind,
    severity: raw.severity as NotificationSeverity,
    title,
    reason,
  }
  const body = asString(raw.body)
  const projectId = asString(raw.projectId)
  const dedupeKey = asString(raw.dedupeKey)
  if (body) input.body = body
  if (projectId) input.projectId = projectId
  if (dedupeKey) input.dedupeKey = dedupeKey
  if (isNotificationTarget(raw.target)) input.target = raw.target
  return input
}

export function registerNotificationIpc(deps: NotificationIpcDeps): () => void {
  const { ipcMain, hub, store } = deps
  const channels: string[] = []

  const handle = (channel: string, listener: (event: unknown, ...args: any[]) => any) => {
    channels.push(channel)
    ipcMain.handle(channel, listener)
  }

  handle("mafw-notifications:list", () => hub.snapshot())
  handle("mafw-notifications:markRead", (_event, ids: unknown) => {
    if (ids === "all") hub.markRead("all")
    else if (Array.isArray(ids)) hub.markRead(ids.filter((id): id is string => typeof id === "string"))
  })
  handle("mafw-notifications:markAllRead", () => hub.markRead("all"))
  handle("mafw-notifications:markReadByDedupe", (_event, keys: unknown) => {
    if (Array.isArray(keys)) hub.markReadByDedupe(keys.filter((key): key is string => typeof key === "string"))
  })
  handle("mafw-notifications:clearRead", () => hub.clearRead())
  handle("mafw-notifications:remove", (_event, id: unknown) => {
    if (typeof id === "string" && id) hub.remove(id)
  })
  handle("mafw-notifications:publish", (_event, input: unknown) => {
    const sanitized = sanitizeNotificationInput(input)
    return sanitized ? hub.publish(sanitized) : null
  })
  handle("get-notification-prefs", () => readNotificationPrefs(store))
  handle("set-notification-prefs", (_event, patch: unknown) => {
    const prefs = writeNotificationPrefs(store, (patch ?? {}) as Partial<NotificationPrefs>)
    deps.onPrefsChanged?.(prefs)
    return prefs
  })
  handle("mafw-notifications:theme", (_event, theme: unknown) => {
    if (theme === "light" || theme === "dark") deps.onThemeReported?.(theme)
  })

  const offChange = hub.onChange(deps.broadcast)
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
    offChange()
  }
}
