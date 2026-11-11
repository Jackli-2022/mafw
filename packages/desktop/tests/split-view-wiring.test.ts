import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8")
const header = read("src/renderer/mafw/components/ContentScopeHeader.tsx")
const workbench = read("src/renderer/mafw/components/WorkbenchShell.tsx")
const codeView = read("src/renderer/mafw/components/WorkbenchCodeView.tsx")
const split = read("src/renderer/mafw/components/SplitDocumentPane.tsx")
const shell = read("src/renderer/mafw/MafwShell.tsx")
const css = read("src/renderer/mafw/mafw.css")

test("content header exposes an explicit split toggle for documents", () => {
  assert.match(header, /mafw-content-scope-split/)
  assert.match(header, /splitOpen/)
  assert.match(header, /onToggleSplit/)
  assert.match(header, /分屏对照/)
  assert.match(header, /关闭分屏/)
})

test("split is an explicit second document pane, not a third tab row", () => {
  assert.match(codeView, /const \[splitRel, setSplitRel\]/)
  assert.match(codeView, /props\.splitOpen\) \{\s*setSplitRel\(rel\)/)
  assert.match(codeView, /SplitDocumentPane/)
  assert.match(split, /fileKindFor/)
  assert.match(split, /window\.api\.fs\.readFile/)
  assert.match(split, /从文件树选择第二个文件进行对照/)
  assert.match(split, /关闭分屏/)
})

test("shell owns the split state and passes it through", () => {
  assert.match(shell, /const \[contentSplit, setContentSplit\] = createSignal\(false\)/)
  assert.match(workbench, /contentSplit: boolean/)
  assert.match(workbench, /onContentSplit: \(open: boolean\)/)
  assert.match(workbench, /splitOpen=\{props\.contentSplit\}/)
  assert.match(workbench, /onSplitOpen=\{props\.onContentSplit\}/)
})

test("split layout is side by side on wide containers and stacked when narrow", () => {
  assert.match(css, /\.mafw-rw-code-main\.is-split\s*\{[^}]*flex-direction:\s*row/)
  assert.match(css, /\.mafw-rw-split\s*\{[^}]*flex:\s*0 0 42%/)
  assert.match(css, /@container \(max-width:\s*980px\)[\s\S]*?\.mafw-rw-code-main\.is-split\s*\{[^}]*flex-direction:\s*column/)
})
