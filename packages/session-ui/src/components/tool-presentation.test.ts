import { describe, expect, test } from "bun:test"
import { DEFAULT_EXPANDED, defaultCollapsed, partOutputText, resolvePresentation } from "./tool-presentation"

const ctx = (tool = "mcp_probe", status: any = "completed") => ({
  props: { tool, input: {}, metadata: {}, status } as any,
  mode: "chat" as const,
  t: (key: string) => key,
})

describe("tool presentation defaults", () => {
  test("undefined presentation still collapses to a titled row and expands to default", () => {
    const out = resolvePresentation(undefined, ctx())
    expect(out.collapsed.title).toBe("mcp_probe")
    expect(out.collapsed.status).toBe("completed")
    expect(out.expanded.body).toBe("default")
  })
  test("partial collapsed keeps title and fills status", () => {
    const out = resolvePresentation({ collapsed: { title: "Read" } }, ctx("read", "running"))
    expect(out.collapsed.title).toBe("Read")
    expect(out.collapsed.status).toBe("running")
  })
  test("DEFAULT_EXPANDED is default body", () => {
    expect(DEFAULT_EXPANDED.body).toBe("default")
    expect(defaultCollapsed(ctx()).title).toBe("mcp_probe")
  })
  test("partOutputText prefers output and joins history content text", () => {
    expect(partOutputText({ output: "out" })).toBe("out")
    expect(partOutputText({ content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] })).toBe("a\nb")
    expect(partOutputText({})).toBeUndefined()
  })
})
