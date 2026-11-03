// Task 10: unified declarative tool cards — pure model / conflict tests.
//
// Everything here is plain data in / plain data out: no Solid, no DOM, no
// ToolRegistry and no plugin code. The renderer reuses these helpers so alias
// matching, deterministic conflicts, payload caps and invoke-once semantics can
// be verified without a browser.
import { describe, expect, test } from "bun:test"
import type {
  PluginClientDescriptor,
  PluginToolCardDescriptor,
} from "@mafw/plugin-contract"
import {
  effectiveToolCardTargets,
  planToolCardInvocation,
  shouldInvokeToolCard,
  toolCardInvocationKey,
  toolCardModel,
  toolCardPayloadBytes,
  toolCardResponseCurrent,
  toolCardViewOf,
} from "./plugin-tool-card-model"
import type { ToolCardRenderRequest } from "./plugin-tool-card-model"

const LIMIT = 256 * 1024

function card(over: Partial<PluginToolCardDescriptor> = {}): PluginToolCardDescriptor {
  return { id: "card", tools: ["bash"], viewAction: "view", ...over }
}

function descriptor(
  name: string,
  cards: PluginToolCardDescriptor[],
  over: Partial<PluginClientDescriptor> = {},
): PluginClientDescriptor {
  const actions = [...new Set(cards.map((entry) => entry.viewAction))].map((action) => ({
    name: action,
  }))
  return {
    name,
    version: "1.0.0",
    revision: `${name}-rev:1`,
    ui: { toolCards: cards },
    actions,
    events: [],
    ...over,
  }
}

function targetsOf(
  descriptors: PluginClientDescriptor[],
  legacy: Array<{ tool: string; override?: boolean }> = [],
  options?: { isOccupied?: (target: string) => boolean },
): string[] {
  return effectiveToolCardTargets(descriptors, legacy, options).map((entry) => entry.target)
}

function request(over: Partial<ToolCardRenderRequest> = {}): ToolCardRenderRequest {
  return {
    tool: "mafw_search_hybrid",
    input: { query: "hello" },
    output: "ok",
    metadata: {},
    status: "completed",
    ...over,
  }
}

/** Actual serialized JSON byte length (independent of the model's helper). */
function jsonBytes(value: unknown): number {
  if (value === undefined) return 0
  return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8")
}

// ---------------------------------------------------------------------------
// Alias / canonical matching
// ---------------------------------------------------------------------------

describe("effectiveToolCardTargets: alias matching", () => {
  test("a logical MAFW tool claims both the bare and the MCP double-prefix key", () => {
    const targets = targetsOf([descriptor("acme", [card({ tools: ["mafw_search_hybrid"] })])])
    expect(targets).toContain("mafw_search_hybrid")
    expect(targets).toContain("mafw_mafw_search_hybrid")
  })

  test("a declared MCP double-prefix name also claims its bare key", () => {
    const targets = targetsOf([descriptor("acme", [card({ tools: ["mafw_mafw_search_hybrid"] })])])
    expect(targets).toContain("mafw_search_hybrid")
    expect(targets).toContain("mafw_mafw_search_hybrid")
  })

  test("no target key is produced twice for one card", () => {
    const targets = targetsOf([descriptor("acme", [card({ tools: ["mafw_search_hybrid", "mafw_mafw_search_hybrid"] })])])
    expect(new Set(targets).size).toBe(targets.length)
  })

  test("runtime canonical names resolve to the MAFW card key (shell → bash, subagent → task)", () => {
    const shell = targetsOf([descriptor("acme", [card({ tools: ["shell"] })])])
    expect(shell).toContain("bash")
    expect(shell).toContain("mafw_bash")

    const task = targetsOf([descriptor("acme", [card({ tools: ["task"] })])])
    expect(task).toContain("subagent")
    expect(task).toContain("mafw_subagent")
  })

  test("each target keeps the owning package descriptor and the card declaration", () => {
    const pkg = descriptor("acme", [card({ id: "search", tools: ["mafw_search_hybrid"] })])
    const [first] = effectiveToolCardTargets([pkg], [])
    expect(first?.descriptor.name).toBe("acme")
    expect(first?.card.id).toBe("search")
    expect(first?.key).toBe("acme:search")
  })
})

describe("toolCardModel: canonicalTool", () => {
  test("canonicalTool is carried through so packages can branch on it", () => {
    const model = toolCardModel(request({ tool: "command_execution", canonicalTool: "bash" }))
    expect(model.tool).toBe("command_execution")
    expect(model.canonicalTool).toBe("bash")
  })

  test("empty canonicalTool is omitted instead of emitted as an empty string", () => {
    const model = toolCardModel(request({ canonicalTool: "" }))
    expect("canonicalTool" in model).toBe(false)
  })

  test("status defaults to completed and input defaults to an empty object", () => {
    const model = toolCardModel({ tool: "bash" })
    expect(model.status).toBe("completed")
    expect(model.input).toEqual({})
    expect("output" in model).toBe(false)
    expect("metadata" in model).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Payload caps
// ---------------------------------------------------------------------------

describe("toolCardModel: settled error", () => {
  test("an error part carries its message to the package view", () => {
    const model = toolCardModel(request({ status: "error", error: "boom" }))
    expect(model.status).toBe("error")
    expect(model.error).toBe("boom")
  })

  test("missing or empty error is omitted", () => {
    expect("error" in toolCardModel(request({ error: undefined }))).toBe(false)
    expect("error" in toolCardModel(request({ error: "" }))).toBe(false)
  })

  test("an oversized error is truncated within the shared cap, never thrown", () => {
    const model = toolCardModel(
      request({
        status: "error",
        error: "e".repeat(LIMIT * 2),
        input: { q: "tiny" },
        output: undefined,
        metadata: undefined,
      }),
    )
    expect(model.truncated).toBe(true)
    expect(typeof model.error).toBe("string")
    expect(jsonBytes(model.error)).toBeLessThanOrEqual(LIMIT)
    expect(jsonBytes(model.input) + jsonBytes(model.error)).toBeLessThanOrEqual(LIMIT)
  })
})

describe("toolCardModel: 256 KiB payload cap", () => {
  test("small payloads pass through untouched and untruncated (same references)", () => {
    const input = { query: "hello", nested: { n: 1 } }
    const metadata = { a: "b" }
    const model = toolCardModel(request({ input, metadata }))
    expect(model.truncated).toBe(false)
    expect(model.input).toBe(input)
    expect(model.metadata).toBe(metadata)
  })

  test("oversized input is shrunk and flagged, never thrown", () => {
    const model = toolCardModel(request({ input: { query: "x".repeat(LIMIT + 4096) }, output: undefined }))
    expect(model.truncated).toBe(true)
    expect(toolCardPayloadBytes(model.input)).toBeLessThanOrEqual(LIMIT)
  })

  test("oversized output is shrunk and flagged", () => {
    const model = toolCardModel(
      request({ input: { query: "tiny" }, output: "y".repeat(LIMIT + 4096), metadata: undefined }),
    )
    expect(model.truncated).toBe(true)
    expect(typeof model.output).toBe("string")
    expect(toolCardPayloadBytes(model.output)).toBeLessThanOrEqual(LIMIT)
  })

  test("input + output share one budget: the total stays under the cap", () => {
    const model = toolCardModel(
      request({
        input: { query: "x".repeat(LIMIT / 2) },
        output: "y".repeat(LIMIT / 2),
        metadata: undefined,
      }),
    )
    expect(model.truncated).toBe(true)
    expect(toolCardPayloadBytes(model.input) + toolCardPayloadBytes(model.output)).toBeLessThanOrEqual(LIMIT)
  })

  test("an exact-fit payload is not marked truncated", () => {
    // JSON adds two quote bytes; size the string to land exactly on the cap.
    const model = toolCardModel(
      request({ input: "x".repeat(LIMIT - 2), output: undefined, metadata: undefined }),
    )
    expect(toolCardPayloadBytes(model.input)).toBe(LIMIT)
    expect(model.truncated).toBe(false)
  })

  test("newline-heavy output is capped by its escaped JSON length", () => {
    const model = toolCardModel(
      request({ input: { q: "tiny" }, output: "\n".repeat(LIMIT), metadata: undefined }),
    )
    expect(model.truncated).toBe(true)
    expect(jsonBytes(model.output)).toBeLessThanOrEqual(LIMIT)
    expect(jsonBytes(model.input) + jsonBytes(model.output)).toBeLessThanOrEqual(LIMIT)
    // Newlines escape to two bytes each, so the retained text is ~half the cap.
    expect(String(model.output).length).toBeGreaterThan(LIMIT / 4)
  })

  test("quote- and backslash-heavy output is capped by its escaped JSON length", () => {
    const model = toolCardModel(
      request({
        input: { q: "tiny" },
        output: '"\u005c'.repeat(LIMIT),
        metadata: undefined,
      }),
    )
    expect(model.truncated).toBe(true)
    expect(jsonBytes(model.input) + jsonBytes(model.output)).toBeLessThanOrEqual(LIMIT)
    expect(String(model.output).length).toBeGreaterThan(LIMIT / 4)
  })

  test("a huge nested field is truncated in place instead of being dropped whole", () => {
    const deep = "x".repeat(LIMIT * 2)
    const model = toolCardModel(
      request({ input: { nested: { deep, other: 1 } }, output: undefined, metadata: undefined }),
    )
    expect(model.truncated).toBe(true)
    expect(jsonBytes(model.input)).toBeLessThanOrEqual(LIMIT)
    const nested = (model.input as { nested?: { deep?: unknown } }).nested
    expect(typeof nested?.deep).toBe("string")
    expect((nested?.deep as string).startsWith("x")).toBe(true)
    expect((nested?.deep as string).length).toBeLessThan(deep.length)
  })

  test("a huge nested field survives together with input+output sharing the cap", () => {
    const model = toolCardModel(
      request({
        input: { nested: { deep: "x".repeat(LIMIT) } },
        output: "y".repeat(LIMIT),
        metadata: undefined,
      }),
    )
    expect(model.truncated).toBe(true)
    expect(jsonBytes(model.input) + jsonBytes(model.output)).toBeLessThanOrEqual(LIMIT)
    const nested = (model.input as { nested?: { deep?: unknown } }).nested
    expect(typeof nested?.deep).toBe("string")
  })

  test("mixed escape-heavy containers still land under the cap", () => {
    const input = Array.from({ length: 200 }, (_, index) => ({
      [`key${index}`]: "\n\"\u005c".repeat(500),
    }))
    const output = "\u0001".repeat(LIMIT) // control chars escape to six bytes each
    const model = toolCardModel(request({ input, output, metadata: undefined }))
    expect(model.truncated).toBe(true)
    expect(jsonBytes(model.input) + jsonBytes(model.output)).toBeLessThanOrEqual(LIMIT)
  })
})

// ---------------------------------------------------------------------------
// Invocation lifecycle
// ---------------------------------------------------------------------------

describe("tool card invocation lifecycle", () => {
  test("pending/running parts never invoke the package action", () => {
    expect(shouldInvokeToolCard("pending")).toBe(false)
    expect(shouldInvokeToolCard("running")).toBe(false)
    expect(shouldInvokeToolCard(undefined)).toBe(false)
    expect(toolCardInvocationKey(request({ status: "running" }))).toBeNull()
  })

  test("completed and error parts are settled", () => {
    expect(shouldInvokeToolCard("completed")).toBe(true)
    expect(shouldInvokeToolCard("error")).toBe(true)
    expect(toolCardInvocationKey(request({ status: "error" }))).not.toBeNull()
  })

  test("a completed part invokes exactly once even as render snapshots grow", () => {
    const first = planToolCardInvocation(null, request({ status: "running" }))
    expect(first.invoke).toBe(false)
    expect(first.key).toBeNull()

    const settled = planToolCardInvocation(first.key, request({ status: "completed", output: "a" }))
    expect(settled.invoke).toBe(true)

    const again = planToolCardInvocation(settled.key, request({ status: "completed", output: "a".repeat(8192) }))
    expect(again.invoke).toBe(false)
    expect(again.key).toBe(settled.key)
  })

  test("stale plugin generations discard the response; current ones are accepted", () => {
    expect(toolCardResponseCurrent(null, null)).toBe(false)
    const empty = { bootId: "", counter: -1, revision: "" }
    expect(toolCardResponseCurrent(empty, empty)).toBe(false)
    expect(toolCardResponseCurrent(gen("boot-a:1"), gen("boot-a:2"))).toBe(false)
    expect(toolCardResponseCurrent(gen("boot-b:0"), gen("boot-a:9"))).toBe(false)
    expect(toolCardResponseCurrent(gen("boot-a:1"), gen("boot-a:1"))).toBe(true)
  })

  test("invalid or missing action output falls back to the original card", () => {
    expect(toolCardViewOf(undefined)).toBeNull()
    expect(toolCardViewOf(null)).toBeNull()
    expect(toolCardViewOf({ body: "nope" })).toBeNull()
    expect(toolCardViewOf({ body: [{ type: "text", text: "hi" }] })?.body).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Occupancy / conflicts
// ---------------------------------------------------------------------------

describe("effectiveToolCardTargets: occupancy and conflicts", () => {
  test("without override a logical name only fills unoccupied tools", () => {
    const targets = targetsOf([descriptor("acme", [card({ tools: ["bash"] })])])
    expect(targets).toContain("bash")

    const occupied = targetsOf([descriptor("acme", [card({ tools: ["bash"] })])], [], {
      isOccupied: (target) => target === "bash",
    })
    expect(occupied).not.toContain("bash")
  })

  test("one occupied alias blocks the whole logical tool group", () => {
    const targets = targetsOf([descriptor("acme", [card({ tools: ["bash"] })])], [], {
      isOccupied: (target) => target === "bash",
    })
    // `shell` / `mafw_*` must not stay bound when the built-in `bash` is kept.
    expect(targets).toEqual([])
  })

  test("override:true may replace a built-in card", () => {
    const targets = targetsOf(
      [descriptor("acme", [card({ tools: ["bash"], override: true })])],
      [],
      { isOccupied: (target) => target === "bash" },
    )
    expect(targets).toContain("bash")
  })

  test("legacy conflict without override keeps the legacy card", () => {
    const targets = targetsOf(
      [descriptor("acme", [card({ tools: ["mafw_search_hybrid"] })])],
      [{ tool: "mafw_search_hybrid", override: false }],
    )
    expect(targets).toEqual([])
  })

  test("override:true takes a tool away from a legacy card", () => {
    const targets = targetsOf(
      [descriptor("acme", [card({ tools: ["mafw_search_hybrid"], override: true })])],
      [{ tool: "mafw_search_hybrid" }],
    )
    expect(targets).toContain("mafw_search_hybrid")
  })

  test("legacy aliases conflict through the same canonical expansion", () => {
    const targets = targetsOf(
      [descriptor("acme", [card({ tools: ["bash"] })])],
      [{ tool: "shell" }],
    )
    expect(targets).toEqual([])
  })

  test("a conflicting duplicate unified override rejects the later candidate deterministically", () => {
    const first = descriptor("aaa", [card({ id: "one", tools: ["bash"], override: true })])
    const second = descriptor("bbb", [card({ id: "two", tools: ["bash"], override: true })])
    const result = effectiveToolCardTargets([first, second], [])
    const owners = result.filter((entry) => entry.target === "bash")
    expect(owners).toHaveLength(1)
    expect(owners[0]?.descriptor.name).toBe("aaa")

    // The later package still registers its non-conflicting tools.
    const mixed = effectiveToolCardTargets(
      [first, descriptor("bbb", [card({ id: "two", tools: ["bash", "grep"], override: true })])],
      [],
    )
    expect(mixed.filter((entry) => entry.target === "bash")).toHaveLength(1)
    expect(mixed.some((entry) => entry.target === "grep" && entry.descriptor.name === "bbb")).toBe(true)
  })

  test("a later duplicate is rejected even when the earlier card has no override", () => {
    const first = descriptor("aaa", [card({ id: "one", tools: ["bash"] })])
    const second = descriptor("bbb", [card({ id: "two", tools: ["bash"], override: true })])
    const result = effectiveToolCardTargets([first, second], [])
    expect(result.filter((entry) => entry.target === "bash")).toHaveLength(1)
    expect(result.find((entry) => entry.target === "bash")?.descriptor.name).toBe("aaa")
  })

  test("removed descriptors produce no targets, so registration can restore originals", () => {
    expect(effectiveToolCardTargets([], [{ tool: "bash" }])).toEqual([])
  })

  test("cards without a viewAction are ignored (cannot invoke anything)", () => {
    expect(targetsOf([descriptor("acme", [card({ viewAction: "" })])])).toEqual([])
  })
})

function gen(revision: string) {
  const separator = revision.lastIndexOf(":")
  return {
    bootId: separator > 0 ? revision.slice(0, separator) : revision,
    counter: separator > 0 ? Number(revision.slice(separator + 1)) : 0,
    revision,
  }
}
