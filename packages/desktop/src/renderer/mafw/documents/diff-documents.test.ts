import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import {
  activeDiffDocumentId,
  closeDiffDocument,
  diffDocuments,
  openDiffDocument,
  resetDiffDocumentsForTests,
  setActiveDiffDocument,
  updateDiffDocument,
} from "./diff-documents"

const base = {
  source: { kind: "session" as const, sessionID: "s1" },
  root: "C:/repo",
  scope: { kind: "world" as const, worldId: "C:/repo" },
  rel: "src/a.ts",
  patch: "@@ -1 +1 @@\n-a\n+b",
  additions: 1,
  deletions: 1,
}

beforeEach(() => resetDiffDocumentsForTests())

test("opening the same source+rel updates instead of duplicating", () => {
  const first = openDiffDocument(base)
  const second = openDiffDocument({ ...base, patch: "@@ -1 +1 @@\n-a\n+c", additions: 1, deletions: 1 })
  assert.equal(diffDocuments().length, 1)
  assert.equal(first.id, second.id)
  assert.match(second.patch, /\+c/)
  assert.equal(activeDiffDocumentId(), second.id)
})

test("closing the active diff falls back to the left neighbor", () => {
  const a = openDiffDocument(base)
  const b = openDiffDocument({ ...base, rel: "src/b.ts" })
  setActiveDiffDocument(b.id)
  closeDiffDocument(b.id)
  assert.equal(activeDiffDocumentId(), a.id)
})

test("update only changes the requested fields", () => {
  const doc = openDiffDocument(base)
  updateDiffDocument(doc.id, { anchorLine: 12 })
  assert.equal(diffDocuments()[0]!.anchorLine, 12)
  assert.equal(diffDocuments()[0]!.patch, base.patch)
})
