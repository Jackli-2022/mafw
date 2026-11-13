// 工作台唯一的 tab 条：场景（世界 / Goal / 终端 / 插件）与文档（文件 / 浏览器 / 改动集）同列。
import { type JSX } from "solid-js"
import { DocumentTabs } from "./document-frame"
import {
  activeDocumentTabId,
  documentTabs,
  moveDocumentTab,
} from "../documents/document-tabs-store"
import {
  closeOtherTabIds,
  closeRightTabIds,
  documentTabViews,
  WORLD_SCENE_TAB_ID,
} from "../documents/document-tabs-model"
import { buildDocumentTabMenu } from "../context-menu/builders/document-tab"
import { menuController } from "../context-menu/controller"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"

export type WorkbenchTabsProps = {
  activeId?: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseMany: (ids: readonly string[]) => void
}

export function WorkbenchTabs(props: WorkbenchTabsProps): JSX.Element {
  const activeId = () => props.activeId ?? activeDocumentTabId()

  const requestTabMenu = (id: string, event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    event.stopPropagation()
    const entries = documentTabs()
    const entry = entries.find((item) => item.id === id)
    if (!entry) return
    const index = entries.findIndex((item) => item.id === id)
    const copyValue = entry.view.title ?? entry.view.label
    menuController.request(
      buildDocumentTabMenu,
      {
        kind: entry.kind,
        title: copyValue,
        copyValue,
        canCloseOthers: entries.length > 1,
        canCloseRight: index >= 0 && index < entries.length - 1,
        pinned: entry.id === WORLD_SCENE_TAB_ID,
      },
      (action) => {
        if (action === "documentTab.close") props.onClose(id)
        else if (action === "documentTab.closeOthers") props.onCloseMany(closeOtherTabIds(entries, id))
        else if (action === "documentTab.closeRight") props.onCloseMany(closeRightTabIds(entries, id))
        else if (action === "documentTab.copyPath" || action === "documentTab.copyLink") {
          if (copyValue) void navigator.clipboard.writeText(copyValue)
        } else if (action === "documentTab.openExternal") {
          if (copyValue) void window.api.browser.openExternal(copyValue)
        }
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <DocumentTabs
      items={documentTabViews(documentTabs(), activeId())}
      ariaLabel="工作台标签"
      onSelect={props.onSelect}
      onClose={props.onClose}
      onMiddleClick={props.onClose}
      onContextMenu={requestTabMenu}
      onReorder={moveDocumentTab}
      pinnedIds={[WORLD_SCENE_TAB_ID]}
    />
  )
}
