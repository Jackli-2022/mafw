import { describe, expect, test } from "bun:test"
import type { PluginClientDescriptor } from "@mafw/plugin-contract"
import { composerActionsFromDescriptors } from "./plugin-composer-actions"

function descriptor(over: Partial<PluginClientDescriptor> = {}): PluginClientDescriptor {
  return {
    name: "sample",
    version: "1.0.0",
    revision: "boot-1:1",
    ui: {},
    actions: [{ name: "draft" }],
    events: [],
    ...over,
  }
}

describe("plugin composer actions", () => {
  test("maps sorted actions, invokes the package action and inserts returned text", async () => {
    const calls: unknown[][] = []
    const inserts: Array<[string, string]> = []
    const actions = composerActionsFromDescriptors({
      descriptors: [
        descriptor({
          ui: {
            composerActions: [
              { id: "later", label: "Later", action: "draft", icon: "refresh", order: 20 },
              { id: "first", label: "First", action: "draft", icon: "bubble-5", order: 10 },
            ],
          },
        }),
      ],
      invoke: async (...args) => {
        calls.push(args)
        return { insertText: "draft text" }
      },
      onInsert: (sessionID, text) => inserts.push([sessionID, text]),
    })

    expect(actions.map((action) => action.id)).toEqual([
      "plugin:sample:first",
      "plugin:sample:later",
    ])
    await actions[0].run("s1")
    expect(calls).toEqual([["sample", "draft", {}, "s1"]])
    expect(inserts).toEqual([["s1", "draft text"]])
  })

  test("skips undeclared actions and falls back to a known icon", () => {
    const errors: string[] = []
    const actions = composerActionsFromDescriptors({
      descriptors: [
        descriptor({
          ui: {
            composerActions: [
              { id: "missing", label: "Missing", action: "missing" },
              { id: "ok", label: "OK", action: "draft", icon: "not-a-real-icon" },
            ],
          },
        }),
      ],
      invoke: async () => null,
      onError: (message) => errors.push(message),
    })

    expect(actions.map((action) => action.id)).toEqual(["plugin:sample:ok"])
    expect(actions[0].icon).toBe("plus")
    expect(errors.length).toBe(1)
  })

  test("invoke rejection is reported and does not throw", async () => {
    const errors: string[] = []
    const actions = composerActionsFromDescriptors({
      descriptors: [
        descriptor({
          ui: {
            composerActions: [{ id: "boom", label: "Boom", action: "draft" }],
          },
        }),
      ],
      invoke: async () => {
        throw new Error("gateway down")
      },
      onError: (message) => errors.push(message),
    })

    await expect(actions[0].run("s1")).resolves.toBeUndefined()
    expect(errors.some((message) => message.includes("gateway down"))).toBe(true)
  })
})
