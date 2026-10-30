import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { retitleTab } from "./session-tab-title"

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
