// Task 7: dispatcher entry for the unified plugin revision router.
//
// `plugins.changed` and `plugin:<package>:<event>` are global SSE frames (no
// sessionID). They must be consumed before the dispatcher's session-id routing,
// otherwise they fall through to the tail miss-trace / are silently ignored by
// class. The handler only forwards to injected deps: it never touches plugin
// code or renderer state directly.
import { describe, expect, test } from "bun:test"
import { handlePluginSseEvent } from "./plugins"

function deps() {
  const traces: string[] = []
  const changed: unknown[] = []
  const events: unknown[] = []
  return {
    deps: {
      core: { trace: (_e: any, channel: string) => traces.push(channel) },
      plugins: {
        onChanged: (event: unknown) => changed.push(event),
        onEvent: (event: unknown) => events.push(event),
      },
    } as any,
    traces,
    changed,
    events,
  }
}

describe("handlePluginSseEvent", () => {
  test("plugins.changed is consumed and forwarded to the refresh dep", () => {
    const { deps: d, traces, changed } = deps()
    const event = { type: "plugins.changed", properties: { revision: "boot-a:2" } }
    expect(handlePluginSseEvent(event, d)).toBe(true)
    expect(traces).toEqual(["plugins:changed"])
    expect(changed).toEqual([event])
  })

  test("plugin:<package>:<event> is consumed before session-id routing", () => {
    const { deps: d, traces, events } = deps()
    const event = { type: "plugin:acme:changed", properties: { value: 1 }, sessionID: "s1" }
    expect(handlePluginSseEvent(event, d)).toBe(true)
    expect(traces).toEqual(["plugins:event"])
    expect(events).toEqual([event])
  })

  test("global plugin events without sessionID are still consumed (no miss trace)", () => {
    const { deps: d, events } = deps()
    expect(handlePluginSseEvent({ type: "plugin:acme:changed" }, d)).toBe(true)
    expect(events).toHaveLength(1)
  })

  test("non-plugin events pass through untouched", () => {
    const { deps: d, traces, changed, events } = deps()
    expect(handlePluginSseEvent({ type: "turn.completed" }, d)).toBe(false)
    expect(handlePluginSseEvent({ type: "pluginless" }, d)).toBe(false)
    expect(traces).toEqual([])
    expect(changed).toEqual([])
    expect(events).toEqual([])
  })

  test("malformed frames never throw", () => {
    const { deps: d } = deps()
    expect(handlePluginSseEvent(null, d)).toBe(false)
    expect(handlePluginSseEvent(undefined, d)).toBe(false)
    expect(handlePluginSseEvent({}, d)).toBe(false)
    expect(handlePluginSseEvent({ type: 42 }, d)).toBe(false)
  })
})
