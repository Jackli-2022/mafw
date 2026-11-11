import { test } from "node:test"
import assert from "node:assert/strict"
import { frameView } from "./frame-view"

test("crumbs include world, scope, subject and optional anchor", () => {
  const view = frameView({
    worldName: "MAFW",
    scopeLabel: "Goal X · rev 3",
    subjectLabel: "src/a.ts",
    anchorLabel: "L5",
    scopeStartIndex: 2,
    subjectIndex: 4,
  })
  assert.deepEqual(view.crumbs.map((crumb) => crumb.label), ["MAFW", "Goal X · rev 3", "src/a.ts", "L5"])
  assert.deepEqual(view.crumbs.map((crumb) => crumb.kind), ["world", "scope", "subject", "anchor"])
  assert.deepEqual(view.crumbs.map((crumb) => crumb.stackIndex), [0, 2, 4, undefined])
})

test("badges are ordered and toned", () => {
  const view = frameView({
    worldName: "MAFW",
    scopeLabel: "Goal X · rev 3",
    subjectLabel: "src/a.ts",
    unresolved: 2,
    revision: 3,
    dirty: true,
    stale: true,
    external: true,
    verdict: "PASS",
  })
  assert.deepEqual(view.badges.map((badge) => badge.id), [
    "dirty",
    "stale",
    "unresolved",
    "revision",
    "external",
    "verdict",
  ])
  assert.equal(view.badges.find((badge) => badge.id === "dirty")?.tone, "amber")
  assert.equal(view.badges.find((badge) => badge.id === "stale")?.tone, "amber")
  assert.equal(view.badges.find((badge) => badge.id === "unresolved")?.tone, "red")
  assert.equal(view.badges.find((badge) => badge.id === "revision")?.tone, "neutral")
  assert.equal(view.badges.find((badge) => badge.id === "external")?.tone, "neutral")
  assert.equal(view.badges.find((badge) => badge.id === "verdict")?.tone, "green")
})

test("revision and unresolved labels are stable", () => {
  const view = frameView({
    worldName: "MAFW",
    scopeLabel: "项目文件",
    subjectLabel: "src/a.ts",
    unresolved: 2,
    revision: 3,
  })
  assert.deepEqual(view.badges.map((badge) => badge.label), ["2 unresolved", "rev 3"])
  assert.deepEqual(
    frameView({
      worldName: "MAFW",
      scopeLabel: "项目文件",
      subjectLabel: "src/a.ts",
      unresolved: 0,
    }).badges,
    [],
  )
})

test("verdict tone maps PASS to green and FAIL to red", () => {
  const pass = frameView({
    worldName: "MAFW",
    scopeLabel: "Goal X · rev 3",
    subjectLabel: "变更集",
    verdict: "PASS",
  })
  assert.equal(pass.badges[0]?.tone, "green")
  assert.equal(pass.badges[0]?.label, "PASS")

  const fail = frameView({
    worldName: "MAFW",
    scopeLabel: "Goal X · rev 3",
    subjectLabel: "变更集",
    verdict: "FAIL",
  })
  assert.equal(fail.badges[0]?.tone, "red")

  const other = frameView({
    worldName: "MAFW",
    scopeLabel: "Goal X · rev 3",
    subjectLabel: "变更集",
    verdict: "UNREVIEWED",
  })
  assert.equal(other.badges[0]?.tone, "neutral")
})
