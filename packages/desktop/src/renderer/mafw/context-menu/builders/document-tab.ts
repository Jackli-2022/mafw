import { L } from "../labels"
import { item } from "../model"
import type { MenuModel } from "../types"
import type { DocumentTabKind } from "../../documents/document-tabs-model"

export interface DocumentTabMenuTarget {
  kind: DocumentTabKind
  title: string
  copyValue: string
  canCloseOthers: boolean
  canCloseRight: boolean
  /** 固定 tab（世界首页）不可关闭。 */
  pinned?: boolean
}

export function buildDocumentTabMenu(target: DocumentTabMenuTarget): MenuModel {
  const noCopy = target.copyValue.trim().length === 0
  const items = [
    item("documentTab.close", L.documentTab.close, target.pinned
      ? { disabled: true, disabledReason: "世界页是固定标签页" }
      : {}),
    item("documentTab.closeOthers", L.documentTab.closeOthers, target.canCloseOthers
      ? {}
      : { disabled: true, disabledReason: "没有其他文档" }),
    item("documentTab.closeRight", L.documentTab.closeRight, target.canCloseRight
      ? {}
      : { disabled: true, disabledReason: "右侧没有文档" }),
  ]
  if (target.kind === "file" || target.kind === "changeset") {
    items.push(item("documentTab.copyPath", L.documentTab.copyPath, noCopy
      ? { disabled: true, disabledReason: "路径为空" }
      : {}))
  } else if (target.kind === "web") {
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
