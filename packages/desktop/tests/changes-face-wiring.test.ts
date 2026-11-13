import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")

test("left dock exposes a changes face", () => {
  const dock = read("src/renderer/mafw/left-dock.ts")
  assert.match(dock, /"changes"/)
  const rail = read("src/renderer/mafw/components/IconRail.tsx")
  assert.match(rail, /key: "changes"/)
  assert.match(rail, /changesBadge/)
  const left = read("src/renderer/mafw/components/LeftDock.tsx")
  assert.match(left, /renderChanges/)
})

test("changes face reuses the change tree and has a mode selector", () => {
  const face = read("src/renderer/mafw/components/ChangesFace.tsx")
  assert.match(face, /buildChangeTree/)
  assert.match(face, /resolveChangesContext|ChangesContext/)
})

test("changes mode is declared before the memos that read it", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  const modeDecl = shell.indexOf("const [changesMode, setChangesMode]")
  const memo = shell.indexOf("const changesAvailableModes = createMemo")
  assert.ok(modeDecl > 0)
  assert.ok(memo > 0)
  assert.ok(modeDecl < memo, "changesMode must be initialized before createMemo")
})
