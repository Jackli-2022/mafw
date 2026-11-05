import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")

test("ProjectResources Lore avatar fills its circular slot", () => {
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*width:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*height:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*border-radius:\s*50%/s)
  assert.match(css, /\.mafw-resource-avatar\s*\{[^}]*overflow:\s*hidden/s)
})
