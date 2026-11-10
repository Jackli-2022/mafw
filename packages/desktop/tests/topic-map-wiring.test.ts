import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const shell = read("../src/renderer/mafw/MafwShell.tsx")
const panel = read("../src/renderer/mafw/components/TopicIndexPanel.tsx")

test("topic map exposes fork and boundary actions without session ids", () => {
  assert.match(panel, /onFork/)
  assert.match(panel, /边界/)
  assert.match(panel, /检测到新话题/)
  assert.match(shell, /lead\.topics\.fork|forkTopic/)
  assert.match(shell, /boundaries\[action\]/)
  assert.doesNotMatch(panel, /ses_[a-zA-Z0-9]+/)
})
