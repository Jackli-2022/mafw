import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("background capability wiring (neutral jobs façade)", () => {
  test("capability module exposes tri-state + 60s retry from Experience", () => {
    const src = read("src/renderer/mafw/background-capability.ts")
    expect(src).toContain("createAvailabilityProbe")
    expect(src).toContain("createActionProbe")
    expect(src).toContain('"checking"')
    expect(src).toContain("60_000")
    expect(src).toContain("shouldShowBackgroundUnavailableHint")
    expect(src).toContain('experienceStore.action(id)')
    // 不再探测 /api/shell 原生面。
    expect(src).not.toContain("shells.list")
    expect(src).not.toContain("probeBackgroundRest")
  })

  test("dock and work bar consume the neutral state and hints", () => {
    const dock = read("src/renderer/mafw/components/BackgroundDock.tsx")
    expect(dock).toContain("probeBackgroundApi")
    expect(dock).toContain("60_000")
    expect(dock).toContain("shouldShowBackgroundUnavailableHint")
    expect(dock).toContain("outputPlaceholder")
    expect(dock).toContain('apiState() === "available"')
    expect(dock).toContain("background.jobs.output")
    expect(dock).toContain("background.jobs.cancel")
    expect(dock).toContain("background.jobs.list")
    expect(dock).not.toContain("/api/shell")

    const bar = read("src/renderer/mafw/components/BackgroundWorkBar.tsx")
    expect(bar).toContain("canUseBackgroundApi")
    expect(bar).toContain("onBackgroundTerminal")
    expect(bar).not.toContain("probeBackgroundRest")
    expect(bar).not.toContain("shells.")
  })
})
