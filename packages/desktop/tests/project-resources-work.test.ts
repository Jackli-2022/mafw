import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const resources = read("src/renderer/mafw/components/ProjectResources.tsx")
const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
const iconRail = read("src/renderer/mafw/components/IconRail.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("the left Pod is a Lead / Tech Lead launcher, not a roster", () => {
  assert.match(resources, /buildPodContacts/)
  assert.match(resources, /onOpenLead/)
  assert.match(resources, /onOpenTechLead/)
  assert.match(resources, /row\.displayName/)
  assert.doesNotMatch(resources, /buildRecentMessages/)
  assert.doesNotMatch(resources, /最近消息/)
  assert.doesNotMatch(resources, /memberFocus\(/)
  assert.doesNotMatch(resources, /Builder/)
  assert.doesNotMatch(resources, /Reviewer/)
})

test("both contacts reuse ordinary sessions and never add a send path", () => {
  assert.match(resources, /props\.onOpenLead\(\)/)
  assert.match(resources, /props\.onOpenTechLead\(row\.goalId\)/)
  assert.match(resources, /disabled=\{!row\.canOpen\}/)
  assert.doesNotMatch(resources, /promptAsync/)
  assert.doesNotMatch(resources, /textarea/i)
  assert.doesNotMatch(resources, /sendMessage/)
})

test("attention and New Goal remain direct actions", () => {
  assert.match(resources, /attention: number/)
  assert.match(resources, /podAttentionRow\(props\.attention\)/)
  assert.match(resources, /Show when=\{attention\(\)\.visible\}/)
  assert.match(resources, /onClick=\{\(\) => props\.onOpenWork\(\)\}/)
  assert.match(resources, /onClick=\{props\.onCreate\}/)
  assert.match(resources, />\s*新建 Goal\s*</)
})

test("team, inbox, Pod memory and notes live behind the secondary resource toggle", () => {
  assert.match(resources, /团队、邮箱与共享记忆/)
  assert.match(resources, /onOpenPanel\("team", "members"\)/)
  assert.match(resources, /onOpenPanel\("team", "inbox"\)/)
  assert.match(resources, /onOpenPanel\("memory"\)/)
  assert.match(resources, /onOpenNotes/)
})

test("the Pod face title and subtitle describe its real job", () => {
  assert.match(resources, /mafw-pod-rail-title">Pod</)
  assert.match(resources, /和 Lead、Tech Lead 讨论/)
  assert.doesNotMatch(resources, /项目资源<\/span>/)
  assert.doesNotMatch(resources, /工作空间/)
})

test("LeftDock and MafwShell route both contacts through existing session entry points", () => {
  assert.match(leftDock, /onPodOpenLead/)
  assert.match(leftDock, /onPodOpenTechLead/)
  assert.match(leftDock, /onOpenLead=\{\(\) => props\.onPodOpenLead\?\.\(\)\}/)
  assert.match(leftDock, /onOpenTechLead=\{\(goalId\) => props\.onPodOpenTechLead\?\.\(goalId\)\}/)
  assert.match(shell, /onPodOpenLead=\{\(\) => \{ void openLeadEntry\(\) \}\}/)
  assert.match(shell, /onPodOpenTechLead=\{\(goalId\) => \{ void openTechLead\(goalId\) \}\}/)
})

test("IconRail calls the destination Pod and keeps its badge wiring", () => {
  assert.match(iconRail, /props\.face === "pod" \? "收起 Pod" : "Pod"/)
  assert.match(iconRail, /badge: props\.podBadge/)
  assert.match(iconRail, /resultDot: !!props\.podResultDot/)
  assert.doesNotMatch(iconRail, /"收起资源" \| "资源"/)
})

test("MafwShell no longer passes the retired roster/message props", () => {
  assert.doesNotMatch(shell, /podMessages=\{podStore\.messages\(\)\}/)
  assert.doesNotMatch(shell, /podSelfMemberId=\{podSelfMemberId\(\)\}/)
  assert.doesNotMatch(shell, /podSessionTitleOf=\{podSessionTitleOf\}/)
})
