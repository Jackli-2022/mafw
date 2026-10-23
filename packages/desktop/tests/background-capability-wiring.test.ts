import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("background REST capability wiring", () => {
  test("capability module exposes tri-state + 60s retry", () => {
    const src = read("src/renderer/mafw/background-capability.ts")
    expect(src).toContain("createRestProbe")
    expect(src).toContain("createRuntimeProbe")
    expect(src).toContain('"checking"')
    expect(src).toContain("60_000")
    expect(src).toContain("shouldShowRestUnavailableHint")
  })

  test("dock and work bar use the tri-state and hint", () => {
    const dock = read("src/renderer/mafw/components/BackgroundDock.tsx")
    expect(dock).toContain("probeBackgroundRest")
    expect(dock).toContain("60_000")
    expect(dock).toContain("shouldShowRestUnavailableHint")
    expect(dock).toContain("outputPlaceholder")
    expect(dock).toContain('restState() === "available"')

    const bar = read("src/renderer/mafw/components/BackgroundWorkBar.tsx")
    expect(bar).toContain("probeBackgroundRest")
    expect(bar).toContain("shouldShowRestUnavailableHint")
    expect(bar).toContain('restState() === "available"')
  })
})
