import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("discussion diff review opens the changes face", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /openChangesFace/)
  assert.match(shell, /nextChangesRequest/)
  assert.match(shell, /onOpenDiffReview=\{openCurrentSessionChangeSet\}/)
})

test("changes face consumes deep-link requests", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /lastRequestSeq/)
  assert.match(face, /request\.seq <= lastRequestSeq/)
  assert.match(face, /request\.section !== "review"/)
})
