import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("composer focus wiring", () => {
  test("ChatPane scroller click focuses composer with selection guards", () => {
    const pane = read("src/renderer/mafw/components/ChatPane.tsx")
    expect(pane).toContain("focusComposerFromView")
    expect(pane).toContain("shouldFocusComposerFromClick")
    expect(pane).toContain("onClick={focusComposerFromView}")
    expect(pane).toContain("focus({ preventScroll: true })")
    expect(pane).toContain('closest?.(')
  })
})
