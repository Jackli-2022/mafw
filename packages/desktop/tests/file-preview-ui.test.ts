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

test("SVG preview is an explicit toggle (default source)", () => {
  const src = read("src/renderer/mafw/components/EditorDock.tsx")
  assert.match(src, /预览/)
  assert.match(src, /源码/)
  // 默认态 = 源码（预览状态表缺省 false）
  assert.doesNotMatch(src, /defaultPreview:\s*true/)
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
