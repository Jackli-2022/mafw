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

test("源码面交互：Ctrl+M 直达 + AnnotationPopover + 双按钮退役", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /AnnotationPopover/)
  assert.match(src, /KeyM/)
  assert.ok(!src.includes("LineCommentEditorV2"))
  assert.ok(!src.includes('submitLabel="加入批注"'))
  const ea = read("src/renderer/mafw/editor-annotation.ts")
  assert.match(ea, /anchorBlockLines/)
  assert.match(ea, /buildAnnotationPromptAnchored/)
  assert.match(ea, /item\.anchor/)
})

test("Markdown/DOCX 划选批注：annotatable 容器 + buildQuoteAnchor 接线", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /buildQuoteAnchor/)
  assert.match(src, /data-annotatable="quote"/)
  assert.match(src, /quoteSel/)
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /data-annotatable=\{props\.kind === "docx" \? "quote" : undefined\}/)
})

test("JSON 树节点批注：onAnnotate + 路径锚 + 就地输入", () => {
  const json = read("src/renderer/mafw/components/JsonPreview.tsx")
  assert.match(json, /onAnnotate/)
  assert.match(json, /mafw-json-annot/)
  assert.match(json, /path:/)
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /jsonPathOf/)
  assert.match(editor, /"jsonPath"/)
})

test("CSV/XLSX 单元格批注：data-cell-ref + a1Ref + sheet 透传", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /a1Ref/)
  assert.match(editor, /data-cell-ref/)
  assert.match(editor, /handleCellClick/)
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /onAnnotateCell/)
  assert.match(office, /data-cell-ref/)
  assert.match(office, /a1Ref/)
})
