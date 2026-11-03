import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const src = readFileSync(new URL("./mafw-api.ts", import.meta.url), "utf8")
const types = readFileSync(new URL("./mafw-types.ts", import.meta.url), "utf8")

describe("preload voice namespace", () => {
  test("exposes voice status and wsUrl without renderer URL assembly", () => {
    expect(src).toMatch(/voice:\s*\{/)
    expect(src).toContain('status: () => invoke("voice", "status")')
    expect(src).toContain('wsUrl: () => invoke("voice", "wsUrl")')
  })

  test("declares the same two methods in the typed API surface", () => {
    expect(types).toMatch(/voice:\s*\{/)
    expect(types).toContain("status: () => Promise<VoiceStatusResponse>")
    expect(types).toContain("wsUrl: () => Promise<string>")
  })
})
