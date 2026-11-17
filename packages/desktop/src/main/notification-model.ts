import { randomUUID } from "node:crypto"
import {
  isNotificationTarget,
  type MafwNotification,
  type NotificationInput,
  type NotificationKind,
  type NotificationSeverity,
} from "../shared/notifications"

export const NOTIFICATION_LIMIT = 200
export const NOTIFICATION_SEEN_LIMIT = 1000

const KINDS = new Set<NotificationKind>(["goal_result", "attention", "permission", "question"])
const SEVERITIES = new Set<NotificationSeverity>(["p1", "p2", "p3"])

export interface NotificationState {
  items: MafwNotification[]
  /** ever-seen 墓碑：清空/淘汰/已读后同一 dedupeKey 不再复活。 */
  seenKeys: string[]
}

export function emptyNotificationState(): NotificationState {
  return { items: [], seenKeys: [] }
}

function sortItems(items: MafwNotification[]): MafwNotification[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt)
}

function capState(state: NotificationState): NotificationState {
  let items = sortItems(state.items)
  while (items.length > NOTIFICATION_LIMIT) {
    const read = items.filter((item) => item.readAt !== undefined)
    const victim = read.length
      ? read.reduce((oldest, item) => (item.createdAt < oldest.createdAt ? item : oldest))
      : items[items.length - 1]
    items = items.filter((item) => item.id !== victim.id)
  }
  return {
    items,
    seenKeys: [...new Set(state.seenKeys)].slice(-NOTIFICATION_SEEN_LIMIT),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalizeItem(value: unknown): MafwNotification | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  const severity = value.severity
  if (typeof value.id !== "string" || !value.id) return null
  if (typeof value.title !== "string") return null
  if (typeof value.reason !== "string") return null
  if (!KINDS.has(kind as NotificationKind)) return null
  if (!SEVERITIES.has(severity as NotificationSeverity)) return null
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt)) return null
  const item: MafwNotification = {
    id: value.id,
    kind: kind as NotificationKind,
    severity: severity as NotificationSeverity,
    title: value.title,
    reason: value.reason,
    createdAt: value.createdAt,
  }
  if (typeof value.body === "string") item.body = value.body
  if (typeof value.projectId === "string") item.projectId = value.projectId
  if (typeof value.readAt === "number" && Number.isFinite(value.readAt)) item.readAt = value.readAt
  if (typeof value.dedupeKey === "string") item.dedupeKey = value.dedupeKey
  if (isNotificationTarget(value.target)) item.target = value.target
  return item
}

export function normalizeNotificationState(raw: unknown): NotificationState {
  if (!isRecord(raw)) return emptyNotificationState()
  const byId = new Map<string, MafwNotification>()
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    const item = normalizeItem(entry)
    if (!item) continue
    const previous = byId.get(item.id)
    if (!previous || previous.createdAt <= item.createdAt) byId.set(item.id, item)
  }
  const seenKeys = Array.isArray(raw.seenKeys)
    ? [...new Set(raw.seenKeys.filter((key): key is string => typeof key === "string" && key.length > 0))]
    : []
  return capState({ items: [...byId.values()], seenKeys })
}

export interface PublishResult {
  state: NotificationState
  item: MafwNotification | null
  isNew: boolean
}

export function publishNotification(
  state: NotificationState,
  input: NotificationInput,
  now: number,
): PublishResult {
  const key = input.dedupeKey
  const existing = state.items.find(
    (item) => (!!key && item.dedupeKey === key) || (!!input.id && item.id === input.id),
  )
  if (!existing && key && state.seenKeys.includes(key)) {
    return { state, item: null, isNew: false }
  }

  const item: MafwNotification = {
    id: existing?.id ?? input.id ?? key ?? randomUUID(),
    kind: input.kind,
    severity: input.severity,
    title: input.title,
    reason: input.reason,
    createdAt: input.createdAt ?? now,
  }
  if (input.body !== undefined) item.body = input.body
  if (input.projectId !== undefined) item.projectId = input.projectId
  if (input.target !== undefined) item.target = input.target
  if (key !== undefined) item.dedupeKey = key
  if (existing?.readAt !== undefined) item.readAt = existing.readAt

  const items = [item, ...state.items.filter((entry) => entry.id !== item.id)]
  const seenKeys = key
    ? [...state.seenKeys.filter((entry) => entry !== key), key].slice(-NOTIFICATION_SEEN_LIMIT)
    : state.seenKeys

  return {
    state: capState({ items, seenKeys }),
    item,
    isNew: !existing,
  }
}

export function markNotificationRead(
  state: NotificationState,
  ids: string[] | "all",
  now: number,
): NotificationState {
  const selected = ids === "all" ? null : new Set(ids)
  let changed = false
  const items = state.items.map((item) => {
    if (item.readAt !== undefined) return item
    if (selected && !selected.has(item.id)) return item
    changed = true
    return { ...item, readAt: now }
  })
  return changed ? { ...state, items } : state
}

export function markNotificationReadByDedupe(
  state: NotificationState,
  keys: string[],
  now: number,
): NotificationState {
  if (keys.length === 0) return state
  const selected = new Set(keys)
  let changed = false
  const items = state.items.map((item) => {
    if (item.readAt !== undefined || !item.dedupeKey || !selected.has(item.dedupeKey)) return item
    changed = true
    return { ...item, readAt: now }
  })
  return changed ? { ...state, items } : state
}

/** Presence 给的 attention 活动集是权威：不在集合里的 attention 视为已被处理。 */
export function reconcileAttentionNotifications(
  state: NotificationState,
  activeIds: string[],
  now: number,
): NotificationState {
  const active = new Set(activeIds)
  let changed = false
  const items = state.items.map((item) => {
    if (item.kind !== "attention" || item.readAt !== undefined) return item
    const key = item.dedupeKey ?? item.id
    if (active.has(key)) return item
    changed = true
    return { ...item, readAt: now }
  })
  return changed ? { ...state, items } : state
}

export function clearReadNotifications(state: NotificationState): NotificationState {
  const items = state.items.filter((item) => item.readAt === undefined)
  return items.length === state.items.length ? state : { ...state, items }
}

export function removeNotification(state: NotificationState, id: string): NotificationState {
  const items = state.items.filter((item) => item.id !== id)
  return items.length === state.items.length ? state : { ...state, items }
}

export function unreadNotificationCount(state: NotificationState): number {
  return state.items.reduce((count, item) => (item.readAt === undefined ? count + 1 : count), 0)
}
