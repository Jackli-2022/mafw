// DocumentFrame 的纯视图映射：编辑器 tab 与浏览器 tab 收敛成同一套 tab 形状。
import type { EditorModel } from "./editor-state"
import { browserDocumentTitle, type BrowserDocument } from "./documents/browser-documents"

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
  tabs: readonly BrowserDocument[],
  activeId: string | null,
): DocumentTabView[] {
  return tabs.map((tab) => ({
    id: tab.id,
    label: browserDocumentTitle(tab),
    title: tab.url,
    icon: "globe",
    active: tab.id === activeId,
  }))
}

/** tab 条滚轮：横向手势用 deltaX，纵向滚轮映射成左右滚动。 */
export function tabStripWheelDelta(
  input: { deltaX: number; deltaY: number; deltaMode?: number },
  viewportWidth: number,
): number {
  const axis = Math.abs(input.deltaX) > Math.abs(input.deltaY) ? input.deltaX : input.deltaY
  if (!axis) return 0
  const unit = input.deltaMode === 1 ? 16 : input.deltaMode === 2 ? Math.max(1, viewportWidth) : 1
  return axis * unit
}
