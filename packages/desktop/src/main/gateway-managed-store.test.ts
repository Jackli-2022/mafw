import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  clearQuarantine,
  moveCurrentToPrevious,
  readCurrentPointer,
  readPreviousPointer,
  readQuarantine,
  writeCurrentPointer,
  writeQuarantine,
} from "./gateway-managed-store"

const pointer = {
  version: "5.2.0",
  payloadManifestSha256: "a".repeat(64),
  versionDir: "5.2.0-aaaaaaaaaaaa",
  installedAt: "2026-11-09T00:00:00.000Z",
}

const quarantine = {
  version: "5.2.0",
  payloadManifestSha256: "a".repeat(64),
  error: "native module failed",
  failedAt: "2026-11-09T00:00:00.000Z",
}

describe("gateway managed store", () => {
  test("writes current atomically and moves it to previous", async () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-managed-store-"))
    try {
      await writeCurrentPointer(root, pointer)
      expect(readCurrentPointer(root)).toEqual(pointer)
      await moveCurrentToPrevious(root)
      expect(readCurrentPointer(root)).toBeNull()
      expect(readPreviousPointer(root)).toEqual(pointer)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("malformed pointers read null", () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-managed-store-"))
    try {
      writeFileSync(join(root, "current.json"), "{bad")
      expect(readCurrentPointer(root)).toBeNull()
      expect(readPreviousPointer(root)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("quarantine round-trips and clears", async () => {
    const root = mkdtempSync(join(tmpdir(), "mafw-managed-store-"))
    try {
      await writeQuarantine(root, quarantine)
      expect(readQuarantine(root)).toEqual(quarantine)
      await clearQuarantine(root)
      expect(readQuarantine(root)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
