import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("shell routes pod.updated, project scope, sessions, goals, and badges", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  // Task 21：结果事件先走结果处理（刷新后通知/记录待打开），其余仍由 ingestPodEvent
  // 负责通用刷新；两者都在 pod:onEvent 内，别的接线点零改动。
  assert.match(shell, /pod:\s*\{[\s\S]{0,600}?ingestPodEvent\(event\)/)
  assert.match(shell, /podResultEvent\(event\)/)
  assert.match(shell, /projectDir=\{benchRoot\(\)/)
  assert.match(shell, /onOpenPodSession=\{\(sid, title\) => openPodSession\(sid, title\)\}/)
  assert.match(shell, /podRoleOf=\{/)
  assert.match(shell, /<GoalDetailOverlay/)
  assert.match(shell, /setPodGoalId/)
})

test("execution view renders PodDock in its own section", () => {
  const src = read("src/renderer/mafw/components/ExecutionView.tsx")
  assert.match(src, /<PodDock/)
  assert.match(src, /section === "pod"/)
  assert.match(src, /active=\{props\.section === "pod"\}/)
  assert.match(src, /onOpenPodSession: \(id: string, title\?: string\) => void/)
})

test("SessionStrip accepts a pod role accessor and renders a badge", () => {
  const src = read("src/renderer/mafw/components/SessionStrip.tsx")
  assert.match(src, /podRoleOf/)
  assert.match(src, /mafw-session-pod-badge/)
})
