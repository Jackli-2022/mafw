import { describe, expect, test } from "bun:test"
import { TOOL_SPECS } from "./extract"
import {
  executeCallArgs,
  executeCalls,
  executeHeaderSubtitle,
  executeOutputView,
  executeToolLabel,
  normalizeExecuteToolName,
} from "./execute-model"

describe("executeCalls", () => {
  test("keeps valid metadata.toolCalls and drops malformed entries", () => {
    expect(
      executeCalls({
        toolCalls: [
          { tool: "mafw.mafw_get_axioms", status: "completed" },
          { tool: "search", status: "running", input: { query: "x" } },
          { tool: "bad-status", status: "queued" },
          { status: "running" },
          null,
        ],
      }),
    ).toEqual([
      { tool: "mafw.mafw_get_axioms", status: "completed" },
      { tool: "search", status: "running", input: { query: "x" } },
    ])
  })

  test("returns [] without metadata or toolCalls", () => {
    expect(executeCalls(undefined)).toEqual([])
    expect(executeCalls({})).toEqual([])
    expect(executeCalls({ toolCalls: "nope" })).toEqual([])
  })
})

describe("normalizeExecuteToolName", () => {
  test("strips the mafw namespace prefix", () => {
    expect(normalizeExecuteToolName("mafw.mafw_get_axioms")).toBe("mafw_get_axioms")
    expect(normalizeExecuteToolName("mafw.mafw_add_memory")).toBe("mafw_add_memory")
  })

  test("keeps bare names and code-mode built-ins unchanged", () => {
    expect(normalizeExecuteToolName("mafw_get_axioms")).toBe("mafw_get_axioms")
    expect(normalizeExecuteToolName("search")).toBe("search")
  })

  test("keeps other namespaces intact", () => {
    expect(normalizeExecuteToolName("browser.tabs.open")).toBe("browser.tabs.open")
  })
})

describe("executeToolLabel", () => {
  test("uses the MAFW card title when known", () => {
    expect(executeToolLabel("mafw.mafw_get_axioms")).toBe(TOOL_SPECS.mafw_get_axioms.title)
  })

  test("falls back to the normalized name", () => {
    expect(executeToolLabel("search")).toBe("search")
    expect(executeToolLabel("browser.tabs.open")).toBe("browser.tabs.open")
  })
})

describe("executeCallArgs", () => {
  test("shows primitive args and skips large edit/memory fields", () => {
    expect(
      executeCallArgs({
        path: "/a.ts",
        oldString: "x".repeat(500),
        newString: "y".repeat(500),
        content: "z".repeat(500),
        code: "return 1",
        query: "find me",
        limit: 10,
      }),
    ).toEqual(["path=/a.ts", "query=find me", "limit=10"])
  })

  test("truncates long values and caps the number of args", () => {
    const args = executeCallArgs({ a: "x".repeat(200), b: "b", c: "c", d: "d" })
    expect(args).toHaveLength(3)
    expect(args[0]!.length).toBeLessThan(100)
    expect(args[0]).toContain("…")
  })

  test("joins primitive arrays and ignores objects", () => {
    expect(executeCallArgs({ cueAnchors: ["a", "b"], nested: { x: 1 } })).toEqual(["cueAnchors=a, b"])
  })
})

describe("executeHeaderSubtitle", () => {
  test("prefers the failed call", () => {
    expect(
      executeHeaderSubtitle([
        { tool: "mafw.mafw_list_pending_questions", status: "completed" },
        { tool: "mafw.mafw_get_axioms", status: "error", input: { query: "missing" } },
      ]),
    ).toBe(`${TOOL_SPECS.mafw_get_axioms.title} [query=missing]`)
  })

  test("falls back to the latest call", () => {
    expect(
      executeHeaderSubtitle([
        { tool: "mafw.mafw_get_axioms", status: "completed", input: { query: "a" } },
        { tool: "search", status: "completed" },
      ]),
    ).toBe("search")
  })

  test("returns undefined with no calls", () => {
    expect(executeHeaderSubtitle([])).toBeUndefined()
  })
})

describe("executeOutputView", () => {
  test("passes through small outputs", () => {
    expect(executeOutputView("a\nb", 10, 5)).toEqual({ preview: "a\nb", truncated: false, chars: 3, lines: 2 })
  })

  test("truncates by characters", () => {
    expect(executeOutputView("x".repeat(20), 10, 100)).toEqual({
      preview: "x".repeat(10),
      truncated: true,
      chars: 20,
      lines: 1,
    })
  })

  test("truncates by lines", () => {
    expect(executeOutputView("a\nb\nc", 100, 2)).toEqual({
      preview: "a\nb",
      truncated: true,
      chars: 5,
      lines: 3,
    })
  })

  test("uses whichever cap is shorter when both apply", () => {
    expect(executeOutputView("x".repeat(20), 10, 2).preview).toBe("x".repeat(10))
    expect(executeOutputView("a\nb\nc", 3, 2).preview).toBe("a\nb")
  })

  test("handles empty and undefined output", () => {
    expect(executeOutputView(undefined)).toEqual({ preview: "", truncated: false, chars: 0, lines: 0 })
    expect(executeOutputView("")).toEqual({ preview: "", truncated: false, chars: 0, lines: 0 })
  })
})
