import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const priority = read("../src/renderer/mafw/components/WorkPriorityList.tsx")
const project = read("../src/renderer/mafw/components/WorldOverviewStage.tsx")

test("attention panel is person-first and reuses the priority cards", () => {
  assert.match(project, /buildAttentionList\(/)
  assert.match(priority, /需要你处理/)
  assert.match(priority, /现在没有需要你处理的事项/)
  assert.match(priority, /attention/)
  assert.doesNotMatch(priority, /ses_[a-zA-Z0-9]+/)
})
