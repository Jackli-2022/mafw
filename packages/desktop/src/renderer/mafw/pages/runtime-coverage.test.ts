import { describe, expect, test } from "bun:test"
import { runtimeCoverageSummary } from "./runtime-coverage"

function rtWith(staticCoverage: any) {
  return { active: { name: "pi", coverage: { static: staticCoverage } } }
}

describe("runtimeCoverageSummary", () => {
  test("no coverage (old gateway / external) → null", () => {
    expect(runtimeCoverageSummary(null)).toBeNull()
    expect(runtimeCoverageSummary({ active: { name: "pi" } })).toBeNull()
  })

  test("complete declared coverage → ok label without warning mark", () => {
    const s = runtimeCoverageSummary(rtWith({
      presets: { conversation: { required: 35, covered: 35, missing: [] } },
      translation: { mode: "declared", note: "" },
    }))
    expect(s).toEqual({ label: "覆盖 35/35（conversation） · 翻译 declared", tone: "ok" })
  })

  test("missing surfaces → warn", () => {
    const s = runtimeCoverageSummary(rtWith({
      presets: { conversation: { required: 35, covered: 3, missing: ["events.global"] } },
      translation: { mode: "declared", note: "" },
    }))!
    expect(s.tone).toBe("warn")
    expect(s.label).toContain("3/35")
    expect(s.label.startsWith("⚠️")).toBe(true)
  })

  test("self / legacy-self translation → warn even with full coverage", () => {
    for (const mode of ["self", "legacy-self"]) {
      const s = runtimeCoverageSummary(rtWith({
        presets: { conversation: { required: 35, covered: 35, missing: [] } },
        translation: { mode, note: "x" },
      }))!
      expect(s.tone).toBe("warn")
      expect(s.label).toContain(mode)
    }
  })

  test("translation only (no preset data) still renders", () => {
    const s = runtimeCoverageSummary(rtWith({ translation: { mode: "declared", note: "" } }))!
    expect(s.label).toBe("翻译 declared")
    expect(s.tone).toBe("ok")
  })
})
