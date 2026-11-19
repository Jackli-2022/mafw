import { describe, expect, test } from "bun:test"
import { PRESENTED_ROW_TOOLS, presentRowTool } from "./tool-presenters"
import { resolvePresentation, type ToolPresentationContext } from "./tool-presentation"

const base: ToolPresentationContext = {
  props: {
    tool: "read",
    input: { filePath: "C:/repo/src/a.ts", command: "npm test", url: "https://example.com", query: "x", pattern: "x" },
    metadata: {},
    status: "completed",
  },
  directory: "C:/repo",
  mode: "chat",
  t: (key) => key,
}

describe("row presenter conformance", () => {
  test("every Wave 1 row tool resolves both states", () => {
    for (const name of PRESENTED_ROW_TOOLS) {
      const ctx = { ...base, props: { ...base.props, tool: name } }
      const out = resolvePresentation(presentRowTool(name, ctx), ctx)
      expect(out.collapsed.title).toBeTruthy()
      expect(out.collapsed.status).toBeTruthy()
      expect(out.expanded.body ?? out.expanded.sections).toBeTruthy()
    }
  })
})
