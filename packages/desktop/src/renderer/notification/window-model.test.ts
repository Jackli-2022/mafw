import { describe, expect, test } from "bun:test"
import { applyNotificationTheme, notificationCardLabel } from "./window-model"
import type { MafwNotification } from "../../shared/notifications"

const item = (over: Partial<MafwNotification> = {}): MafwNotification => ({
  id: "n1",
  kind: "attention",
  severity: "p2",
  title: "需要你",
  reason: "需要你",
  createdAt: 0,
  ...over,
})

function fakeDocument() {
  return { documentElement: { dataset: {} as Record<string, string> } } as unknown as Document
}

describe("floating window model", () => {
  test("theme lands on data-color-scheme", () => {
    const doc = fakeDocument()
    applyNotificationTheme(doc, "dark")
    expect(doc.documentElement.dataset.colorScheme).toBe("dark")
    applyNotificationTheme(doc, "light")
    expect(doc.documentElement.dataset.colorScheme).toBe("light")
  })

  test("card label includes the body when present", () => {
    expect(notificationCardLabel(item({ title: "A", body: "B" }))).toBe("A — B")
    expect(notificationCardLabel(item({ title: "A" }))).toBe("A")
  })
})
