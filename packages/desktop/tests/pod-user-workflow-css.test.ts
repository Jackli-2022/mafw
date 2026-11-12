import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")
const css = read("../src/renderer/mafw/mafw.css")
const panel = read("../src/renderer/mafw/components/GoalDetailPanel.tsx")
const planReview = read("../src/renderer/mafw/components/PlanReviewOverlay.tsx")

function rule(selector: string): string {
  const start = css.indexOf(selector)
  if (start < 0) return ""
  const open = css.indexOf("{", start)
  const close = css.indexOf("}", open)
  return open < 0 || close < 0 ? "" : css.slice(open + 1, close)
}

test("the list stays mounted but hidden while inline detail is open", () => {
  assert.match(rule(".mafw-project-work-overview[hidden]"), /display:\s*none/)
})

test("inline Goal detail overrides the old modal geometry", () => {
  const inline = rule(".mafw-goal-inline {")
  assert.match(inline, /width:\s*100%/)
  assert.match(inline, /max-height:\s*none/)
  assert.match(inline, /overflow:\s*visible/)
  assert.match(inline, /padding:/)
  assert.doesNotMatch(inline, /position:\s*fixed/)
  assert.doesNotMatch(panel, /mafw-goal-overlay/)
  assert.match(planReview, /mafw-goal-overlay/, "PlanReviewOverlay remains the only current overlay consumer")
})

test("Pod contacts are content-sized cards with one lead accent", () => {
  const contact = rule(".mafw-pod-contact {")
  assert.match(contact, /width:\s*100%/)
  assert.match(contact, /min-height:/)
  assert.match(contact, /height:\s*auto/)
  assert.match(rule(".mafw-pod-contact.is-lead"), /var\(--accent\)/)
  assert.match(rule(".mafw-pod-contact-avatar"), /border-radius:\s*50%/)
  assert.match(css, /\.mafw-pod-contact:focus-visible/)
})

test("priority cards, filters and Goal rows have readable interaction states", () => {
  assert.match(rule(".mafw-work-priority-card"), /border-radius:/)
  assert.match(rule(".mafw-work-priority-card.is-result"), /var\(--accent\)|var\(--success\)|color-mix/)
  assert.match(rule(".mafw-work-filter[aria-pressed=\"true\"]"), /background:/)
  assert.match(css, /\.mafw-work-filter:focus-visible/)
  assert.match(css, /\.mafw-work-row \.mafw-work-item:focus-visible/)
})

test("world overview owns its scroll", () => {
  assert.match(rule(".mafw-project-work"), /overflow:\s*hidden/)
  assert.match(rule(".mafw-project-work-overview"), /overflow-y:\s*auto/)
  assert.match(css, /\.mafw-goal-inline/, "inline detail styles remain for the Goal context")
  assert.match(css, /container-type:\s*inline-size/)
  assert.match(css, /@container \(max-width: 620px\)/)
})

test("new surfaces reuse motion tokens and respect reduced motion", () => {
  assert.match(css, /\.mafw-pod-contact[^{]*\{[^}]*transition:[^;]*var\(--dur-fast\)/s)
  assert.match(css, /\.mafw-work-filter[^{]*\{[^}]*transition:[^;]*var\(--dur-fast\)/s)
  const reduce = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"))
  assert.match(reduce, /\.mafw-pod-contact/)
  assert.match(reduce, /\.mafw-work-filter/)
  assert.match(reduce, /transition:\s*none !important/)
})
