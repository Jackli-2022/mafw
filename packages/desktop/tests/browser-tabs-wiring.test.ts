import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (file: string) =>
  readFileSync(join(import.meta.dirname, "..", "src", "renderer", "mafw", "components", file), "utf8")

test("BrowserDock uses pill tabs and one pane per tab", () => {
  const src = read("BrowserDock.tsx")
  assert.match(src, /TabsV2/)
  assert.match(src, /variant="pill"/)
  assert.match(src, /TabsV2\.CloseButton/)
  assert.match(src, /onMiddleClick/)
  assert.match(src, /browserTabs\(\)/)
  assert.match(src, /Map<string, any>/)
  assert.match(src, /mafw-browser-tab-pane/)
  assert.doesNotMatch(src, /<TabsV2\.Content/)
})
