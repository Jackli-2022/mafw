// Final review B finding 3 (session-ui side): tool cards now receive the
// normalized settled-part error via ToolProps so a card that opts into error
// rendering (`handlesError: true`) can show the reason instead of a bare title.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const source = readFileSync(new URL("./message-part.tsx", import.meta.url), "utf8")

describe("ToolProps.error wiring", () => {
  test("ToolProps exposes the settled part error", () => {
    const start = source.indexOf("export interface ToolProps")
    expect(start).toBeGreaterThanOrEqual(0)
    const block = source.slice(start, source.indexOf("}", start) + 1)
    expect(block).toContain("error?: string")
  })

  test("ToolPartDisplay forwards the normalized error to the rendered card", () => {
    expect(source).toContain("error={errorText(part().state.error)}")
  })
})
