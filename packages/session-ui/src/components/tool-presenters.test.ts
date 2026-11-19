import { describe, expect, test } from "bun:test"
import { genericPresentation, presentRowTool } from "./tool-presenters"
import { resolvePresentation, type ToolPresentationContext } from "./tool-presentation"

const ctx = (props: any, mode: "chat" | "context" = "chat"): ToolPresentationContext => ({
  props,
  directory: "C:/repo",
  mode,
  t: (key: string) => key,
})

const present = (tool: string, props: any, mode: "chat" | "context" = "chat") => {
  const c = ctx(props, mode)
  return resolvePresentation(presentRowTool(tool, c), c)
}

describe("row tool presentations", () => {
  test("read uses a relative path in chat and a filename in the context group", () => {
    const props = {
      tool: "read",
      input: { filePath: "C:/repo/packages/x.ts" },
      metadata: {},
      status: "completed",
    }
    expect(present("read", props).collapsed).toMatchObject({
      title: "ui.tool.read",
      object: "packages/x.ts",
    })
    expect(present("read", props, "context").collapsed.object).toBe("x.ts")
    expect(present("read", props).expanded.body).toBe("default")
  })

  test("list / glob / grep expose their search target", () => {
    expect(present("list", { tool: "list", input: { path: "C:/repo/src" }, metadata: {}, status: "completed" }).collapsed.object).toBe("src")
    expect(present("glob", { tool: "glob", input: { pattern: "**/*.ts" }, metadata: {}, status: "completed" }).collapsed.object).toBe("**/*.ts")
    const grep = present("grep", { tool: "grep", input: { pattern: "foo", include: "*.ts" }, metadata: {}, status: "completed" })
    expect(grep.collapsed.object).toBe("foo")
    expect(grep.collapsed.meta?.[0]?.text).toBe("include=*.ts")
  })

  test("webfetch keeps a link action and a default expanded body", () => {
    const out = present("webfetch", {
      tool: "webfetch",
      input: { url: "https://example.com" },
      metadata: {},
      status: "completed",
    })
    expect(out.collapsed.object).toBe("https://example.com")
    expect(out.expanded.body).toBe("default")
    expect(out.expanded.actions?.[0]).toMatchObject({ kind: "link", href: "https://example.com" })
  })

  test("bash uses the terminal body", () => {
    const out = present("bash", { tool: "bash", input: { command: "npm test" }, metadata: {}, status: "completed" })
    expect(out.collapsed.object).toBe("npm test")
    expect(out.expanded.body).toBe("terminal")
  })

  test("unknown tools fall back to a titled default body", () => {
    const props = { tool: "mcp_x", input: { query: "hi" }, metadata: {}, status: "completed" }
    const out = resolvePresentation(genericPresentation(props, ctx(props)), ctx(props))
    expect(out.collapsed.title).toBe("mcp_x")
    expect(out.collapsed.object).toBe("hi")
    expect(out.expanded.body).toBe("default")
  })
})
