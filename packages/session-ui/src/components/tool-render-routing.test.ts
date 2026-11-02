// Error-part routing regression (Task 10 review finding 3).
//
// `ToolPartDisplay` used to short-circuit every error part to ToolErrorCard
// before resolving the registered card, so a custom renderer that opted into
// error rendering (unified plugin tool cards) was unreachable for errors.
// This pins the pure routing decision and the message-part wiring.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ToolRegistry } from "./tool-registry"
import type { ToolProps } from "./message-part"
import { resolveToolHandlesError, shouldRenderToolError } from "./tool-render-routing"

const here = dirname(fileURLToPath(import.meta.url))
const noop = (_props: ToolProps) => null

describe("tool error routing", () => {
  test("unregistered tools keep the generic ToolErrorCard", () => {
    const part = { type: "tool", tool: "totally_unregistered_tool", state: { status: "error", error: "boom" } }
    expect(resolveToolHandlesError(part)).toBe(false)
    expect(shouldRenderToolError(part)).toBe(true)
  })

  test("registered cards without the opt-in still use ToolErrorCard", () => {
    ToolRegistry.register({ name: "legacy_card_tool", render: noop })
    const part = { type: "tool", tool: "legacy_card_tool", state: { status: "error", error: "boom" } }
    expect(resolveToolHandlesError(part)).toBe(false)
    expect(shouldRenderToolError(part)).toBe(true)
  })

  test("a card with handlesError renders the error part itself", () => {
    ToolRegistry.register({ name: "error_aware_tool", render: noop, handlesError: true })
    const part = { type: "tool", tool: "error_aware_tool", state: { status: "error", error: "boom" } }
    expect(resolveToolHandlesError(part)).toBe(true)
    expect(shouldRenderToolError(part)).toBe(false)
  })

  test("runtime aliases resolve to the opt-in card (subagent → task)", () => {
    ToolRegistry.register({ name: "task", render: noop, handlesError: true })
    const part = { type: "tool", tool: "subagent", state: { status: "error", error: "boom" } }
    expect(resolveToolHandlesError(part)).toBe(true)
    expect(shouldRenderToolError(part)).toBe(false)
  })

  test("canonicalTool resolves to the opt-in card", () => {
    ToolRegistry.register({ name: "bash", render: noop, handlesError: true })
    const part = {
      type: "tool",
      tool: "command_execution",
      canonicalTool: "bash",
      state: { status: "error", error: "boom" },
    }
    expect(resolveToolHandlesError(part)).toBe(true)
  })

  test("toolClass family resolves to the opt-in card", () => {
    ToolRegistry.register({ name: "bash", render: noop, handlesError: true })
    const part = {
      type: "tool",
      tool: "some_future_shell_tool",
      toolClass: "shell",
      state: { status: "error", error: "boom" },
    }
    expect(resolveToolHandlesError(part)).toBe(true)
  })

  test("restoring a card without the flag clears error handling", () => {
    ToolRegistry.register({ name: "restored_tool", render: noop, handlesError: true })
    expect(resolveToolHandlesError({ tool: "restored_tool" })).toBe(true)
    ToolRegistry.register({ name: "restored_tool", render: noop })
    expect(resolveToolHandlesError({ tool: "restored_tool" })).toBe(false)
  })

  test("non-error parts never take the error branch", () => {
    ToolRegistry.register({ name: "error_aware_tool", render: noop, handlesError: true })
    expect(shouldRenderToolError({ type: "tool", tool: "error_aware_tool", state: { status: "completed" } })).toBe(false)
    expect(shouldRenderToolError({ type: "tool", tool: "error_aware_tool", state: { status: "error" } })).toBe(false)
    expect(shouldRenderToolError({ type: "text" })).toBe(false)
    expect(shouldRenderToolError(null)).toBe(false)
  })

  test("message-part wires the routing decision into the error branch", () => {
    const source = readFileSync(join(here, "message-part.tsx"), "utf8")
    expect(source).toContain("shouldRenderToolError(part())")
    expect(source).toContain('from "./tool-render-routing"')
  })
})
