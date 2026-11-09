import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(here, "components", "PodResultView.tsx"), "utf-8")

describe("PodResultView branch diff wiring", () => {
  test("loads the worktree diff only through the gateway API", () => {
    assert.match(source, /window\.api\.mafw\.pod\.worktreeDiff\(/)
    assert.match(source, /podResultCanViewDiff/)
  })

  test("renders the read-only diff panel instead of a second implementation", () => {
    assert.match(source, /DiffReviewPanel/)
    assert.match(source, /previewOnly/)
    assert.match(source, /allowSessionFallback=\{false\}/)
  })

  test("offers the preview action in the result body", () => {
    assert.match(source, /查看分支差异/)
  })
})
