import { describe, expect, test } from "bun:test"
import { PAGE_LINKS } from "./page-links"
import { NAV_TABS } from "./components/nav-tab"

// spec 2026-10-22-workbench-layout D6：五页面入口收进 Dashboard 枢纽卡（NAV_TABS 减 chat）。
describe("Dashboard 页面链接", () => {
  test("五个页面：goals/memory/approvals/triage/automation", () => {
    expect(PAGE_LINKS.map(l => l.id).sort()).toEqual(["approvals", "automation", "goals", "memory", "triage"])
  })
  test("icon/label 与 NAV_TABS 同源（不重复定义）", () => {
    for (const link of PAGE_LINKS) {
      const tab = NAV_TABS.find(t => t.id === link.id)!
      expect(link.icon).toBe(tab.icon)
      expect(link.label).toBe(tab.label)
    }
  })
})
