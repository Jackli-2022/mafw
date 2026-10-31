import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 2026-10-31：checkpoint 恢复前预览 + 编辑器内联 agent 改动（只读）。
test("编辑器内联 diff：行装饰 + 上一处/下一处", () => {
  const dock = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(dock, /inlineDiffRanges/)
  assert.match(dock, /setInlineDiff/)
  assert.match(dock, /gotoLine\(/)
  assert.match(dock, /上一处改动/)
  assert.match(dock, /下一处改动/)

  const cm = read("src/renderer/mafw/editor/cm-setup.ts")
  assert.match(cm, /inlineDiffField/)
  assert.match(cm, /Decoration\.line/)
  assert.match(cm, /cm-inline-diff-add/)
  assert.match(cm, /gotoLine\(line: number\)/)

  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.cm-inline-diff-add\s*\{/)
  assert.match(css, /\.cm-inline-diff-del\s*\{/)
  assert.match(css, /\.mafw-editor-inline-diff-count\s*\{/)
})

test("checkpoint 恢复前只读预览（复用 DiffReviewPanel previewOnly）", () => {
  const overlay = read("src/renderer/mafw/components/CheckpointOverlay.tsx")
  assert.match(overlay, /previewOnly/)
  assert.match(overlay, /setPreview\(cp\)/)
  assert.match(overlay, /DiffReviewPanel/)
  assert.match(overlay, /is-hidden/)
  const panel = read("src/renderer/mafw/components/DiffReviewPanel.tsx")
  assert.match(panel, /previewOnly\?: boolean/)
  assert.match(panel, /改动预览（只读）/)
  // 预览态不渲染回退 footer / 勾选框
  assert.match(panel, /<Show when=\{!props\.previewOnly\}>\s*<footer/)
  assert.match(panel, /<Show when=\{!props\.previewOnly\}>\s*<input/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-checkpoint-panel\.is-previewing\s*\{/)
  assert.match(css, /\.mafw-checkpoint-preview\s*\{/)
})
