import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { normalizeLeftDockFace } from "../src/renderer/mafw/left-dock"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

const strip = read("src/renderer/mafw/components/ProjectTeamStrip.tsx")
const leftDock = read("src/renderer/mafw/components/LeftDock.tsx")
const rail = read("src/renderer/mafw/components/IconRail.tsx")
const work = read("src/renderer/mafw/components/WorldOverviewStage.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")

test("project team strip exposes contacts, team resources and empty states", () => {
  assert.match(strip, /buildPodContacts/)
  assert.match(strip, /podStatusLabel/)
  assert.match(strip, /mafw-project-team-strip/)
  assert.match(strip, /onOpenLead/)
  assert.match(strip, /onOpenTechLead/)
  assert.match(strip, /onOpenPanel\("team", "members"\)/)
  assert.match(strip, /onOpenPanel\("team", "inbox"\)/)
  assert.match(strip, /onOpenPanel\("memory"\)/)
  assert.match(strip, /团队/)
  assert.match(strip, /邮箱/)
  assert.match(strip, /记忆/)
  assert.match(strip, /创建团队/)
  assert.match(strip, /worktree/)
  assert.match(strip, /gateway/)
})

test("project home mounts the team strip and focuses it on request", () => {
  assert.match(work, /ProjectTeamStrip/)
  assert.match(work, /teamFocusRequest/)
  assert.match(work, /scrollIntoView/)
  assert.match(shell, /const openProjectTeam/)
  assert.match(shell, /teamFocusRequest/)
  assert.match(shell, /team=\{\{/)
  assert.match(shell, /onTeam=/)
})

test("the left dock no longer owns a Pod face", () => {
  assert.doesNotMatch(leftDock, /ProjectResources/)
  assert.doesNotMatch(leftDock, /face === "pod"/)
  assert.doesNotMatch(leftDock, /onPodOpen/)
  assert.equal(normalizeLeftDockFace("pod"), "sessions")
  assert.equal(normalizeLeftDockFace("notes"), "notes")
  assert.equal(normalizeLeftDockFace("bogus"), "sessions")
})

test("the rail exposes a team shortcut instead of a Pod face toggle", () => {
  assert.match(rail, /key: "team"/)
  assert.match(rail, /onTeam/)
  assert.match(rail, /团队/)
  assert.doesNotMatch(rail, /onToggleFace\("pod"\)/)
  assert.match(rail, /podBadge/)
  assert.match(rail, /podResultDot/)
})
