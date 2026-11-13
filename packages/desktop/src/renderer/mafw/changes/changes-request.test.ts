import { test } from "node:test"
import assert from "node:assert/strict"
import { nextChangesRequest } from "./changes-request"

test("each request gets a strictly increasing seq", () => {
  const a = nextChangesRequest(null, { context: { kind: "project" }, section: "changes" })
  const b = nextChangesRequest(a, { context: { kind: "project" }, section: "review" })
  assert.equal(a.seq, 1)
  assert.equal(b.seq, 2)
  assert.equal(b.section, "review")
})
