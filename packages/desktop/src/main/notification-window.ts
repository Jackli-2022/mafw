import type {
  MafwNotification,
  NotificationPrefs,
  NotificationTarget,
} from "../shared/notifications"
import type { NotificationHub } from "./notification-hub"
import { notificationWindowBounds, type NotificationRect } from "./notification-placement"
import { NotificationPresenter, type NotificationPresenterOptions } from "./notification-presenter"

/** p1/p2 only reach the floating window; p3 never does. */
export function shouldShowFloatingWindow(prefs: NotificationPrefs): boolean {
  return prefs.selfDrawn && !prefs.doNotDisturb
}

export interface FloatingWindowLike {
  webContents: { send(channel: string, ...args: unknown[]): void }
  setBounds(bounds: NotificationRect): void
  showInactive(): void
  hide(): void
  isDestroyed(): boolean
  /** 可选：renderer 加载完成回调（did-finish-load）。用于补发尚未订阅时丢失的栈。 */
  onceReady?(cb: () => void): void
}

export interface FloatingWindowHandlers {
  dismiss(id: string): void
  hover(id: string, hovering: boolean): void
  open(id: string): void
}

export interface NotificationWindowControllerDeps {
  hub: NotificationHub
  getPrefs(): NotificationPrefs
  getWorkArea(): NotificationRect
  getTheme(): "light" | "dark"
  /** 主窗口是否在后台（最小化/隐藏/失焦）——悬浮窗只在这个状态弹出。 */
  mainWindowBackgrounded?(): boolean
  /** Creates (once) the transparent always-on-top window and wires its IPC. */
  ensureWindow(handlers: FloatingWindowHandlers): FloatingWindowLike
  navigate(target: NotificationTarget | undefined): void
  nativeNotify(item: MafwNotification): void
  presenterOptions?: Omit<NotificationPresenterOptions, "onVisibleChange">
}

export interface NotificationWindowController {
  dispose(): void
  /** Re-evaluate gating (Config toggle) without waiting for the next item. */
  refreshPrefs(): void
}

export function createNotificationWindowController(
  deps: NotificationWindowControllerDeps,
): NotificationWindowController {
  let window: FloatingWindowLike | null = null
  let windowBroken = false
  const nativelyNotified = new Set<string>()

  const presenter = new NotificationPresenter({
    ...(deps.presenterOptions ?? {}),
    onVisibleChange: (items) => render(items),
  })

  const hideWindow = () => {
    try {
      window?.hide()
    } catch {
      window = null
    }
  }

  const render = (items: MafwNotification[]): void => {
    if (items.length === 0 || !shouldShowFloatingWindow(deps.getPrefs())) {
      hideWindow()
      return
    }
    if (!window || window.isDestroyed()) {
      if (windowBroken) {
        window = null
      } else {
        try {
          const created = deps.ensureWindow({
            dismiss: (id) => presenter.dismiss(id),
            hover: (id, hovering) => presenter.hover(id, hovering),
            open: (id) => {
              const item = presenter.take(id)
              if (!item) return
              deps.hub.markRead([id])
              deps.navigate(item.target)
            },
          })
          // 竞态兜底：建窗后立刻 push 的条目可能在 renderer 订阅前被发送丢失；
          // 加载完成后补发当前可见栈（reload 场景同样生效）。
          created.onceReady?.(() => {
            if (window === created && !created.isDestroyed()) render(presenter.visible())
          })
          window = created
        } catch {
          windowBroken = true
          window = null
        }
      }
    }
    if (!window) {
      if (deps.getPrefs().fallbackToNative) {
        for (const item of items) {
          if (nativelyNotified.has(item.id)) continue
          nativelyNotified.add(item.id)
          deps.nativeNotify(item)
        }
      }
      return
    }
    window.setBounds(notificationWindowBounds({ workArea: deps.getWorkArea(), count: items.length }))
    window.webContents.send("notification:items", { items, theme: deps.getTheme() })
    window.showInactive()
  }

  const offNew = deps.hub.onNew((item) => {
    const prefs = deps.getPrefs()
    if (shouldShowFloatingWindow(prefs)) {
      // 前台（主窗口可见且聚焦）时不弹悬浮窗——应用内 toast 已覆盖感知，
      // 双通道同屏会打断正在操作的用户（spec §4「窗口在后台时出现」）。
      const backgrounded = deps.mainWindowBackgrounded?.() ?? true
      if (backgrounded) presenter.push(item)
      return
    }
    if (!prefs.selfDrawn && prefs.fallbackToNative) deps.nativeNotify(item)
  })

  return {
    refreshPrefs() {
      render(presenter.visible())
    },
    dispose() {
      offNew()
      presenter.dispose()
      hideWindow()
    },
  }
}
