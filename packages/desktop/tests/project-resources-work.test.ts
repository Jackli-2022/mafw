import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const resources = read("src/renderer/mafw/components/ProjectResources.tsx")
const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("ProjectResources exposes attention without an empty zero block", () => {
  assert.match(resources, /attention: number/)
  assert.match(resources, /onOpenWork: \(\) => void/)
  assert.match(resources, /podAttentionRow\(props.attention\)/)
  assert.match(resources, /Show when=\{attention\(\)\.visible\}/)
  assert.match(resources, /onClick=\{\(\) => props\.onOpenWork\(\)\}/)
})

test("ProjectResources previews at most three recent messages and keeps the inbox route", () => {
  assert.match(resources, /buildRecentMessages\(props\.detail, props\.messages, props\.selfMemberId, Date\.now\(\), 3\)/)
  assert.match(resources, /最近消息/)
  assert.match(resources, /onOpenPanel\("team", "inbox"\)/)
  assert.match(resources, /classList=\{\{ unread: message\.unread \}\}/)
  assert.doesNotMatch(resources, /podRecentMessages/)
  assert.doesNotMatch(resources, /message\.readAt === null/)
})

test("the active-Goal shortcut is retired from the left Pod face", () => {
  assert.doesNotMatch(resources, /mafw-resources-goal/)
  assert.doesNotMatch(resources, /当前目标/)
})

test("the Pod face is not a global tool catalog", () => {
  assert.doesNotMatch(resources, /PAGE_LINKS/)
  assert.doesNotMatch(resources, /onNavigate/)
  assert.doesNotMatch(resources, />工具</)
})

test("MafwShell routes Pod attention into the right work face", () => {
  assert.match(shell, /podAttention=\{podBadgeCount\(\)\}/)
  assert.match(shell, /onPodOpenWork=\{openProjectWork\}/)
  assert.match(leftDock, /attention=\{props\.podAttention \?\? 0\}/)
  assert.match(leftDock, /onOpenWork=\{\(\) => props\.onPodOpenWork\?\.\(\)\}/)
})
