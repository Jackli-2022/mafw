import { test } from "node:test"
import assert from "node:assert/strict"
import { WORKBENCH_PAGE_IDS, WORKBENCH_PAGE_META, isStalePageActiveTab } from "./workbench-pages"

test("every page has a label and an icon", () => {
  for (const id of WORKBENCH_PAGE_IDS) {
    assert.ok(WORKBENCH_PAGE_META[id].label)
    assert.ok(WORKBENCH_PAGE_META[id].icon)
  }
  assert.equal(WORKBENCH_PAGE_META.config.label, "设置")
})

test("a restored page activeId is stale when no page focus backs it", () => {
  assert.equal(isStalePageActiveTab("scene:page:triage", [{ kind: "page", id: "triage" }]), false)
  assert.equal(isStalePageActiveTab("scene:page:triage", [{ kind: "world" }]), true)
  assert.equal(isStalePageActiveTab("scene:page:triage", []), true)
  assert.equal(isStalePageActiveTab("scene:world", []), false)
  assert.equal(isStalePageActiveTab(null, []), false)
})
