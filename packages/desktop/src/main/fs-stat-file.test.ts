import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { statFile } from "./fs-workspace"

const okIo = (size: number, mtimeMs: number) => ({
  readdir: async () => [],
  readFile: async () => Buffer.from(""),
  writeFile: async () => {},
  stat: async () => ({ size, mtimeMs }),
})

describe("statFile（图片预览元数据，2026-10-27）", () => {
  test("合法 rel → size + mtime", async () => {
    const res = await statFile(okIo(2048, 123) as any, "C:/proj", "assets/a.png")
    assert.deepEqual(res, { ok: true, size: 2048, mtimeMs: 123 })
  })
  test("越界 / 绝对路径 → jail（不泄露细节）", async () => {
    assert.deepEqual(await statFile(okIo(1, 1) as any, "C:/proj", "../a.png"), { ok: false, reason: "jail" })
    assert.deepEqual(await statFile(okIo(1, 1) as any, "C:/proj", "C:/Windows/win.ini"), { ok: false, reason: "jail" })
  })
  test("ENOENT → not-found；其他错误 → io", async () => {
    const enoent = () => {
      const e: any = new Error("nope")
      e.code = "ENOENT"
      return e
    }
    const ioNotFound = { ...okIo(1, 1), stat: async () => { throw enoent() } }
    const ioError = { ...okIo(1, 1), stat: async () => { throw new Error("boom") } }
    assert.deepEqual(await statFile(ioNotFound as any, "C:/proj", "a.png"), { ok: false, reason: "not-found" })
    assert.deepEqual(await statFile(ioError as any, "C:/proj", "a.png"), { ok: false, reason: "io" })
  })
})
