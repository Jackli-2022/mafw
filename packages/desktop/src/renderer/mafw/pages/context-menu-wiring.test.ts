import { expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) => readFileSync(join(import.meta.dirname, file), "utf8")

test("cards no longer hand-write menus", () => {
  for (const file of ["Dashboard.tsx", "Memory.tsx", "ApprovalsPage.tsx", "TriagePage.tsx", "Automations.tsx"]) {
    const src = read(file)
    expect({ file, usesMafwContextMenu: src.includes("MafwContextMenu") }).toEqual({ file, usesMafwContextMenu: false })
    expect({ file, requestsMenu: src.includes("menuController.request") }).toEqual({ file, requestsMenu: true })
  }
})

test("MafwContextMenu is retired", () => {
  expect(existsSync(join(import.meta.dirname, "../components/MafwContextMenu.tsx"))).toBe(false)
})

test("automations and triage use their builders", () => {
  expect(read("Automations.tsx")).toContain("buildAutomationCardMenu")
  expect(read("TriagePage.tsx")).toContain("buildTriageCardMenu")
})

test("dashboard no longer offers resume", () => {
  expect(read("Dashboard.tsx")).not.toContain("RESUME")
})
