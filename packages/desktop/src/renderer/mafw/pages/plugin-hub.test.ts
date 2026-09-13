import { describe, expect, test } from "bun:test"
import { sortEntries, statusLabel, installableTypes, type HubEntry } from "./plugin-hub"

const entry = (over: Partial<HubEntry>): HubEntry => ({
  type: "runtime", name: "foo", file: "foo.js", status: "enabled", size: 1, mtime: "2026-09-11T00:00:00Z", ...over,
})

describe("plugin-hub pure helpers", () => {
  test("sortEntries orders types runtime→media→usage→ui then by name", () => {
    const sorted = sortEntries([
      entry({ type: "ui", name: "b" }), entry({ type: "usage", name: "a" }),
      entry({ type: "runtime", name: "z" }), entry({ type: "runtime", name: "a" }),
      entry({ type: "media", name: "m" }),
    ])
    expect(sorted.map((e) => `${e.type}/${e.name}`)).toEqual([
      "runtime/a", "runtime/z", "media/m", "usage/a", "ui/b",
    ])
  })

  test("statusLabel maps all four statuses", () => {
    expect(statusLabel(entry({ status: "enabled" }))).toBe("已启用")
    expect(statusLabel(entry({ status: "disabled" }))).toBe("已禁用")
    expect(statusLabel(entry({ status: "error" }))).toBe("错误")
    expect(statusLabel(entry({ status: "config-disabled" }))).toBe("config 禁用")
  })

  test("installableTypes exposes the four fixed types", () => {
    expect(installableTypes()).toEqual(["runtime", "media", "usage", "ui"])
  })
})
