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

test("SessionStrip brand slot uses Orcalore and the Lore icon", () => {
  assert.ok(sessionStrip.includes("mafw-sessionstrip-brand-icon"), "brand slot must render the Lore icon")
  assert.ok(sessionStrip.includes("Orcalore"), "brand slot must show the Orcalore wordmark")
  assert.ok(sessionStrip.includes("lead-avatar-20.png"), "brand slot must use the 20px Lore circle")
  assert.match(css, /\.mafw-sessionstrip-brand-icon\s*\{[^}]*width:\s*18px/s)
})

test("SessionStrip Lead tab stays text-only", () => {
  assert.ok(!sessionStrip.includes("mafw-session-lead-avatar"), "Lead tab must not render the Lore avatar")
  assert.ok(!sessionStrip.includes("lead-avatar-16.png"), "Lead tab must not import the 16px avatar")
  assert.match(sessionStrip, /mafw-session-pod-badge/, "role badges remain on session tabs")
})

test("ProjectResources wires the Lead role into the Lore avatar branch", () => {
  assert.ok(
    projectResources.includes("memberAvatar(row.role, row.displayName)"),
    "ProjectResources must derive the avatar from the member role",
  )
  assert.ok(projectResources.includes("lead-avatar-32.png"), "ProjectResources must use the 32px circle avatar")
  assert.ok(projectResources.includes("isLore()"), "ProjectResources must branch on the Lore avatar kind")
})
