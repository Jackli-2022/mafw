import { describe, expect, test } from "bun:test"
import { sortEntries, statusLabel, installableTypes, runtimeActivatable, parseAmbiguousCandidates, builtinMeta, type HubEntry } from "./plugin-hub"

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
