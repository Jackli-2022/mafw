import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuModel } from "../types"

export interface EditorTabMenuTarget {
  rel: string
  index: number
  count: number
}

export function buildEditorTabMenu(target: EditorTabMenuTarget): MenuModel {
  const onlyTab = target.count <= 1
  const lastTab = target.index >= target.count - 1

  return {
    surface: "editor.tab",
    items: [
      item("editorTab.close", L.editorTab.close),
      item("editorTab.closeOthers", L.editorTab.closeOthers, onlyTab
        ? { disabled: true, disabledReason: "只有一个标签" }
        : {}),
      item("editorTab.closeRight", L.editorTab.closeRight, lastTab
        ? { disabled: true, disabledReason: "已经在最右侧" }
        : {}),
      sep(),
      item("editorTab.copyPath", L.editorTab.copyPath),
      item("editorTab.reveal", L.editorTab.reveal),
    ],
  }
}
