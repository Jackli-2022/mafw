import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`./${path}`, import.meta.url), "utf8")

test("no split affordance remains in the workbench", () => {
  for (const file of [
    "components/WorkbenchShell.tsx",
    "components/WorldOverviewStage.tsx",
    "MafwShell.tsx",
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /contentSplit|onToggleSplit|onContentSplit|splitOpen/)
  }
})
