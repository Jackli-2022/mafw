import { L } from "../labels"
import { item } from "../model"
import type { MenuModel } from "../types"

export interface DocumentTabMenuTarget {
  kind: "file" | "web"
  title: string
  copyValue: string
  canCloseOthers: boolean
  canCloseRight: boolean
}

export function buildDocumentTabMenu(target: DocumentTabMenuTarget): MenuModel {
  const noCopy = target.copyValue.trim().length === 0
  const items = [
    item("documentTab.close", L.documentTab.close),
    item("documentTab.closeOthers", L.documentTab.closeOthers, target.canCloseOthers
      ? {}
      : { disabled: true, disabledReason: "没有其他文档" }),
    item("documentTab.closeRight", L.documentTab.closeRight, target.canCloseRight
      ? {}
      : { disabled: true, disabledReason: "右侧没有文档" }),
  ]
  if (target.kind === "file") {
    items.push(item("documentTab.copyPath", L.documentTab.copyPath, noCopy
      ? { disabled: true, disabledReason: "路径为空" }
      : {}))
  } else {
    items.push(
      item("documentTab.copyLink", L.documentTab.copyLink, noCopy
        ? { disabled: true, disabledReason: "地址为空" }
        : {}),
      item("documentTab.openExternal", L.documentTab.openExternal, noCopy
        ? { disabled: true, disabledReason: "地址为空" }
        : {}),
    )
  }
  return { surface: "browser", items }
}
