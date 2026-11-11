import { test } from "node:test"
import assert from "node:assert/strict"
import { createEditorModel, openFile } from "./editor-state"
import { clearEditorModels, editorModelFor, saveEditorModel } from "./editor-model-store"

test("editor models are isolated by root", () => {
  clearEditorModels()
  const model = openFile(createEditorModel(), "src/a.ts", "A")
  saveEditorModel("C:\\a", model)
  assert.deepEqual(editorModelFor("C:\\a").files.map((f) => f.rel), ["src/a.ts"])
  assert.deepEqual(editorModelFor("D:\\b").files, [])
})

test("saving a null root is a no-op", () => {
  clearEditorModels()
  saveEditorModel(null, openFile(createEditorModel(), "a.ts", "A"))
  assert.deepEqual(editorModelFor(null).files, [])
})
