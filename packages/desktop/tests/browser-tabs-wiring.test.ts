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
  assert.match(src, /onChange=\{/)
  assert.doesNotMatch(src, /onValueChange=/)
  assert.match(src, /TabsV2\.CloseButton/)
  assert.match(src, /onMiddleClick/)
  assert.match(src, /browserTabs\(\)/)
  assert.match(src, /createBrowserViewRegistry/)
  assert.match(src, /navigateExistingView/)
  assert.match(src, /mafw-browser-tab-pane/)
  assert.match(src, /TabsV2\.CloseButton[\s\S]{0,320}onPointerDown/)
  assert.match(src, /TabsV2\.CloseButton[\s\S]{0,480}onKeyDown/)
  assert.doesNotMatch(src, /<TabsV2\.Content/)
})
