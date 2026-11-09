import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { stripStoreFileBom } from "./store-bom"

describe("store BOM recovery", () => {
  test("strips a UTF-8 BOM and leaves the JSON intact", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-store-bom-"))
    const file = join(dir, "mafw.gateway")
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"source":"managed"}')]))

    expect(stripStoreFileBom(dir, "mafw.gateway")).toBe(true)
    expect(readFileSync(file).toString("utf8")).toBe('{"source":"managed"}')
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ source: "managed" })
  })

  test("leaves a clean file and a missing file alone", () => {
    const dir = mkdtempSync(join(tmpdir(), "mafw-store-bom-"))
    const file = join(dir, "clean")
    writeFileSync(file, "{\"a\":1}")
    expect(stripStoreFileBom(dir, "clean")).toBe(false)
    expect(readFileSync(file, "utf8")).toBe("{\"a\":1}")
    expect(stripStoreFileBom(dir, "missing")).toBe(false)
  })
})
