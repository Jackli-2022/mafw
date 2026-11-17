import { describe, expect, test } from "bun:test"
import { NotificationHub, type NotificationStoreLike } from "./notification-hub"
import {
  createNotificationWindowController,
  type FloatingWindowHandlers,
  type FloatingWindowLike,
  shouldShowFloatingWindow,
} from "./notification-window"
import type { MafwNotification, NotificationPrefs, NotificationTarget } from "../shared/notifications"

function memoryStore(initial: Record<string, unknown> = {}): NotificationStoreLike {
  let data = { ...initial }
  return {
    get: (key, defaultValue) => (key in data ? data[key] : defaultValue),
    set: (key, value) => {
      data = { ...data, [key]: value }
    },
  }
}

function fakeWindow(readyDelay = false) {
  const sent: Array<{ items: MafwNotification[]; theme: string }> = []
  const calls: string[] = []
  let handlers: FloatingWindowHandlers | null = null
  let readyCb: (() => void) | null = null
  const win: FloatingWindowLike = {
    webContents: {
      send: (_channel: string, payload: { items: MafwNotification[]; theme: string }) => {
        if (readyDelay && readyCb) return // pre-ready sends are lost (renderer not subscribed yet)
        sent.push(payload)
      },
    },
    setBounds: (bounds) => calls.push(`bounds:${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}`),
    showInactive: () => calls.push("show"),
    hide: () => calls.push("hide"),
    isDestroyed: () => false,
    onceReady: (cb) => { readyCb = cb },
  }
  return {
    win,
    sent,
    calls,
    wire: (h: FloatingWindowHandlers) => { handlers = h },
    open: (id: string) => handlers?.open(id),
    dismiss: (id: string) => handlers?.dismiss(id),
    hover: (id: string, hovering: boolean) => handlers?.hover(id, hovering),
    ready: () => { const cb = readyCb; readyCb = null; cb?.() },
  }
}

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 }
const PREFS: NotificationPrefs = { selfDrawn: true, doNotDisturb: false, fallbackToNative: true }

function harness(over: { prefs?: Partial<NotificationPrefs>; ensureWindow?: (h: FloatingWindowHandlers) => FloatingWindowLike; readyDelay?: boolean } = {}) {
  const hub = new NotificationHub(memoryStore(), () => 100)
  const fake = fakeWindow(over.readyDelay ?? false)
  let prefs = { ...PREFS, ...over.prefs }
  const navigated: Array<NotificationTarget | undefined> = []
  const natives: MafwNotification[] = []
  const controller = createNotificationWindowController({
    hub,
    getPrefs: () => prefs,
    getWorkArea: () => WORK_AREA,
    getTheme: () => "dark",
    ensureWindow: over.ensureWindow ?? ((handlers) => { fake.wire(handlers); return fake.win }),
    navigate: (target) => navigated.push(target),
    nativeNotify: (item) => natives.push(item),
  })
  return {
    hub,
    fake,
    controller,
    navigated,
    natives,
    setPrefs: (patch: Partial<NotificationPrefs>) => { prefs = { ...prefs, ...patch } },
  }
}

describe("shouldShowFloatingWindow", () => {
  test("needs selfDrawn and no DND", () => {
    expect(shouldShowFloatingWindow(PREFS)).toBe(true)
    expect(shouldShowFloatingWindow({ ...PREFS, doNotDisturb: true })).toBe(false)
    expect(shouldShowFloatingWindow({ ...PREFS, selfDrawn: false })).toBe(false)
  })
})

describe("notification window controller", () => {
  test("a new p2 shows the floating window with stacked bounds", () => {
    const { hub, fake } = harness()
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    hub.publish({ kind: "attention", severity: "p2", title: "B", reason: "需要你", dedupeKey: "b" })
    expect(fake.sent.at(-1)?.items.map((item) => item.title)).toEqual(["A", "B"])
    expect(fake.sent.at(-1)?.theme).toBe("dark")
    expect(fake.calls).toContain(`bounds:360x${2 * 92 + 10}@${1920 - 16 - 360},${1080 - 16 - (2 * 92 + 10)}`)
    expect(fake.calls).toContain("show")
  })

  test("DND never shows the window", () => {
    const { hub, fake } = harness({ prefs: { doNotDisturb: true } })
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    expect(fake.calls).not.toContain("show")
    expect(hub.snapshot().unread).toBe(1)
  })

  test("selfDrawn=false with fallback posts native notifications only", () => {
    const { hub, fake, natives } = harness({ prefs: { selfDrawn: false } })
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    expect(natives.map((item) => item.title)).toEqual(["A"])
    expect(fake.calls).not.toContain("show")
  })

  test("open marks read, navigates and hides the window", () => {
    const { hub, fake, navigated } = harness()
    hub.publish({
      kind: "goal_result",
      severity: "p1",
      title: "结果",
      reason: "Goal 结果",
      dedupeKey: "g1:r1",
      target: { type: "goal", goalId: "g1", focus: "result" },
    })
    const id = hub.snapshot().items[0].id
    fake.open(id)
    expect(hub.snapshot().unread).toBe(0)
    expect(navigated).toEqual([{ type: "goal", goalId: "g1", focus: "result" }])
    expect(fake.calls).toContain("hide")
  })

  test("dismiss hides the window but keeps the item unread", () => {
    const { hub, fake } = harness()
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    const id = hub.snapshot().items[0].id
    fake.dismiss(id)
    expect(fake.calls).toContain("hide")
    expect(hub.snapshot().unread).toBe(1)
  })

  test("window creation failure falls back to native once and stays broken", () => {
    let created = 0
    const { hub, natives } = harness({
      ensureWindow: () => {
        created += 1
        throw new Error("no window")
      },
    })
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    hub.publish({ kind: "attention", severity: "p2", title: "B", reason: "需要你", dedupeKey: "b" })
    expect(natives.map((item) => item.title)).toEqual(["A", "B"])
    expect(created).toBe(1)
  })

  test("refreshPrefs hides the stack when DND turns on", () => {
    const { hub, fake, controller, setPrefs } = harness()
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    setPrefs({ doNotDisturb: true })
    controller.refreshPrefs()
    expect(fake.calls).toContain("hide")
  })

  test("items pushed before the renderer subscribed are re-sent on did-finish-load", () => {
    const { hub, fake } = harness({ readyDelay: true })
    hub.publish({ kind: "attention", severity: "p2", title: "A", reason: "需要你", dedupeKey: "a" })
    expect(fake.sent).toEqual([])
    fake.ready()
    expect(fake.sent.at(-1)?.items.map((item) => item.title)).toEqual(["A"])
    expect(fake.calls).toContain("show")
  })
})
