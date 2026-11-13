import { describe, expect, test } from "bun:test"
import { PLUGIN_MENU_SURFACES, type PluginClientDescriptor } from "@mafw/plugin-contract"
import type { MenuContribution } from "../context-menu/contributions"
import { MENU_SURFACES } from "../context-menu/types"
import { applyPluginMenuDescriptors } from "./plugin-menu-contributions"

function descriptor(over: Partial<PluginClientDescriptor> = {}): PluginClientDescriptor {
  return {
    name: "sample",
    version: "1.0.0",
    revision: "boot-1:1",
    ui: {},
    actions: [{ name: "getPanel" }],
    events: [],
    ...over,
  }
}

describe("plugin menu contributions", () => {
  test("maps descriptor menu items and invokes the package action", async () => {
    const calls: unknown[][] = []
    const registrations: MenuContribution[] = []
    let disposed = 0

    const dispose = applyPluginMenuDescriptors({
      descriptors: [
        descriptor({
          ui: {
            menuItems: [
              {
                id: "copy",
                surface: "message",
                label: "Copy",
                action: "getPanel",
                icon: "file",
                shortcut: "Ctrl+Shift+C",
                order: 10,
              },
            ],
          },
        }),
      ],
      register: (contribution) => {
        registrations.push(contribution)
        return () => {
          disposed += 1
        }
      },
      invoke: async (...args) => {
        calls.push(args)
        return null
      },
      sessionID: () => "s1",
    })

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      id: "plugin:sample:copy",
      surface: "message",
      label: "Copy",
      icon: "file",
      shortcut: "Ctrl+Shift+C",
      order: 10,
    })

    await registrations[0].run({ surface: "message", target: {} })
    expect(calls).toEqual([["sample", "getPanel", {}, "s1"]])

    dispose()
    expect(disposed).toBe(1)
  })

  test("skips unknown surfaces/actions and survives register errors", () => {
    const errors: string[] = []
    const registrations: MenuContribution[] = []

    applyPluginMenuDescriptors({
      descriptors: [
        descriptor({
          ui: {
            menuItems: [
              { id: "unknown", surface: "unknown", label: "X", action: "getPanel" },
              { id: "missing", surface: "message", label: "X", action: "missing" },
              { id: "bad-register", surface: "message", label: "Bad", action: "getPanel" },
              { id: "ok", surface: "message", label: "OK", action: "getPanel" },
            ],
          },
        }),
      ],
      register: (contribution) => {
        if (contribution.id.endsWith("bad-register")) throw new Error("limit")
        registrations.push(contribution)
        return () => {}
      },
      invoke: async () => null,
      onError: (message) => errors.push(message),
    })

    expect(registrations.map((item) => item.id)).toEqual(["plugin:sample:ok"])
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })

  test("an invoke rejection is reported and does not throw", async () => {
    const errors: string[] = []
    const registrations: MenuContribution[] = []
    applyPluginMenuDescriptors({
      descriptors: [
        descriptor({
          ui: {
            menuItems: [{ id: "boom", surface: "message", label: "Boom", action: "getPanel" }],
          },
        }),
      ],
      register: (contribution) => {
        registrations.push(contribution)
        return () => {}
      },
      invoke: async () => {
        throw new Error("gateway down")
      },
      onError: (message) => errors.push(message),
    })

    await registrations[0].run({ surface: "message", target: {} })
    await Promise.resolve()
    expect(errors.some((message) => message.includes("gateway down"))).toBe(true)
  })

  test("every contract menu surface exists on the desktop menu surface union", () => {
    for (const surface of PLUGIN_MENU_SURFACES) {
      expect(MENU_SURFACES as readonly string[]).toContain(surface)
    }
  })
})
