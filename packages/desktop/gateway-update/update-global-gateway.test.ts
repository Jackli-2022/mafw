import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { compareVersions, decide, readPkgVersion } from "./update-global-gateway"

describe("compareVersions", () => {
  test("orders major/minor/patch", () => {
    expect(compareVersions("4.10.1", "4.9.9")).toBeGreaterThan(0)
    expect(compareVersions("4.10.0", "4.10.1")).toBeLessThan(0)
    expect(compareVersions("4.10.1", "4.10.1")).toBe(0)
  })
  test("missing segments equal zero", () => {
    expect(compareVersions("4.10", "4.10.0")).toBe(0)
  })
  test("non-numeric suffix does not crash", () => {
    expect(compareVersions("4.10.1-beta", "4.10.1")).toBe(0)
  })
})

describe("decide", () => {
  test("update only when global < bundled (never downgrade)", () => {
    expect(decide("4.10.1", "4.9.0")).toBe("update")
    expect(decide("4.10.1", "4.10.1")).toBe("skip")
    expect(decide("4.10.1", "4.11.0")).toBe("skip")
  })
  test("missing versions skip", () => {
    expect(decide(null, "4.9.0")).toBe("skip")
    expect(decide("4.10.1", null)).toBe("skip")
    expect(decide(null, null)).toBe("skip")
  })
})

describe("readPkgVersion", () => {
  test("reads version field", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    const pkg = join(dir, "package.json")
    writeFileSync(pkg, JSON.stringify({ name: "x", version: "4.10.1" }))
    expect(readPkgVersion(require("node:fs"), pkg)).toBe("4.10.1")
  })
  test("null on missing file or bad json or empty version", () => {
    const dir = mkdtempSync(join(tmpdir(), "gwupd-"))
    expect(readPkgVersion(require("node:fs"), join(dir, "absent.json"))).toBeNull()
    const bad = join(dir, "bad.json")
    writeFileSync(bad, "{oops")
    expect(readPkgVersion(require("node:fs"), bad)).toBeNull()
    const empty = join(dir, "empty.json")
    writeFileSync(empty, JSON.stringify({ name: "x" }))
    expect(readPkgVersion(require("node:fs"), empty)).toBeNull()
  })
})
