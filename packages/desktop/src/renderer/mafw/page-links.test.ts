import { describe, expect, test } from "bun:test"
import { PAGE_LINKS } from "./page-links"
import { NAV_TABS } from "./components/nav-tab"

// spec 2026-11-04：项目工作在右工作台；公开页面链接只保留全局资源页。
describe("Dashboard 页面链接", () => {
  test("四个页面：memory/approvals/triage/automation", () => {
    expect(PAGE_LINKS.map(l => l.id).sort()).toEqual(["approvals", "automation", "memory", "triage"])
  })
  test("icon/label 与 NAV_TABS 同源（不重复定义）", () => {
    for (const link of PAGE_LINKS) {
      const tab = NAV_TABS.find(t => t.id === link.id)!
      expect(link.icon).toBe(tab.icon)
      expect(link.label).toBe(tab.label)
    }
  })
})
