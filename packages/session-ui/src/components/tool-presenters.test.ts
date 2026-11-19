import { describe, expect, test } from "bun:test"
import { genericPresentation, presentDiffTool, presentRowTool } from "./tool-presenters"
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

const diff = (tool: string, props: any) => {
  const c = ctx(props)
  return resolvePresentation(presentDiffTool(tool as any, c), c)
}

describe("diff tool presentations", () => {
  test("edit shows the relative path and ± stats", () => {
    const out = diff("edit", {
      tool: "edit",
      status: "completed",
      input: { filePath: "C:/repo/src/a.ts" },
      metadata: { files: [{ file: "C:/repo/src/a.ts", additions: 4, deletions: 1 }] },
    })
    expect(out.collapsed).toMatchObject({ title: "ui.messagePart.title.edit", object: "src/a.ts" })
    expect(out.collapsed.meta).toEqual([{ text: "+4", tone: "ok" }, { text: "-1", tone: "err" }])
    expect(out.expanded.body).toBe("custom")
  })

  test("streaming edit falls back to the input path with no stats", () => {
    const out = diff("edit", { tool: "edit", status: "running", input: { filePath: "C:/repo/src/a.ts" }, metadata: {} })
    expect(out.collapsed.object).toBe("src/a.ts")
    expect(out.collapsed.meta).toBeUndefined()
  })

  test("write derives additions from content when metadata is absent", () => {
    const out = diff("write", {
      tool: "write",
      status: "completed",
      input: { filePath: "C:/repo/new.ts", content: "a\nb\n" },
      metadata: {},
    })
    expect(out.collapsed.object).toBe("new.ts")
    expect(out.collapsed.meta).toEqual([{ text: "+2", tone: "ok" }])
  })

  test("single-file apply_patch shows the path; multi-file shows the count and totals", () => {
    const single = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: {
        files: [{ file: "C:/repo/a.ts", patch: "@@ -1 +1 @@", additions: 2, deletions: 3, status: "modified" }],
      },
    })
    expect(single.collapsed.object).toBe("a.ts")
    expect(single.collapsed.meta).toEqual([{ text: "+2", tone: "ok" }, { text: "-3", tone: "err" }])

    const multi = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: {
        files: [
          { file: "C:/repo/a.ts", patch: "@@ -1 +1 @@", additions: 2, deletions: 3 },
          { file: "C:/repo/b.ts", before: "", after: "b\n", additions: 3, deletions: 1, status: "added" },
        ],
      },
    })
    expect(multi.collapsed.object).toBe("2 ui.common.file.other")
    expect(multi.collapsed.meta).toEqual([{ text: "+5", tone: "ok" }, { text: "-4", tone: "err" }])
  })

  test("apply_patch ignores metadata rows without diff content", () => {
    const out = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: {
        files: [
          { file: "C:/repo/a.ts", additions: 2, deletions: 0, patch: "@@ -1 +1 @@" },
          { file: "C:/repo/b.ts" },
        ],
      },
    })
    expect(out.collapsed.object).toBe("a.ts")
    expect(out.collapsed.meta).toEqual([{ text: "+2", tone: "ok" }])
  })

  test("deleted single file only shows deletions; empty patch has no object", () => {
    const deleted = diff("apply_patch", {
      tool: "apply_patch",
      status: "completed",
      input: {},
      metadata: {
        files: [{ file: "C:/repo/gone.ts", before: "gone\n", after: "", additions: 0, deletions: 3, status: "deleted" }],
      },
    })
    expect(deleted.collapsed.meta).toEqual([{ text: "-3", tone: "err" }])

    const empty = diff("apply_patch", { tool: "apply_patch", status: "completed", input: {}, metadata: {} })
    expect(empty.collapsed.object).toBeUndefined()
    expect(empty.collapsed.meta).toBeUndefined()
  })
})
