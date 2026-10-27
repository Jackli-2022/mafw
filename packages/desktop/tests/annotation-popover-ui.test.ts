import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")

test("AnnotationPopover: v2 组件 + Enter 发送 / Ctrl+Enter 攒草稿", () => {
  const src = read("src/renderer/mafw/components/AnnotationPopover.tsx")
  assert.match(src, /TextareaV2/)
  assert.match(src, /ButtonV2/)
  assert.match(src, /mafw-annot-pop/)
  assert.match(src, /ctrlKey \|\| e\.metaKey/)
  assert.match(src, /Enter 发送 · Ctrl\+Enter 攒草稿/)
  assert.match(src, /"draft"/)
  assert.match(src, /"send"/)
  // 面板禁 emoji + 禁裸 button
  assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(src))
  assert.ok(!/<button[\s>]/.test(src))
})

test("PendingAnnotations: anchor 标签 + kind 标记", () => {
  const src = read("src/renderer/mafw/components/PendingAnnotations.tsx")
  assert.match(src, /describeAnchor/)
  assert.match(src, /data-kind/)
  assert.match(src, /mafw-pending-annotation-kind/)
})
