// 文件文档的 tab / 内容模型：document 层持有每个 root 的 EditorModel。
// editor-state 仍是纯 reducer；EditorDock 只负责把用户动作变成 reducer 调用。
import { createSignal } from "solid-js"
import { createEditorModel, type EditorModel } from "../editor-state"

const models = new Map<string, EditorModel>()
const empty = createEditorModel()
const [revision, setRevision] = createSignal(0)

/** 读取当前 root 的模型；首次访问创建空模型，保证对象身份稳定。 */
export function fileModelFor(root: string | null): EditorModel {
  revision()
  if (!root) return empty
  let model = models.get(root)
  if (!model) {
    model = { ...createEditorModel(), root }
    models.set(root, model)
  }
  return model
}

export function saveFileModel(root: string | null, model: EditorModel): void {
  if (!root) return
  if (models.get(root) === model) return
  models.set(root, model)
  setRevision((value) => value + 1)
}

export function clearFileModels(): void {
  models.clear()
  setRevision((value) => value + 1)
}
