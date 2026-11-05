import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { retitleTab, shouldRetitleTab } from "./session-tab-title"

describe("retitleTab", () => {
  test("updates an existing tab when a concrete title arrives", () => {
    const tabs = [{ id: "s1", title: "Chat 3" }, { id: "s2", title: "Other" }]
    assert.deepEqual(retitleTab(tabs, "s1", "Pod · Lead"), [
      { id: "s1", title: "Pod · Lead" },
      { id: "s2", title: "Other" },
    ])
  })

  test("keeps the current title for blank/missing input and identical titles", () => {
    const tabs = [{ id: "s1", title: "Chat 3" }]
    assert.equal(retitleTab(tabs, "s1", "   "), tabs)
    assert.equal(retitleTab(tabs, "s1", undefined), tabs)
    assert.equal(retitleTab(tabs, "s1", "Chat 3"), tabs)
  })
})

describe("shouldRetitleTab", () => {
  test("ordinary tabs accept a concrete runtime title", () => {
    assert.equal(shouldRetitleTab({ id: "s1", title: "Chat 3" }, "新建会话"), true)
  })

  test("role-named tabs (Lead) never take a runtime title", () => {
    assert.equal(shouldRetitleTab({ id: "s1", title: "Lead", lead: true }, "冒烟: quick eval"), false)
    assert.equal(
      shouldRetitleTab({ id: "s1", title: "Lead", metadata: { mafw: { role: "lead" } } }, "冒烟: quick eval"),
      false,
    )
  })

  test("blank runtime titles leave every tab alone", () => {
    assert.equal(shouldRetitleTab({ id: "s1", title: "Chat 3" }, "  "), false)
    assert.equal(shouldRetitleTab(undefined, "新建会话"), false)
  })
})
