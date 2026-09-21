import { describe, expect, test } from "bun:test"
import { sortEntries, statusLabel, installableTypes, runtimeActivatable, parseAmbiguousCandidates, builtinMeta, groupEntries, typeMeta, formatSize, type HubEntry } from "./plugin-hub"

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

  test("runtimeActivatable: only enabled runtime entries not already active", () => {
    expect(runtimeActivatable(entry({ type: "runtime", status: "enabled" }), "pi")).toBe(true)
    expect(runtimeActivatable(entry({ type: "runtime", status: "enabled" }), "foo")).toBe(false)
    expect(runtimeActivatable(entry({ type: "runtime", status: "disabled" }), "pi")).toBe(false)
    expect(runtimeActivatable(entry({ type: "runtime", status: "error" }), "pi")).toBe(false)
    expect(runtimeActivatable(entry({ type: "media", status: "enabled" }), "pi")).toBe(false)
    expect(runtimeActivatable(entry({ type: "runtime", status: "enabled" }), null)).toBe(true)
  })
})

describe("parseAmbiguousCandidates", () => {
  test("parses candidate list from gateway error message", () => {
    expect(parseAmbiguousCandidates("ambiguous plugin interface: media/usage")).toEqual(["media", "usage"])
  })
  test("returns null for other errors", () => {
    expect(parseAmbiguousCandidates("plugin already exists: foo.js")).toBeNull()
    expect(parseAmbiguousCandidates("ambiguous plugin interface: ")).toBeNull()
  })
})

describe("builtinMeta", () => {
  test("runtime builtin", () => {
    expect(builtinMeta(entry({ builtin: true, file: "(builtin)", size: 0, mtime: "" }))).toBe("内置")
  })
  test("usage builtin carries pluginType", () => {
    expect(builtinMeta(entry({ type: "usage", builtin: true, pluginType: "api" }))).toBe("内置 · api")
  })
  test("overridden builtin marked", () => {
    expect(builtinMeta(entry({ type: "usage", builtin: true, overridden: true, pluginType: "api" }))).toBe("内置 · api · 被覆盖")
  })
  test("non-builtin entries empty", () => {
    expect(builtinMeta(entry({}))).toBe("")
  })
})

describe("typeMeta", () => {
  test("each type has label and icon", () => {
    for (const t of ["runtime", "media", "usage", "ui"] as const) {
      const m = typeMeta(t)
      expect(m.label.length).toBeGreaterThan(0)
      expect(m.icon.length).toBeGreaterThan(0)
    }
  })
  test("labels are stable", () => {
    expect(typeMeta("runtime").label).toBe("Runtime")
    expect(typeMeta("media").label).toBe("Media")
    expect(typeMeta("usage").label).toBe("Usage")
    expect(typeMeta("ui").label).toBe("UI")
  })
  test("icons are SVG icon names, never emoji", () => {
    const expected = { runtime: "settings-gear", media: "video", usage: "chart-bar", ui: "shapes" }
    for (const t of ["runtime", "media", "usage", "ui"] as const) {
      expect(typeMeta(t).icon).toBe(expected[t])
      expect(typeMeta(t).icon).toMatch(/^[a-z][a-z-]*$/)
    }
  })
})

describe("groupEntries", () => {
  test("groups in fixed type order, entries sorted by name within group", () => {
    const groups = groupEntries([
      entry({ type: "ui", name: "b" }), entry({ type: "usage", name: "z" }),
      entry({ type: "usage", name: "a" }), entry({ type: "runtime", name: "r" }),
    ])
    expect(groups.map((g) => g.type)).toEqual(["runtime", "usage", "ui"])
    expect(groups[1].entries.map((e) => e.name)).toEqual(["a", "z"])
  })
  test("empty types are omitted; empty input yields no groups", () => {
    expect(groupEntries([])).toEqual([])
    const groups = groupEntries([entry({ type: "media", name: "m" })])
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe("media")
  })
  test("does not mutate the input array", () => {
    const input = [entry({ type: "ui", name: "b" }), entry({ type: "runtime", name: "a" })]
    const snapshot = [...input]
    groupEntries(input)
    expect(input).toEqual(snapshot)
  })
})

describe("formatSize", () => {
  test("bytes below 1KB stay in B", () => {
    expect(formatSize(0)).toBe("0 B")
    expect(formatSize(512)).toBe("512 B")
  })
  test("KB range uses one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB")
    expect(formatSize(1536)).toBe("1.5 KB")
    expect(formatSize(1024 * 1024 - 1)).toBe("1024.0 KB")
  })
})
