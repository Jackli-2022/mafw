import {
  clearReadNotifications,
  markNotificationRead,
  markNotificationReadByDedupe,
  normalizeNotificationState,
  publishNotification,
  reconcileAttentionNotifications,
  removeNotification,
  unreadNotificationCount,
  type NotificationState,
} from "./notification-model"
import type { MafwNotification, NotificationInput, NotificationSnapshot } from "../shared/notifications"

const STATE_KEY = "state"

export interface NotificationStoreLike {
  get(key: string, defaultValue?: unknown): unknown
  set(key: string, value: unknown): void
}

/**
 * Single source of truth for self-drawn notifications. Main process owns it;
 * renderers and the floating window only consume snapshots.
 */
export class NotificationHub {
  private state: NotificationState
  private readonly changeListeners = new Set<(snapshot: NotificationSnapshot) => void>()
  private readonly newListeners = new Set<(item: MafwNotification) => void>()

  constructor(
    private readonly store: NotificationStoreLike,
    private readonly now: () => number = Date.now,
  ) {
    this.state = normalizeNotificationState(store.get(STATE_KEY))
  }

  snapshot(): NotificationSnapshot {
    return {
      items: [...this.state.items],
      unread: unreadNotificationCount(this.state),
    }
  }

  publish(input: NotificationInput): MafwNotification | null {
    const result = publishNotification(this.state, input, this.now())
    if (!result.item) return null
    const changed = result.state !== this.state
    this.state = result.state
    if (changed) {
      this.persist()
      this.emitChange()
    }
    if (result.isNew && result.item.severity !== "p3") {
      for (const listener of this.newListeners) listener(result.item)
    }
    return result.item
  }

  markRead(ids: string[] | "all"): void {
    this.commit(markNotificationRead(this.state, ids, this.now()))
  }

  markReadByDedupe(keys: string[]): void {
    this.commit(markNotificationReadByDedupe(this.state, keys, this.now()))
  }

  reconcileAttention(activeIds: string[]): void {
    this.commit(reconcileAttentionNotifications(this.state, activeIds, this.now()))
  }

  clearRead(): void {
    this.commit(clearReadNotifications(this.state))
  }

  remove(id: string): void {
    this.commit(removeNotification(this.state, id))
  }

  onChange(listener: (snapshot: NotificationSnapshot) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onNew(listener: (item: MafwNotification) => void): () => void {
    this.newListeners.add(listener)
    return () => this.newListeners.delete(listener)
  }

  private commit(next: NotificationState): void {
    if (next === this.state) return
    this.state = next
    this.persist()
    this.emitChange()
  }

  private persist(): void {
    try {
      this.store.set(STATE_KEY, this.state)
    } catch {
      // fail-open: in-memory notifications still work; restart loses history
    }
  }

  private emitChange(): void {
    const snapshot = this.snapshot()
    for (const listener of this.changeListeners) listener(snapshot)
  }
}
