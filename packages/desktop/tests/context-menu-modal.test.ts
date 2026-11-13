import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("context menus are non-modal so they cannot lock the app", () => {
  const host = read("src/renderer/mafw/context-menu/MenuHost.tsx")
  assert.match(host, /modal=\{false\}/)
})
