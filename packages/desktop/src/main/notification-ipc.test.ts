import { describe, expect, test } from "bun:test"
import { NotificationHub, type NotificationStoreLike } from "./notification-hub"
import { registerNotificationIpc } from "./notification-ipc"
import { DEFAULT_NOTIFICATION_PREFS } from "../shared/notifications"

function memoryStore(initial: Record<string, unknown> = {}): NotificationStoreLike {
  let data = { ...initial }
  return {
    get: (key, defaultValue) => (key in data ? data[key] : defaultValue),
    set: (key, value) => {
      data = { ...data, [key]: value }
    },
  }
}

type Handler = (event: unknown, ...args: any[]) => any

function fakeIpcMain() {
  const handlers = new Map<string, Handler>()
  return {
    handle: (channel: string, handler: Handler) => {
      handlers.set(channel, handler)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    },
    invoke: (channel: string, ...args: any[]) => {
      const handler = handlers.get(channel)
      if (!handler) throw new Error(`no handler for ${channel}`)
      return handler({}, ...args)
    },
    channels: () => [...handlers.keys()].sort(),
  }
}

function harness() {
  const ipc = fakeIpcMain()
  const store = memoryStore()
  const hub = new NotificationHub(store, () => 100)
  const broadcasts: Array<{ unread: number }> = []
  const prefs: unknown[] = []
  const cleanup = registerNotificationIpc({
    ipcMain: ipc,
    hub,
    store,
    broadcast: (snapshot) => broadcasts.push({ unread: snapshot.unread }),
    onPrefsChanged: (value) => prefs.push(value),
  })
  return { ipc, hub, broadcasts, prefs, cleanup }
}

describe("notification IPC", () => {
  test("registers the notification and prefs channels", () => {
    const { ipc } = harness()
    expect(ipc.channels()).toEqual([
      "get-notification-prefs",
      "mafw-notifications:clearRead",
      "mafw-notifications:list",
      "mafw-notifications:markAllRead",
      "mafw-notifications:markRead",
      "mafw-notifications:markReadByDedupe",
      "mafw-notifications:publish",
      "mafw-notifications:remove",
      "mafw-notifications:theme",
      "set-notification-prefs",
    ])
  })

  test("publish returns an item, broadcasts and lists it", () => {
    const { ipc, broadcasts } = harness()
    const item = ipc.invoke("mafw-notifications:publish", {
      kind: "permission",
      severity: "p2",
      title: "需要权限审批",
      reason: "需要你",
      dedupeKey: "permission:1",
    })
    expect(item.id).toBe("permission:1")
    expect(broadcasts).toEqual([{ unread: 1 }])
    expect(ipc.invoke("mafw-notifications:list").unread).toBe(1)
  })

  test("invalid publish is rejected", () => {
    const { ipc } = harness()
    expect(ipc.invoke("mafw-notifications:publish", { kind: "nope" })).toBeNull()
  })

  test("mark read / all / by dedupe and clear", () => {
    const { ipc } = harness()
    ipc.invoke("mafw-notifications:publish", {
      kind: "permission",
      severity: "p2",
      title: "A",
      reason: "需要你",
      dedupeKey: "permission:1",
    })
    ipc.invoke("mafw-notifications:markReadByDedupe", ["permission:1"])
    expect(ipc.invoke("mafw-notifications:list").unread).toBe(0)
    ipc.invoke("mafw-notifications:clearRead")
    expect(ipc.invoke("mafw-notifications:list").items).toHaveLength(0)
  })

  test("prefs round-trip and notify the controller", () => {
    const { ipc, prefs } = harness()
    expect(ipc.invoke("get-notification-prefs")).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(ipc.invoke("set-notification-prefs", { doNotDisturb: true })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      doNotDisturb: true,
    })
    expect(prefs).toHaveLength(1)
  })

  test("theme reports reach the controller and reject invalid values", () => {
    const themes: string[] = []
    const ipc = fakeIpcMain()
    const hub = new NotificationHub(memoryStore(), () => 100)
    registerNotificationIpc({
      ipcMain: ipc,
      hub,
      store: memoryStore(),
      broadcast: () => {},
      onThemeReported: (theme) => themes.push(theme),
    })
    ipc.invoke("mafw-notifications:theme", "dark")
    ipc.invoke("mafw-notifications:theme", "light")
    ipc.invoke("mafw-notifications:theme", "nope")
    ipc.invoke("mafw-notifications:theme", 42)
    expect(themes).toEqual(["dark", "light"])
  })

  test("cleanup removes every handler", () => {
    const { ipc, cleanup } = harness()
    cleanup()
    expect(ipc.channels()).toEqual([])
  })
})
