import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"
import { HIDDEN_TOOLS, TOOL_NAME_ALIASES } from "./parts-rules"
import {
  PRESENTED_DIFF_TOOLS,
  PRESENTED_RICH_TOOLS,
  PRESENTED_ROW_TOOLS,
  presentDiffTool,
  presentQuestion,
  presentRowTool,
  presentSkill,
  presentTask,
} from "./tool-presenters"
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

describe("diff presenter conformance", () => {
  test("every diff tool resolves both states", () => {
    for (const name of PRESENTED_DIFF_TOOLS) {
      const ctx = {
        ...base,
        props: {
          ...base.props,
          tool: name,
          metadata: { files: [{ file: "C:/repo/a.ts", patch: "@@ -1 +1 @@", additions: 1, deletions: 1 }] },
        },
      }
      const out = resolvePresentation(presentDiffTool(name, ctx), ctx)
      expect(out.collapsed.title).toBeTruthy()
      expect(out.collapsed.status).toBeTruthy()
      expect(out.expanded.body).toBe("custom")
    }
  })
})

describe("rich presenter conformance", () => {
  test("every rich tool resolves both states", () => {
    const byTool: Record<string, any> = {
      task: { agent: "build", description: "x" },
      question: { questions: [{ question: "q" }] },
      skill: { name: "s" },
    }
    const presenters: Record<string, (ctx: ToolPresentationContext) => any> = {
      task: presentTask,
      question: presentQuestion,
      skill: presentSkill,
    }
    const richBase: ToolPresentationContext = {
      ...base,
      agent: (name?: string) => (name ? { name } : undefined),
      subagentSession: () => "ses_child",
      sessionHref: (id: string) => `/session/${id}`,
    }
    for (const name of PRESENTED_RICH_TOOLS) {
      const ctx = {
        ...richBase,
        props: {
          ...richBase.props,
          tool: name,
          input: byTool[name],
          metadata: {},
          output: "out",
        },
      }
      const out = resolvePresentation(presenters[name]!(ctx), ctx)
      expect(out.collapsed.title).toBeTruthy()
      expect(out.collapsed.status).toBeTruthy()
      expect(out.expanded.body ?? out.expanded.sections).toBeTruthy()
    }
  })
})

describe("first-party registration conformance", () => {
  const componentSource = fs.readFileSync(new URL("./message-part.tsx", import.meta.url), "utf-8")

  test("every non-hidden registration has a presenter", () => {
    const chunks = componentSource.split("ToolRegistry.register({").slice(1)
    const names = new Set<string>()
    for (const chunk of chunks) {
      const name = chunk.match(/^\s*name: "([^"]+)"/)?.[1]
      if (!name) continue
      names.add(name)
      if (HIDDEN_TOOLS.has(name)) continue
      expect(chunk).toContain("present:")
    }
    expect(names.size).toBeGreaterThanOrEqual(13)
    for (const target of Object.values(TOOL_NAME_ALIASES)) expect(names.has(target)).toBe(true)
  })
})
