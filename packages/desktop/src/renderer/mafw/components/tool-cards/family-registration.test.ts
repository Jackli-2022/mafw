import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const index = fs.readFileSync(new URL("./index.ts", import.meta.url), "utf-8")
const goal = fs.readFileSync(new URL("./goal-created.tsx", import.meta.url), "utf-8")

describe("MAFW family registration", () => {
  test("registers present + renderSections instead of familyCard", () => {
    expect(index).toContain("present: (ctx) => presentFamily(spec, ctx)")
    expect(index).toContain("renderSections: familyRenderSections")
    expect(index).not.toContain("familyCard(spec)")
  })

  test("goal-created legacy fallback uses the ToolCard family shell", () => {
    expect(goal).toContain("<FamilyCard spec={TOOL_SPECS.mafw_create_goal}")
    expect(goal).not.toContain("familyCard(")
  })
})
