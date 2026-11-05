import { readFileSync } from "node:fs"
import { test } from "node:test"
import assert from "node:assert/strict"

const css = readFileSync(new URL("./mafw.css", import.meta.url), "utf8")
const sessionStrip = readFileSync(new URL("./components/SessionStrip.tsx", import.meta.url), "utf8")

test("SessionStrip brand slot uses Orcalore and the Lore icon", () => {
  assert.ok(sessionStrip.includes("mafw-sessionstrip-brand-icon"), "brand slot must render the Lore icon")
  assert.ok(sessionStrip.includes("Orcalore"), "brand slot must show the Orcalore wordmark")
  assert.ok(sessionStrip.includes("lead-avatar-20.png"), "brand slot must use the 20px Lore circle")
  assert.match(css, /\.mafw-sessionstrip-brand-icon\s*\{[^}]*width:\s*18px/s)
})

test("Lead tab reserves room for its label", () => {
  assert.ok(sessionStrip.includes('"is-lead-tab"'), "Lead tab must expose the is-lead-tab class")
  assert.ok(sessionStrip.includes("s.lead"), "Lead tab must derive its special layout from the lead flag")
  assert.match(css, /\.mafw-session-tab\.is-lead-tab \.mafw-agent-dot\s*\{[^}]*display:\s*none/s)
  // "Lead" @13px ≈ 30px：min-width 28 会把最后一个字母吃掉（实测渲染成 "L…"），
  // 所以 Lead 标题必须不参与收缩且留够 34px。
  const title = css.match(/\.mafw-session-tab\.is-lead-tab \.mafw-session-title\s*\{([^}]*)\}/s)?.[1]
  assert.ok(title, "Lead tab title rule missing")
  assert.match(title, /flex:\s*0 0 auto/)
  assert.match(title, /min-width:\s*34px/)
  assert.match(css, /\.mafw-session-tab\.is-lead-tab \.mafw-session-close\s*\{[^}]*width:\s*16px/s)
})

test("SessionStrip Lead tab stays text-only", () => {
  assert.ok(!sessionStrip.includes("mafw-session-lead-avatar"), "Lead tab must not render the Lore avatar")
  assert.ok(!sessionStrip.includes("lead-avatar-16.png"), "Lead tab must not import the 16px avatar")
  assert.match(sessionStrip, /mafw-session-pod-badge/, "role badges remain on session tabs")
})
