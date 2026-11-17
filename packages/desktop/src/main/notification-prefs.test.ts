import { describe, expect, test } from "bun:test"
import { DEFAULT_NOTIFICATION_PREFS } from "../shared/notifications"
import {
  readNotificationPrefs,
  writeNotificationPrefs,
  type NotificationPrefsStore,
} from "./notification-prefs"

function memoryStore(initial: Record<string, unknown> = {}): NotificationPrefsStore {
  let data = { ...initial }
  return {
    get: (key, defaultValue) => (key in data ? data[key] : defaultValue),
    set: (key, value) => {
      data = { ...data, [key]: value }
    },
  }
}

describe("notification prefs", () => {
  test("defaults", () => {
    expect(readNotificationPrefs(memoryStore())).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  test("round-trips a patch and keeps other values", () => {
    const store = memoryStore()
    expect(writeNotificationPrefs(store, { doNotDisturb: true })).toEqual({
      ...DEFAULT_NOTIFICATION_PREFS,
      doNotDisturb: true,
    })
    expect(readNotificationPrefs(store).doNotDisturb).toBe(true)
    expect(readNotificationPrefs(store).selfDrawn).toBe(true)
  })

  test("invalid persisted values fall back to defaults", () => {
    const store = memoryStore({
      notifySelfDrawn: "nope",
      notifyDoNotDisturb: 1,
      notifyFallbackToNative: null,
    })
    expect(readNotificationPrefs(store)).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })
})
