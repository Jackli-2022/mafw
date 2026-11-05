import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
const sessionStrip = readFileSync(new URL("./components/SessionStrip.tsx", import.meta.url), "utf8")
const projectResources = readFileSync(new URL("./components/ProjectResources.tsx", import.meta.url), "utf8")

test("ProjectResources Lore avatar fills its circular slot", () => {
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*width:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*height:\s*100%/s)
  assert.match(css, /\.mafw-resource-avatar img\s*\{[^}]*border-radius:\s*50%/s)
  assert.match(css, /\.mafw-resource-avatar\s*\{[^}]*overflow:\s*hidden/s)
})

test("SessionStrip Lore avatar is a 16px circle", () => {
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*width:\s*16px/s)
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*height:\s*16px/s)
  assert.match(css, /\.mafw-session-lead-avatar\s*\{[^}]*border-radius:\s*50%/s)
})

test("SessionStrip wires the Lead flag into the Lore avatar branch", () => {
  assert.ok(
    sessionStrip.includes("sessionPodRole(props.podRoleOf?.(s.id), s.lead)"),
    "SessionStrip must pass lead:true into sessionPodRole",
  )
  assert.ok(sessionStrip.includes("mafw-session-lead-avatar"), "SessionStrip must render the Lore avatar class")
  assert.ok(sessionStrip.includes("lead-avatar-16.png"), "SessionStrip must use the 16px circle avatar")
})

test("ProjectResources wires the Lead role into the Lore avatar branch", () => {
  assert.ok(
    projectResources.includes("memberAvatar(row.role, row.displayName)"),
    "ProjectResources must derive the avatar from the member role",
  )
  assert.ok(projectResources.includes("lead-avatar-32.png"), "ProjectResources must use the 32px circle avatar")
  assert.ok(projectResources.includes("isLore()"), "ProjectResources must branch on the Lore avatar kind")
})
