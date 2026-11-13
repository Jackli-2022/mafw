// 兼容 facade：Phase 2C-2 起文件模型由 documents/file-documents 持有。
import type { EditorModel } from "./editor-state"
import { clearFileModels, fileModelFor, saveFileModel } from "./documents/file-documents"

export function editorModelFor(root: string | null): EditorModel {
  return fileModelFor(root)
}

export function saveEditorModel(root: string | null, model: EditorModel): void {
  saveFileModel(root, model)
}

export function clearEditorModels(): void {
  clearFileModels()
}
