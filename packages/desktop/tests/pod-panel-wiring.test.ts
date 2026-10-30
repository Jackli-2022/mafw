import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

test("shell routes pod.updated, project scope, sessions, goals, and badges", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /pod:\s*\{\s*onEvent:\s*\(event\)\s*=>\s*ingestPodEvent/)
  assert.match(shell, /projectDir=\{benchRoot\(\)/)
  assert.match(shell, /onOpenPodSession=\{\(sid, title\) => openSessionTab\(sid, title\)\}/)
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
