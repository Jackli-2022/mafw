import { L } from "../labels"
import { item, sep } from "../model"
import type { MenuModel } from "../types"

export interface TextMenuTarget {
  editable: boolean
  hasSelection: boolean
  canPaste: boolean
}

export function buildTextMenu(target: TextMenuTarget): MenuModel {
  if (!target.editable) {
    return { surface: "edit.text", items: [item("text.copy", L.text.copy)] }
  }

  return {
    surface: "edit.text",
    items: [
      item("text.cut", L.text.cut, target.hasSelection
        ? {}
        : { disabled: true, disabledReason: "没有选中内容" }),
      item("text.copy", L.text.copy, target.hasSelection
        ? {}
        : { disabled: true, disabledReason: "没有选中内容" }),
      item("text.paste", L.text.paste, target.canPaste
        ? {}
        : { disabled: true, disabledReason: "剪贴板不可用" }),
      sep(),
      item("text.selectAll", L.text.selectAll),
    ],
  }
}
