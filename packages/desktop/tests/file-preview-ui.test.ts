import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")

// 文件 tab 拓宽（2026-10-27 spec）：图片只读预览 tab + SVG 源码/预览切换 + HTML 分流。
test("EditorDock renders image preview tabs read-only", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /fileKindFor/)
  assert.match(src, /mafw-file-preview/)
  // 主机 div 在图片/预览态隐藏（保持挂载防 CodeMirror 重挂竞态）
  assert.match(src, /display:[^\n]*(image|preview)/)
})

test("SVG opens in preview by default; source is one click", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  // 默认预览：缺省（undefined）= 预览，仅显式源码态（true）例外
  assert.match(src, /sourceMode\(\)\[f\.rel\] !== true/)
  assert.match(src, /预览/)
  assert.match(src, /源码/)
  // 默认预览需要协议 token：svg 打开前先 ensure（否则首开 src 为空）
  const openRel = src.slice(src.indexOf("async function openRel"), src.indexOf("async function mountActive"))
  assert.match(openRel, /kind === "svg"[\s\S]{0,160}ensureRootToken/)
})

test("image preview CSS exists", () => {
  const css = read("src/renderer/mafw/mafw.css")
  assert.match(css, /\.mafw-file-preview\s*\{/)
  assert.match(css, /object-fit:\s*contain/)
})

test("openRel branches image before readFile (binary gate)", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  const openRel = src.slice(src.indexOf("async function openRel"), src.indexOf("async function mountActive"))
  assert.match(openRel, /statFile/)
  assert.match(openRel, /fileKindFor/)
})

test("CSV/TSV table preview: default table, source one click", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /parseCsv/)
  assert.match(src, /mafw-table-preview/)
  assert.match(src, /表格/)
  assert.match(src, /sourceMode/)
})

test("PDF opens in browser surface via Chromium PDF viewer", () => {
  const dock = read("src/renderer/mafw/components/BrowserDock.tsx")
  assert.match(dock, /setAttribute\("plugins"/)
})

test("Markdown preview: default rendered, source one click", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /@mafw\/session-ui\/markdown/)
  assert.match(src, /mafw-md-preview/)
  assert.match(src, /"markdown"/)
})

test("JSON tree preview with source toggle", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /JsonPreview/)
  assert.match(src, /"json"/)
  const comp = read("src/renderer/mafw/components/JsonPreview.tsx")
  assert.match(comp, /mafw-json-preview/)
})

test("Office preview: lazy libs + read-only tabs", () => {
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /import\("exceljs\/dist\/exceljs\.min\.js"\)/)
  assert.match(office, /import\("docx-preview"\)/)
  assert.match(office, /import\("pptx-preview"\)/)
  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /OfficePreview/)
  assert.match(editor, /isReadOnlyPreview/)
})

// 闪帧回归（2026-10-31）：回合开始/结束会替换 sessions 数组，benchRoot 若是裸函数，
// 其下游 prop getter 会把 OfficePreview 的解析 effect 拖起来 —— host.innerHTML 被清空，
// 肉眼就是 pptx 白/黑一帧。三层锁：benchRoot 是 memo（按值去抖）→ 预览 URL 是 memo →
// OfficePreview 用 kind+url 键在同键时早退。
test("Office preview reload is keyed (no reparse on unrelated session churn)", () => {
  const office = read("src/renderer/mafw/components/OfficePreview.tsx")
  assert.match(office, /nextOfficePreviewLoad\(loadedKey, kind, url\)/)
  assert.match(office, /if \(!next\.reload\) return/)
  // 守卫必须在清空宿主之前
  const guard = office.indexOf("if (!next.reload) return")
  const clear = office.indexOf("host.innerHTML = \"\"")
  assert.ok(guard >= 0 && clear > guard, "guard must precede host clearing")

  const editor = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(editor, /const activePreviewUrl = createMemo\(/)
  assert.match(editor, /url=\{activePreviewUrl\(\)\}/)

  const shell = read("src/renderer/mafw/MafwShell.tsx")
  assert.match(shell, /const benchRoot = createMemo\(\(\) =>/)
})

