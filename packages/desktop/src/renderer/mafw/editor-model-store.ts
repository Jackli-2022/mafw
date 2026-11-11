// 每个内容 root 的编辑器模型（tabs/active/dirty 基准）。
// 草稿内容仍由 editor-drafts 按 (root, rel) 保存；这里只保存 tab 结构与内存状态。
import { createEditorModel, type EditorModel } from "./editor-state"

const models = new Map<string, EditorModel>()

function clone(model: EditorModel): EditorModel {
  return {
    root: model.root,
    active: model.active,
    files: model.files.map((file) => ({ ...file })),
  }
}

export function editorModelFor(root: string | null): EditorModel {
  if (!root) return createEditorModel()
  const model = models.get(root)
  return model ? clone(model) : { ...createEditorModel(), root }
}

export function saveEditorModel(root: string | null, model: EditorModel): void {
  if (!root) return
  models.set(root, clone(model))
}

export function clearEditorModels(): void {
  models.clear()
}
