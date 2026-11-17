// Source contract for the in-app notification center: the rail bell, the shell
// wiring and the panel must stay connected; the renderer never posts native
// OS notifications.
import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const rail = readFileSync(new URL("./components/IconRail.tsx", import.meta.url), "utf8")
const shell = readFileSync(new URL("./MafwShell.tsx", import.meta.url), "utf8")
const center = readFileSync(new URL("./components/NotificationCenter.tsx", import.meta.url), "utf8")
const icons = readFileSync(new URL("../../../../ui/src/components/icon.tsx", import.meta.url), "utf8")

describe("notification center wiring", () => {
  test("the rail exposes a bell with an unread badge", () => {
    expect(rail).toContain("onNotifications: () => void")
    expect(rail).toContain("notificationsUnread?: number")
    expect(rail).toContain('icon: "bell"')
    expect(icons).toContain("bell:")
  })

  test("the shell mounts the center and routes targets", () => {
    expect(shell).toContain("<NotificationCenter")
    expect(shell).toContain("ensureNotifications()")
    expect(shell).toContain("navigate.onNotification")
    expect(shell).toContain("notificationsOpen")
    expect(shell).toContain("navigateNotificationTarget(item.target, notificationNavDeps)")
  })

  test("the shell reports the effective theme for the floating window", () => {
    expect(shell).toContain("notifications.reportTheme(mode)")
    expect(shell).toContain("MutationObserver(reportTheme)")
    expect(shell).toContain('attributeFilter: ["data-color-scheme", "data-theme"]')
  })

  test("the panel has filters, triage actions and keyboard support", () => {
    expect(center).toContain("全部已读")
    expect(center).toContain("清空已读")
    expect(center).toContain("未读")
    expect(center).toContain("暂无通知")
    expect(center).toContain('role="dialog"')
    expect(center).toContain('aria-pressed')
  })

  test("the renderer never posts native OS notifications", () => {
    expect(center).not.toContain("new Notification")
    expect(shell).not.toContain("new Notification")
  })
})
