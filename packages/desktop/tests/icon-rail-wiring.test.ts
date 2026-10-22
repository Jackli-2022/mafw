import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// deferred minors：Dashboard/Config 也是导航入口，激活态必须跟随当前视图。
const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("IconRail 导航激活态", () => {
  test("Dashboard/Config 图标跟随当前视图激活（互斥）", () => {
    const rail = read("src/renderer/mafw/components/IconRail.tsx")
    expect(rail).toContain("props.dashboardActive")
    expect(rail).toContain("props.configActive")

    const shell = read("src/renderer/mafw/MafwShell.tsx")
    expect(shell).toMatch(/dashboardActive=\{activeTab\(\) === "goals" && !showConfig\(\)\}/)
    expect(shell).toMatch(/configActive=\{showConfig\(\)\}/)
  })
})
