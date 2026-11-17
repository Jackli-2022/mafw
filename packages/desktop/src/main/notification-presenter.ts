import type { MafwNotification } from "../shared/notifications"

export interface NotificationPresenterOptions {
  maxVisible?: number
  autoDismissMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  now?: () => number
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
  /** id → 自动消失的剩余毫秒（hover 暂停时记录，恢复时按剩余续跑）。 */
  private readonly remaining = new Map<string, number>()
  /** id → 自动消失的绝对时刻（暂停时换算剩余）。 */
  private readonly deadlines = new Map<string, number>()
  private readonly maxVisible: number
  private readonly autoDismissMs: number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private readonly now: () => number

  constructor(private readonly opts: NotificationPresenterOptions = {}) {
    this.maxVisible = opts.maxVisible ?? DEFAULT_MAX_VISIBLE
    this.autoDismissMs = opts.autoDismissMs ?? DEFAULT_AUTO_DISMISS_MS
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = opts.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.now = opts.now ?? Date.now
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
    if (hovering) {
      // 暂停：记下剩余时间（供恢复续跑），停掉定时器。
      const deadline = this.deadlines.get(id)
      if (deadline !== undefined) {
        const left = Math.max(0, deadline - this.now())
        this.remaining.set(id, left)
      }
      this.clear(id)
    } else {
      // 恢复：只跑剩余时间；从未排程过的（新卡片）跑满 autoDismissMs。
      const left = this.remaining.get(id)
      this.remaining.delete(id)
      this.schedule(id, left ?? this.autoDismissMs)
    }
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
    this.deadlines.clear()
    this.remaining.clear()
    this.items.length = 0
  }

  private schedule(id: string, delayMs = this.autoDismissMs): void {
    this.clear(id)
    const handle = this.setTimer(() => {
      this.timers.delete(id)
      this.deadlines.delete(id)
      this.remaining.delete(id)
      const index = this.items.findIndex((entry) => entry.id === id)
      if (index >= 0) this.items.splice(index, 1)
      this.emit()
    }, delayMs)
    this.timers.set(id, handle)
    this.deadlines.set(id, this.now() + delayMs)
  }

  private clear(id: string): void {
    const handle = this.timers.get(id)
    if (handle === undefined) return
    this.timers.delete(id)
    this.deadlines.delete(id)
    this.clearTimer(handle)
  }

  private emit(): void {
    this.opts.onVisibleChange?.(this.visible())
  }
}
