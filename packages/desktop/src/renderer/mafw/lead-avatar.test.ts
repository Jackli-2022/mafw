import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { memberAvatar, sessionPodRole } from "./lead-avatar"

describe("memberAvatar", () => {
  test("lead uses Lore", () => {
    assert.deepEqual(memberAvatar("lead", "Lead"), { kind: "lore" })
  })
  test("other roles keep initials", () => {
    assert.deepEqual(memberAvatar("tech_lead", "Tech Lead"), { kind: "initial", text: "T" })
    assert.deepEqual(memberAvatar("builder", "Builder"), { kind: "initial", text: "B" })
    assert.deepEqual(memberAvatar("reviewer", "Reviewer"), { kind: "initial", text: "R" })
  })
  test("empty display name falls back to ?", () => {
    assert.deepEqual(memberAvatar("builder", "  "), { kind: "initial", text: "?" })
  })
})

describe("sessionPodRole", () => {
  test("lead flag wins when Pod detail is not loaded", () => {
    assert.equal(sessionPodRole(null, true), "lead")
  })
  test("explicit role wins", () => {
    assert.equal(sessionPodRole("builder", false), "builder")
  })
  test("no role and no lead flag is null", () => {
    assert.equal(sessionPodRole(null, false), null)
  })
})
