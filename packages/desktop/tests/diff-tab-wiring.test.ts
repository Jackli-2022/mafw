import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("document stage renders a diff pane and diff toolbar", () => {
  const stage = read("src/renderer/mafw/components/DocumentStage.tsx")
  assert.match(stage, /DiffDocumentView/)
  assert.match(stage, /activeKind\(\) === "diff"/)
  const view = read("src/renderer/mafw/components/DiffDocumentView.tsx")
  assert.match(view, /registerDocumentToolbar\("diff"/)
  assert.match(view, /DiffReviewPanel/)
})
