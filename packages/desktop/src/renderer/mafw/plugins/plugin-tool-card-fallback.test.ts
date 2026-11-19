// Presenter-only first-party cards (Wave 2 diff tools, later rich/MAFW cards)
// have no `render`. Plugin proxies must fall back to their ToolCard, not to
// GenericTool raw JSON.
import * as fs from "node:fs"
import { describe, expect, test } from "bun:test"

const read = (relative: string) => fs.readFileSync(new URL(relative, import.meta.url), "utf-8")
const unified = read("./PluginToolCard.tsx")
const legacy = read("../components/UserPluginCards.tsx")

describe("plugin card fallback for presenter-only entries", () => {
  test("unified proxy captures the original entry and renders its presentation", () => {
    expect(unified).toContain("ToolPresentationFallback")
    expect(unified).toContain("originalEntry")
    expect(unified).toContain("toolFallbackKind")
  })

  test("legacy proxy captures the original entry and renders its presentation", () => {
    expect(legacy).toContain("ToolPresentationFallback")
    expect(legacy).toContain("originalEntry")
    expect(legacy).toContain("toolFallbackKind")
  })
})
