import type { MafwNotification } from "../shared/notifications"

export interface NotificationPresenterOptions {
  maxVisible?: number
  autoDismissMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  onVisibleChange?: (items: MafwNotification[]) => void
}

const DEFAULT_MAX_VISIBLE = 3
const DEFAULT_AUTO_DISMISS_MS = 6000

/**
 * Visible stack for the floating window. Dropped cards stay in the hub; this
 * only controls what the transient surface shows.
 */
export class NotificationPresenter {
  private readonly items: MafwNotification[] = []
  private readonly timers = new Map<string, unknown>()
  private readonly maxVisible: number
  private readonly autoDismissMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly opts: NotificationPresenterOptions = {}) {
    this.maxVisible = opts.maxVisible ?? DEFAULT_MAX_VISIBLE
    this.autoDismissMs = opts.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  push(item: MafwNotification): void {
    const existing = this.items.findIndex((entry) => entry.id === item.id)
    if (existing >= 0) {
      this.items[existing] = item
      this.schedule(item.id)
      this.emit()
      return
    }
    this.items.push(item)
    while (this.items.length > this.maxVisible) {
      const dropped = this.items.shift()
      if (dropped) this.clear(dropped.id)
    }
    this.schedule(item.id)
    this.emit()
  }

  dismiss(id: string): void {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index < 0) return
    this.items.splice(index, 1)
    this.clear(id)
    this.emit()
  }

  hover(id: string, hovering: boolean): void {
    if (!this.items.some((entry) => entry.id === id)) return
    if (hovering) this.clear(id)
    else this.schedule(id)
  }

  take(id: string): MafwNotification | undefined {
    const index = this.items.findIndex((entry) => entry.id === id)
    if (index < 0) return undefined
    const [item] = this.items.splice(index, 1)
    this.clear(id)
    this.emit()
    return item
  }

  visible(): MafwNotification[] {
    return [...this.items]
  }

  dispose(): void {
    for (const handle of this.timers.values()) this.clearTimer(handle)
    this.timers.clear()
    this.items.length = 0
  }

  private schedule(id: string): void {
    this.clear(id)
    const handle = this.setTimer(() => {
      this.timers.delete(id)
      const index = this.items.findIndex((entry) => entry.id === id)
      if (index >= 0) this.items.splice(index, 1)
      this.emit()
    }, this.autoDismissMs)
    this.timers.set(id, handle)
  }

  private clear(id: string): void {
    const handle = this.timers.get(id)
    if (handle === undefined) return
    this.timers.delete(id)
    this.clearTimer(handle)
  }

  private emit(): void {
    this.opts.onVisibleChange?.(this.visible())
  }
}
