import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { quarantineUnreadableStore } from "./store-quarantine"

describe("quarantineUnreadableStore", () => {
  test("a parseable store is left alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-store-q-"))
    writeFileSync(join(dir, "settings"), '{"a":1}')
    expect(quarantineUnreadableStore(dir, "settings")).toBeNull()
    expect(readFileSync(join(dir, "settings"), "utf8")).toBe('{"a":1}')
  })

  test("a corrupt store is moved aside and reported", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-store-q-"))
    writeFileSync(join(dir, "notifications"), "not json at all")
    const moved = quarantineUnreadableStore(dir, "notifications", { now: () => 123 })
    expect(moved).toContain("notifications.corrupt-123")
    expect(existsSync(moved!)).toBe(true)
    expect(existsSync(join(dir, "notifications"))).toBe(false)
    // 原始字节保留（可人工恢复）。
    expect(readFileSync(moved!, "utf8")).toBe("not json at all")
  })

  test("a missing file is a no-op", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-store-q-"))
    expect(quarantineUnreadableStore(dir, "missing")).toBeNull()
  })
})
