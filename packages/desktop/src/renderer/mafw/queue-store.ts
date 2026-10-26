import { createSignal } from "solid-js"
import type { QueueItem } from "@mafw/sdk"

/** Gateway session queue snapshots, keyed by sessionID. */
const [queueBySession, setQueueBySession] = createSignal<Record<string, QueueItem[]>>({})

export { queueBySession }

function sortItems(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const at = Date.parse(a.enqueuedAt)
    const bt = Date.parse(b.enqueuedAt)
    const av = Number.isFinite(at) ? at : Number.POSITIVE_INFINITY
    const bv = Number.isFinite(bt) ? bt : Number.POSITIVE_INFINITY
    return av - bv
  })
}

export function applyQueueSnapshot(
  prev: Record<string, QueueItem[]>,
  sessionID: string,
  items: QueueItem[],
): Record<string, QueueItem[]> {
  return { ...prev, [sessionID]: sortItems(items) }
}

/** queue.updated is a full snapshot per session; return null when it cannot replace. */
export function extractQueueSnapshot(
  fallbackSid: string,
  event: unknown,
): { sessionID: string; items: QueueItem[] } | null {
  const raw: any = (event as any)?.properties ?? event
  if (!raw || typeof raw !== "object") return null
  if (!Array.isArray(raw.items)) return null
  const sessionID = typeof raw.sessionID === "string" && raw.sessionID ? raw.sessionID : fallbackSid
  return { sessionID, items: raw.items as QueueItem[] }
}

export function queueForSession(sessionID: string): QueueItem[] {
  return queueBySession()[sessionID] ?? []
}

export function ingestQueueEvent(fallbackSid: string, event: unknown): void {
  const snap = extractQueueSnapshot(fallbackSid, event)
  if (!snap) return
  setQueueBySession(prev => applyQueueSnapshot(prev, snap.sessionID, snap.items))
}

export function replaceQueue(sessionID: string, items: QueueItem[]): void {
  setQueueBySession(prev => applyQueueSnapshot(prev, sessionID, items))
}

export function queueItemText(item: QueueItem, max = 80): string {
  const raw = item.text?.trim()
    || (item.parts ?? [])
      .filter(p => p.type === "text")
      .map(p => String(p.text ?? "").trim())
      .filter(Boolean)
      .join(" ")
    || ((item.parts?.length ?? 0) > 0 ? "(附件)" : "(空消息)")
  if (raw.length <= max) return raw
  return raw.slice(0, Math.max(1, max - 1)) + "…"
}

export async function fetchQueue(sessionID: string): Promise<void> {
  try {
    const { items } = await window.api.mafw.sessions.queueList(sessionID)
    replaceQueue(sessionID, items ?? [])
  } catch {
    // fail-open: the next queue.updated / reconnect fetch will recover
  }
}

export async function cancelQueueItem(sessionID: string, itemId: string): Promise<boolean> {
  try {
    await window.api.mafw.sessions.queueCancel(sessionID, itemId)
    return true
  } catch {
    return false
  }
}

export async function clearGatewayQueue(sessionID: string): Promise<number | null> {
  try {
    const { cleared } = await window.api.mafw.sessions.queueClear(sessionID)
    return cleared
  } catch {
    return null
  }
}
