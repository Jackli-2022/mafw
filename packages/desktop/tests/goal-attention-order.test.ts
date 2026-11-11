import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const panel = read("src/renderer/mafw/components/GoalDetailPanel.tsx")

function indexOf(marker: string): number {
  const index = panel.indexOf(marker)
  assert.ok(index >= 0, `missing marker: ${marker}`)
  return index
}

test("Goal detail follows the §8.2 attention order", () => {
  const head = indexOf('class="mafw-goal-head"')
  const hero = indexOf("<GoalUserHero")
  const blocker = indexOf("mafw-goal-blocker")
  const question = indexOf('data-section="question"')
  const direction = indexOf('data-section="direction"')
  const plan = indexOf('data-section="plan"')
  const source = indexOf("data-goal-source")
  const result = indexOf('data-section="result"')
  const technical = indexOf("mafw-goal-technical")

  assert.ok(head < hero, "goal title precedes the user hero")
  assert.ok(hero < blocker, "what this Goal is precedes what needs the person")
  assert.ok(blocker < question, "blocked/error surfaces before the question form")
  assert.ok(question < direction, "pending questions outrank direction discussion")
  assert.ok(direction < plan, "direction precedes plan detail")
  assert.ok(plan < source, "source context is background, after the active work")
  assert.ok(source < result, "result follows the current context")
  assert.ok(result < technical, "technical diagnostics stay last")
})

test("technical diagnostics are collapsed unless explicitly opened", () => {
  assert.match(panel, /const technicalVisible = \(\) => technicalOpen\(\)/)
  assert.doesNotMatch(panel, /technicalVisible = \(\) => technicalOpen\(\) \|\| !goalSummary\(\)/)
  assert.match(panel, /<Show when=\{!goalSummary\(\)\}>[\s\S]{0,400}技术详情/)
  assert.match(panel, /aria-pressed=\{technicalOpen\(\)\}/)
})
