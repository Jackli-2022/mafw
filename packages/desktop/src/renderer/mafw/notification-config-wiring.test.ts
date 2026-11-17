// Source contract：Config › 桌面集成 › 通知 三个开关与 preload/IPC 契约。
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const config = readFileSync(new URL("./pages/Config.tsx", import.meta.url), "utf8")
const preloadIndex = readFileSync(new URL("../../preload/index.ts", import.meta.url), "utf8")
const preloadTypes = readFileSync(new URL("../../preload/types.ts", import.meta.url), "utf8")

describe("notification config wiring", () => {
  test("Config exposes the three switches with rollback", () => {
    expect(config).toContain("自绘悬浮通知窗")
    expect(config).toContain("勿扰")
    expect(config).toContain("原生通知兜底")
    expect(config).toContain("updateNotificationPrefs({ selfDrawn: v })")
    expect(config).toContain("updateNotificationPrefs({ doNotDisturb: v })")
    expect(config).toContain("updateNotificationPrefs({ fallbackToNative: v })")
    expect(config).toContain("loadNotificationPrefs()")
  })

  test("preload wires the prefs IPC channels", () => {
    expect(preloadIndex).toContain('invoke("get-notification-prefs")')
    expect(preloadIndex).toContain('invoke("set-notification-prefs"')
    expect(preloadTypes).toContain("getNotificationPrefs")
    expect(preloadTypes).toContain("setNotificationPrefs")
  })
})
