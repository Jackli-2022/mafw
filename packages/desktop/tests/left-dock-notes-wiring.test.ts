import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("notes opens as a left-dock face, not a right rail", () => {
  const rail = read("src/renderer/mafw/components/IconRail.tsx")
  const left = read("src/renderer/mafw/components/LeftDock.tsx")
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const css = read("src/renderer/mafw/mafw.css")

  assert.match(rail, /"notes"/)
  assert.match(rail, /label:\s*"工作/)
  assert.doesNotMatch(rail, /key:\s*"new"/)
  assert.match(left, /NotesDock/)
  assert.match(left, /face === "notes"/)
  assert.match(left, /onNewSession/)
  assert.match(shell, /onNewSession=\{/)
  assert.match(css, /\.mafw-left-dock-notes\s*\{/)
})
