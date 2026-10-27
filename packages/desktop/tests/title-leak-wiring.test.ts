import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("WelcomeHome recent sessions carry formatted titles (no raw ISO / id fallback)", () => {
  const src = read("src/renderer/mafw/components/WelcomeHome.tsx")
  assert.match(src, /formatRailTitle\(s\.title\)/)
  assert.doesNotMatch(src, /title: s\.title \|\| s\.id/)
})

test("MafwShell tab-title choke points format (create + SSE retitle)", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const open = shell.match(/const openSessionTab[\s\S]*?\n  \}/)?.[0] ?? ""
  assert.match(open, /formatRailTitle\(/)
  const retitle = shell.match(/retitleOpenTab: \(id, title\) => \{[\s\S]*?\n      \}/)?.[0] ?? ""
  assert.match(retitle, /formatRailTitle\(/)
})
