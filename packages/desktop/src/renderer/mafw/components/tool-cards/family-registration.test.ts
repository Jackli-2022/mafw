import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const index = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf-8")
const goal = fs.readFileSync(new URL("./goal-created.tsx", import.meta.url), "utf-8")

describe("MAFW family registration", () => {
  test("registers the family plan before the bespoke goal card", () => {
    expect(index).toContain("registerFamilyCards(ToolRegistry, familyRenderSections)")
    expect(index).not.toContain("familyCard(spec)")
    const family = index.indexOf("registerFamilyCards(ToolRegistry")
    const goal = index.indexOf('registerAliased("mafw_create_goal"')
    expect(family).toBeGreaterThan(-1)
    expect(goal).toBeGreaterThan(family)
  })

  test("goal-created legacy fallback uses the ToolCard family shell", () => {
    expect(goal).toContain("<FamilyCard spec={TOOL_SPECS.mafw_create_goal}")
    expect(goal).not.toContain("familyCard(")
  })
})
