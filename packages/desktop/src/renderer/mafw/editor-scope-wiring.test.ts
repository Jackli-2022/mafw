import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const read = (path: string) => readFileSync(join(import.meta.dirname, path), "utf8")
const editor = read("components/EditorDock.tsx")
const cm = read("editor/cm-setup.ts")
const monaco = read("editor/monaco-setup.ts")
const types = readFileSync(join(import.meta.dirname, "../../shared/annotation-types.ts"), "utf8")

test("EditorDock restores models and reading positions per scope", () => {
  assert.match(editor, /editorModelFor\(/)
  assert.match(editor, /saveEditorModel\(/)
  assert.match(editor, /rememberReadingPosition/)
  assert.match(editor, /readingPositionFor/)
  assert.match(editor, /getScroll\(\)/)
  assert.match(editor, /setScroll\(/)
  assert.match(editor, /rememberSelection/)
  assert.match(editor, /selectionFor/)
  assert.match(editor, /getSelection\(\)/)
  assert.match(editor, /setSelection\(/)
  assert.match(editor, /selectTreeFile/)
  assert.match(editor, /mountToken/)
  assert.match(editor, /root !== props\.contentRoot/)
  assert.match(editor, /\.mafw-md-preview, \.mafw-json-preview-wrap, \.mafw-table-preview, \.mafw-office-host/)
  assert.match(editor, /previewRestoredKey/)
  assert.match(cm, /getScroll\(\): number/)
  assert.match(cm, /setScroll\(top: number\)/)
  assert.match(cm, /getSelection\(\): EditorSelection \| null/)
  assert.match(cm, /setSelection\(anchor: number, head: number\): void/)
  assert.match(monaco, /getSelection\(\)/)
  assert.match(monaco, /setSelection\(/)
  assert.match(monaco, /getScrollTop\(\)/)
  assert.match(monaco, /setScrollTop\(/)
})

test("annotation drafts carry the content scope without changing the file path", () => {
  assert.match(types, /scopeKey\?: string/)
  assert.match(types, /root\?: string/)
  assert.match(editor, /scopeKey: props\.scopeKey \?\? undefined/)
  assert.match(editor, /root: props\.contentRoot \?\? undefined/)
})

test("project direct edits never require a Goal", () => {
  const save = editor.slice(editor.indexOf("async function saveActive"))
  assert.match(save.slice(0, 2000), /window\.api\.fs\.writeFile/)
  assert.doesNotMatch(save.slice(0, 2000), /pod\.|goal\./)
})
