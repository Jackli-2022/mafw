import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (rel: string) => readFileSync(join(root, rel), "utf8")

test("AnnotationSheet: 底部抽屉 + Enter 发送 / Ctrl+Enter 攒草稿", () => {
  const src = read("src/renderer/mafw/components/AnnotationSheet.tsx")
  assert.match(src, /TextareaV2/)
  assert.match(src, /ButtonV2/)
  assert.match(src, /mafw-annot-sheet/)
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

test("源码面交互：Ctrl+M 直达 + AnnotationSheet + 双按钮退役", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /AnnotationSheet/)
  assert.match(src, /isAnnotationHotkey/)
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

test("图片拖框批注：region layer + 裁剪 + 发送带图", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /mafw-region-layer/)
  assert.match(editor, /dragRectPx/)
  assert.match(editor, /cropImageDataUrl/)
  assert.match(editor, /crossOrigin="anonymous"/)
  assert.match(editor, /imageDataUrl/)
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /sendEnriched/)
  const send = read("src/renderer/mafw/chat/use-send-message.ts")
  assert.match(send, /annotationAtts/)
})

test("PPTX 图钉批注：slide wrapper 识别 + 页码锚", () => {
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /pptx-preview-slide-wrapper/)
  assert.match(office, /onAnnotateRegion/)
  assert.match(office, /slide:/)
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /onAnnotateRegion/)
})

test("批注反馈态：发送登记 mark + 会话回合结束翻已回应 + 本地面板条", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /addMark/)
  assert.match(editor, /marksFor/)
  assert.match(editor, /mafw-annot-marks/)
  assert.match(editor, /onOpenReview/)
  const stream = read("src/renderer/mafw/sse/handlers/chat-stream.ts")
  assert.match(stream, /markResponded/)
  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /onOpenReview/)
})

test("review 修复：C1 接线 / I1 键盘路径 / I2 媒体管道 / I3 只在 completed 翻转", () => {
  const code = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
  assert.match(code, /onOpenReview/)
  const shell = read("src/renderer/mafw/components/WorkbenchShell.tsx")
  assert.match(shell, /onOpenReview=\{props\.onOpenReview\}/)
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /selectionchange/)
  assert.match(editor, /document\.addEventListener\("keydown"/)
  const send = read("src/renderer/mafw/chat/use-send-message.ts")
  assert.match(send, /annotationAtts/)
  const mafw = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(mafw, /media\.createTask/)
  const stream = read("src/renderer/mafw/sse/handlers/chat-stream.ts")
  const count = (stream.match(/markResponded\(/g) ?? []).length
  assert.equal(count, 1)
  assert.match(stream, /noteTurnActivity/)
})

test("minors 修复：M1 删死代码 / M2 clearMarks / M4 pptx 钉 / M5 页码 / M6 翻边 / M8 pointercancel / M9 不清空 / M10 热键", () => {
  const anchor = read("src/renderer/mafw/annotation-anchor.ts")
  assert.ok(!anchor.includes("normalizeRect"))
  assert.ok(!anchor.includes("letterboxRect"))
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /clearMarks/)
  assert.match(editor, /onPointerCancel/)
  assert.match(editor, /isAnnotationHotkey/)
  assert.match(editor, /activeFile\(\)\?\.rel !== rel/)
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /mafw-pptx-pin/)
  assert.match(office, /slideIndexOf/)
  const sheet = read("src/renderer/mafw/components/AnnotationSheet.tsx")
  assert.ok(!sheet.includes('setValue("")'))
})

test("rev2 交互：批注模式 + 选中即输入 + 锚点原地标记", () => {
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /annotMode/)
  assert.match(editor, /mafw-annot-layer/)
  assert.match(editor, /mafw-annot-rect/)
  assert.match(editor, /mafw-annot-dot/)
  assert.match(editor, /if \(annotMode\(\)\) \{[\s\S]{0,120}setQuoteOpen\(true\)/)
  assert.match(editor, /revealAboveSheet/)
  const json = read("src/renderer/mafw/components/JsonPreview.tsx")
  assert.match(json, /annotMode/)
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-annot-sheet/)
  assert.match(css, /\.mafw-annot-rect/)
  assert.match(css, /mafw-annot-sheet-in/)
})
