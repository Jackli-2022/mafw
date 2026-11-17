import { describe, expect, test } from "bun:test"
import { versionFile, type FsVersionIO } from "./fs-version"

const io = (content = Buffer.from("abc"), mtimeMs = 5, size?: number): FsVersionIO => ({
  stat: async () => ({ size: size ?? content.length, mtimeMs }),
  readFile: async () => content,
})

describe("fs version", () => {
  test("hashes file bytes and returns stat metadata", async () => {
    const result = await versionFile(io(), "C:/repo", "a.ts")
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.sha256).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    expect(result).toMatchObject({ size: 3, mtimeMs: 5 })
  })

  test("refuses traversal and oversized files", async () => {
    expect(await versionFile(io(), "C:/repo", "../secret")).toEqual({ ok: false, reason: "jail" })
    expect(await versionFile(io(Buffer.from("x"), 1, 33 * 1024 * 1024), "C:/repo", "big.bin"))
      .toEqual({ ok: false, reason: "too-large" })
  })

  test("maps missing files to not-found", async () => {
    const missing: FsVersionIO = {
      stat: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }) },
      readFile: async () => Buffer.alloc(0),
    }
    expect(await versionFile(missing, "C:/repo", "gone.ts")).toEqual({ ok: false, reason: "not-found" })
  })
})
