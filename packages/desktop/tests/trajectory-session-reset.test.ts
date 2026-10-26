import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("trajectory resets and guards responses when the session changes", () => {
  const src = read("src/renderer/mafw/components/TrajectoryDock.tsx")
  assert.match(src, /setApiEvents\(\[\]\)/)
  assert.match(src, /setApiTurns\(\[\]\)/)
  assert.match(src, /const sid = props\.sessionID/)
  assert.match(src, /props\.sessionID !== sid/)
})
