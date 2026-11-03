import { test } from "node:test"
import assert from "node:assert/strict"
import { dropOtherLeadTabs, mergeTabIdentity } from "./session-tab-identity"

test("merging identity upgrades an existing role-less tab in place", () => {
  const tabs = [{ id: "s1", title: "Chat 1" }]
  const out = mergeTabIdentity(tabs, "s1", true, { mafw: { role: "lead" } })
  assert.deepEqual(out, [{
    id: "s1",
    title: "Chat 1",
    lead: true,
    metadata: { mafw: { role: "lead" } },
  }])
  assert.deepEqual(tabs, [{ id: "s1", title: "Chat 1" }])
})

test("merging identity only applies provided fields and leaves other tabs alone", () => {
  const tabs = [
    { id: "s1", title: "A", lead: false },
    { id: "s2", title: "B" },
  ]
  assert.deepEqual(mergeTabIdentity(tabs, "s1", true), [
    { id: "s1", title: "A", lead: true },
    { id: "s2", title: "B" },
  ])
  assert.deepEqual(mergeTabIdentity(tabs, "s2", undefined, { mafw: { role: "tech_lead" } })[1], {
    id: "s2",
    title: "B",
    metadata: { mafw: { role: "tech_lead" } },
  })
})

test("replacing Lead drops stale lead tabs so only one remains", () => {
  const tabs = [
    { id: "old", title: "Lead", lead: true },
    { id: "other", title: "Chat" },
    { id: "archived", title: "Lead", lead: false, metadata: { mafw: { role: "lead" } } },
  ]
  assert.deepEqual(dropOtherLeadTabs(tabs, "new").map((tab) => tab.id), ["other"])
})
