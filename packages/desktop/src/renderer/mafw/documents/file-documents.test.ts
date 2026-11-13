import { beforeEach, test } from "node:test"
import assert from "node:assert/strict"
import { clearFileModels, fileModelFor, saveFileModel } from "./file-documents"
import { openFile } from "../editor-state"

beforeEach(() => clearFileModels())

test("file models keep a stable identity per root", () => {
  const first = fileModelFor("C:/a")
  assert.equal(fileModelFor("C:/a"), first)
  assert.deepEqual(fileModelFor("C:/b").files, [])

  const next = openFile(first, "a.ts", "A")
  saveFileModel("C:/a", next)
  assert.equal(fileModelFor("C:/a"), next)
})

test("same model and null root are no-ops; clear resets roots", () => {
  const model = openFile(fileModelFor("C:/a"), "a.ts", "A")
  saveFileModel("C:/a", model)
  saveFileModel("C:/a", model)
  saveFileModel(null, model)

  assert.equal(fileModelFor("C:/a"), model)
  assert.deepEqual(fileModelFor(null).files, [])

  clearFileModels()
  assert.deepEqual(fileModelFor("C:/a").files, [])
})
