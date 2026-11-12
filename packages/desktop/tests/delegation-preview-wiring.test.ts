import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const composer = read("src/renderer/mafw/components/PodGoalComposer.tsx")
const preview = read("src/renderer/mafw/components/DelegationPreview.tsx")
const work = read("src/renderer/mafw/components/ProjectWorkView.tsx")
const css = read("src/renderer/mafw/delegation-preview.css")

test("composer previews before creating", () => {
  assert.match(composer, /buildDelegationPreview/)
  assert.match(composer, /DelegationPreview/)
  assert.match(composer, /预览委托单/)
  assert.match(composer, /startPreview/)
  assert.match(composer, /projectName/)
})

test("preview renders the contract and human-only note", () => {
  assert.match(preview, /mafw-delegation-preview/)
  assert.match(preview, /确认并创建/)
  assert.match(preview, /props\.preview\.autonomy/)
  assert.match(preview, /ButtonV2/)
  assert.doesNotMatch(preview, /<button/)
})

test("ProjectWorkView passes the project name", () => {
  assert.match(work, /projectName=\{props\.projectName/)
})

test("preview CSS uses tokens", () => {
  assert.match(css, /\.mafw-delegation-preview/)
  assert.match(css, /var\(--/)
})
