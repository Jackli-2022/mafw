// DocumentFrame 的纯视图映射：编辑器 tab 与浏览器 tab 收敛成同一套 tab 形状。
import type { EditorModel } from "./editor-state"
import { browserTabTitle, type BrowserTab } from "./browser-tabs"

export type DocumentTabIcon = "file" | "globe"

export type DocumentTabView = {
  id: string
  label: string
  title?: string
  icon: DocumentTabIcon
  active: boolean
  dirty?: boolean
  preview?: boolean
  readOnly?: boolean
}

export function editorDocumentTabs(model: EditorModel): DocumentTabView[] {
  return model.files.map((file) => ({
    id: file.rel,
    label: file.rel.split(/[\\/]/).filter(Boolean).pop() ?? file.rel,
    title: file.rel,
    icon: "file",
    active: model.active === file.rel,
    dirty: file.dirty,
    preview: file.preview,
    readOnly: file.readOnly,
  }))
}

export function browserDocumentTabs(
  tabs: readonly BrowserTab[],
  activeId: string | null,
): DocumentTabView[] {
  return tabs.map((tab) => ({
    id: tab.id,
    label: browserTabTitle(tab),
    title: tab.url,
    icon: "globe",
    active: tab.id === activeId,
  }))
}
