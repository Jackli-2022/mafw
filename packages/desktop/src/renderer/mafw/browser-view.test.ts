import { test } from "node:test"
import assert from "node:assert/strict"
import { createBrowserViewRegistry, navigateExistingView } from "./browser-view"

test("view registry stores, lists and removes views", () => {
  const registry = createBrowserViewRegistry<{ id: string }>()
  assert.equal(registry.get("tab-1"), null)
  registry.set("tab-1", { id: "tab-1" })
  registry.set("tab-2", { id: "tab-2" })
  assert.deepEqual(registry.get("tab-1"), { id: "tab-1" })
  assert.deepEqual(registry.keys(), ["tab-1", "tab-2"])
  registry.delete("tab-1")
  assert.equal(registry.get("tab-1"), null)
  assert.deepEqual(registry.keys(), ["tab-2"])
})

test("navigateExistingView loads even when url is unchanged", () => {
  const calls: string[] = []
  const view = { loadURL: (url: string) => calls.push(url) }
  assert.equal(navigateExistingView(view, "https://example.com/a"), true)
  assert.equal(navigateExistingView(view, "https://example.com/a"), true)
  assert.deepEqual(calls, ["https://example.com/a", "https://example.com/a"])
  assert.equal(navigateExistingView(null, "https://example.com"), false)
})
