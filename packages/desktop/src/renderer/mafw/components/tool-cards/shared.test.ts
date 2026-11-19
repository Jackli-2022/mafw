import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const src = fs.readFileSync(new URL("./shared.tsx", import.meta.url), "utf-8")

describe("family card shell", () => {
  test("uses ToolCard and keeps the desktop section renderer", () => {
    expect(src).toContain("ToolCard")
    expect(src).toContain("familyRenderSections")
    expect(src).toContain("presentFamily")
    expect(src).toContain("presentation={presentation()}")
    expect(src).toContain("renderSections={familyRenderSections}")
    expect(src).not.toContain("BasicTool")
    expect(src).not.toContain("trigger={{")
  })
})
