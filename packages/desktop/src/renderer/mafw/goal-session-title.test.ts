import { test } from "node:test"
import assert from "node:assert/strict"
import { goalSessionTabTitle } from "./goal-session-title"

test("goalSessionTabTitle identifies Goal, revision and role", () => {
  assert.equal(
    goalSessionTabTitle({ goalTitle: "修复登录", revision: 1, role: "builder" }),
    "Builder · 修复登录 · rev 1",
  )
  assert.equal(
    goalSessionTabTitle({ goalTitle: "修复登录", revision: 2, role: "reviewer" }),
    "Reviewer · 修复登录 · rev 2",
  )
  assert.equal(
    goalSessionTabTitle({ goalTitle: "修复登录", revision: 1, role: "tech_lead" }),
    "Tech Lead · 修复登录",
  )
  assert.equal(
    goalSessionTabTitle({ goalTitle: "修复登录", revision: 3, role: "tech_lead" }),
    "Tech Lead · 修复登录 · rev 3",
  )
})

test("goalSessionTabTitle distinguishes different Goals and survives missing titles", () => {
  assert.notEqual(
    goalSessionTabTitle({ goalTitle: "A", revision: 1, role: "builder" }),
    goalSessionTabTitle({ goalTitle: "B", revision: 1, role: "builder" }),
  )
  assert.equal(
    goalSessionTabTitle({ goalTitle: " ", revision: 1, role: "builder" }),
    "Builder · 未命名目标 · rev 1",
  )
  assert.equal(
    goalSessionTabTitle({ goalTitle: "A", revision: 0, role: "builder" }),
    "Builder · A · rev 1",
  )
})
