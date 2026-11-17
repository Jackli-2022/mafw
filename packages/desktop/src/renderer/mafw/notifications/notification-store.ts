import { createStore } from "solid-js/store"
import type { MafwNotification, NotificationSnapshot } from "../../../shared/notifications"

const EMPTY: NotificationSnapshot = { items: [], unread: 0 }

const [state, setState] = createStore<NotificationSnapshot>({ ...EMPTY })
let started = false
let unsubscribe: (() => void) | null = null

export const notificationState = state

function unreadOf(items: readonly MafwNotification[]): number {
  return items.reduce((count, item) => (item.readAt === undefined ? count + 1 : count), 0)
}

function apply(items: MafwNotification[]): void {
  setState("items", items)
  setState("unread", unreadOf(items))
}

export function ensureNotifications(): void {
  const api = window.api?.mafw?.notifications
  if (!api || started) return
  started = true
  void api.list().then((snapshot) => setState(snapshot)).catch(() => {})
  unsubscribe = api.onChanged((snapshot) => setState(snapshot))
}

export function refreshNotifications(): void {
  const api = window.api?.mafw?.notifications
  if (!api) return
  void api.list().then((snapshot) => setState(snapshot)).catch(() => {})
}

export function disposeNotifications(): void {
  unsubscribe?.()
  unsubscribe = null
  started = false
  setState({ ...EMPTY })
}

export async function markNotificationRead(ids: string[]): Promise<void> {
  const api = window.api?.mafw?.notifications
  if (!api || ids.length === 0) return
  const now = Date.now()
  const selected = new Set(ids)
  apply(
    state.items.map((item) =>
      selected.has(item.id) && item.readAt === undefined ? { ...item, readAt: now } : item,
    ),
  )
  try {
    await api.markRead(ids)
  } catch {
    refreshNotifications()
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const api = window.api?.mafw?.notifications
  if (!api) return
  const now = Date.now()
  apply(state.items.map((item) => (item.readAt === undefined ? { ...item, readAt: now } : item)))
  try {
    await api.markAllRead()
  } catch {
    refreshNotifications()
  }
}

export async function markNotificationsReadByDedupe(keys: string[]): Promise<void> {
  const api = window.api?.mafw?.notifications
  if (!api || keys.length === 0) return
  const now = Date.now()
  const selected = new Set(keys)
  apply(
    state.items.map((item) =>
      item.dedupeKey && selected.has(item.dedupeKey) && item.readAt === undefined
        ? { ...item, readAt: now }
        : item,
    ),
  )
  try {
    await api.markReadByDedupe(keys)
  } catch {
    refreshNotifications()
  }
}

export async function clearNotificationRead(): Promise<void> {
  const api = window.api?.mafw?.notifications
  if (!api) return
  apply(state.items.filter((item) => item.readAt === undefined))
  try {
    await api.clearRead()
  } catch {
    refreshNotifications()
  }
}

export async function removeNotification(id: string): Promise<void> {
  const api = window.api?.mafw?.notifications
  if (!api) return
  apply(state.items.filter((item) => item.id !== id))
  try {
    await api.remove(id)
  } catch {
    refreshNotifications()
  }
}
