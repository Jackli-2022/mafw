import { describe, expect, test } from "bun:test"
import {
  MAX_CONTRIBUTIONS_PER_SURFACE,
  MenuContributionRegistry,
  type MenuContributionContext,
} from "./contributions"
import { item, validateMenu } from "./model"
import type { MenuModel } from "./types"

function baseMenu(): MenuModel {
  return {
    surface: "message",
    items: [item("message.copy", "复制"), item("message.quote", "引用")],
  }
}

function contribution(id: string, over: Partial<Parameters<MenuContributionRegistry["register"]>[0]> = {}) {
  return {
    id,
    surface: "message" as const,
    label: id,
    run: () => {},
    ...over,
  }
}

describe("MenuContributionRegistry", () => {
  test("registers and lists a contribution", () => {
    const reg = new MenuContributionRegistry()
    reg.register(contribution("ping"))
    expect(reg.list("message").map((entry) => entry.id)).toEqual(["ping"])
  });

  test("disposer removes only the contribution it registered", () => {
    const reg = new MenuContributionRegistry()
    const dispose = reg.register(contribution("ping"))
    reg.register(contribution("pong"))
    dispose()
    expect(reg.list("message").map((entry) => entry.id)).toEqual(["pong"])
  });

  test("rejects duplicate ids", () => {
    const reg = new MenuContributionRegistry()
    reg.register(contribution("ping"))
    expect(() => reg.register(contribution("ping"))).toThrow(/duplicate/)
  });

  test("rejects invalid ids and empty labels", () => {
    const reg = new MenuContributionRegistry()
    expect(() => reg.register(contribution("bad id"))).toThrow(/id/)
    expect(() => reg.register(contribution("empty", { label: "  " }))).toThrow(/label/)
  });

  test("caps contributions per surface", () => {
    const reg = new MenuContributionRegistry()
    for (let i = 0; i < MAX_CONTRIBUTIONS_PER_SURFACE; i++) {
      reg.register(contribution(`item-${i}`))
    }
    expect(() => reg.register(contribution("overflow"))).toThrow(/too many/)
  });

  test("danger contributions are reserved until the insertion policy exists", () => {
    const reg = new MenuContributionRegistry()
    expect(() => reg.register(contribution("delete", { danger: true }))).toThrow(/danger/)
  });

  test("merge leaves the model untouched when no contribution matches", () => {
    const reg = new MenuContributionRegistry()
    reg.register(contribution("session-only", { surface: "session.row" }))
    const model = baseMenu()
    const merged = reg.merge(model, { surface: "message", target: { id: "m1" } })
    expect(merged.model).toBe(model)
    expect(merged.run("contrib:session-only")).toBe(false)
  });

  test("merge appends a valid extension group in order", () => {
    const reg = new MenuContributionRegistry()
    reg.register(contribution("later", { label: "Later", order: 20 }))
    reg.register(contribution("first", { label: "First", order: 10 }))
    const merged = reg.merge(baseMenu(), { surface: "message", target: { id: "m1" } })
    expect(validateMenu(merged.model)).toEqual([])
    const group = merged.model.items[merged.model.items.length - 1]
    expect(group.type).toBe("group")
    if (group.type !== "group") throw new Error("expected group")
    expect(group.label).toBe("扩展")
    expect(group.items.map((entry) => (entry.type === "item" ? entry.id : entry.type))).toEqual([
      "contrib:first",
      "contrib:later",
    ])
  });

  test("run dispatches the matching contribution with the menu context", async () => {
    const reg = new MenuContributionRegistry()
    const seen: MenuContributionContext[] = []
    reg.register(
      contribution("ping", {
        run: (context) => {
          seen.push(context)
        },
      }),
    )
    const target = { id: "m1" }
    const merged = reg.merge(baseMenu(), { surface: "message", target })
    expect(merged.run("contrib:ping")).toBe(true)
    await Promise.resolve()
    expect(seen).toEqual([{ surface: "message", target }])
  });

  test("run returns false for built-in or unknown ids", () => {
    const reg = new MenuContributionRegistry()
    reg.register(contribution("ping"))
    const merged = reg.merge(baseMenu(), { surface: "message", target: { id: "m1" } })
    expect(merged.run("message.copy")).toBe(false)
    expect(merged.run("contrib:unknown")).toBe(false)
  });
});
