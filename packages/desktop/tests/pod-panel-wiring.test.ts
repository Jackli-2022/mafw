import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { goalSessionIdentity, reconcileGoalSessionTabs } from "../src/renderer/mafw/pod-model"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const detail = {
  pod: { id: "pod_1", projectDir: "/project", name: "Project" },
  members: [
    { id: "m_lead", role: "lead", displayName: "Lead" },
    { id: "m_tl", role: "tech_lead", displayName: "Tech Lead" },
    { id: "m_b", role: "builder", displayName: "Builder" },
    { id: "m_r", role: "reviewer", displayName: "Reviewer" },
  ],
  goals: [{ goalId: "g1", title: "修复登录", activeRevision: 2, revision: 2 }],
  tasks: [],
  sessions: [
    { id: "ps1", podId: "pod_1", memberId: "m_b", goalId: "g1", node: "execute", sessionId: "ses_b", status: "done", transcriptRef: "ref", createdAt: "t", endedAt: "t2", scopeKind: "implementation" },
    { id: "ps2", podId: "pod_1", memberId: "m_r", goalId: "g1", node: "review", sessionId: "ses_r", status: "done", transcriptRef: "ref", createdAt: "t", endedAt: "t2", scopeKind: "review" },
    { id: "ps3", podId: "pod_1", memberId: "m_tl", goalId: "g1", node: "discussion", sessionId: "ses_tl", status: "active", transcriptRef: null, createdAt: "t", endedAt: null, scopeKind: "discussion" },
    { id: "ps4", podId: "pod_1", memberId: "m_b", goalId: "g1", node: "execute", sessionId: "ses_live", status: "active", transcriptRef: null, createdAt: "t", endedAt: null, scopeKind: "implementation" },
  ],
  messages: [],
} as any

test("Goal sessions get one Goal/revision/role identity from every entry", () => {
  assert.deepEqual(goalSessionIdentity(detail, "ses_b"), {
    role: "builder",
    goalId: "g1",
    revision: 2,
    title: "Builder · 修复登录 · rev 2",
    ended: true,
    transcript: true,
  })
  assert.equal(goalSessionIdentity(detail, "ses_r")?.title, "Reviewer · 修复登录 · rev 2")
  assert.equal(goalSessionIdentity(detail, "ses_tl")?.title, "Tech Lead · 修复登录 · rev 2")
  assert.equal(goalSessionIdentity(detail, "ses_live")?.transcript, false)
  assert.equal(goalSessionIdentity(detail, "ses_missing"), null)
  assert.equal(goalSessionIdentity(null, "ses_b"), null)
})

test("already-open tabs are upgraded in place and stable input returns the same array", () => {
  const tabs = [
    { id: "ses_b", title: "Chat 4" },
    { id: "ses_free", title: "Chat 5" },
    { id: "ses_live", title: "我的自定义标题" },
  ]
  const next = reconcileGoalSessionTabs(tabs, detail)
  assert.equal(next[0].title, "Builder · 修复登录 · rev 2")
  assert.equal(next[0].metadata?.mafw?.role, "builder")
  assert.equal(next[1], tabs[1])
  assert.equal(next[2].title, "我的自定义标题")
  assert.equal(next[2].metadata?.mafw?.role, "builder")
  assert.equal(reconcileGoalSessionTabs(next, detail), next)
})

test("shell opens ended Goal sessions as transcripts and reuses tab identity", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /goalSessionIdentity\(/)
  assert.match(shell, /reconcileGoalSessionTabs\(/)
  assert.match(shell, /identity\?\.ended/)
  assert.match(shell, /openPodTranscript\(/)
  assert.match(shell, /mergeTabIdentity\(prev, sid, lead, metadata, title\)/)
})

test("shell routes pod.updated, project scope, sessions, goals, and badges", () => {
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  // Task 21：结果事件先走结果处理（刷新后通知/记录待打开），其余仍由 ingestPodEvent
  // 负责通用刷新；两者都在 pod:onEvent 内，别的接线点零改动。
  assert.match(shell, /pod:\s*\{[\s\S]{0,600}?ingestPodEvent\(event\)/)
  assert.match(shell, /podResultEvent\(event\)/)
  assert.match(shell, /projectDir=\{benchRoot\(\)/)
  assert.match(shell, /onOpenPodSession=\{\(sid, title\) => \{ void openPodSession\(sid, title\) \}\}/)
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
