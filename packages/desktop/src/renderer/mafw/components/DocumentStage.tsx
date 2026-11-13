import { Show, createMemo, type JSX } from "solid-js"
import { DocumentTabs, DocumentToolbar } from "./document-frame"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import { DiffDocumentView } from "./DiffDocumentView"
import { activeDocumentTabId, documentTabs, moveDocumentTab } from "../documents/document-tabs-store"
import { activeDiffDocument } from "../documents/diff-documents"
import { documentToolbarProvider } from "../documents/document-toolbar-registry"
import {
  closeOtherTabIds,
  closeRightTabIds,
  documentTabViews,
} from "../documents/document-tabs-model"
import { buildDocumentTabMenu } from "../context-menu/builders/document-tab"
import { menuController } from "../context-menu/controller"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import type { FocusOpenRequest } from "../focus/focus-open"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { DiffDocument } from "../documents/diff-documents"

export function DocumentStage(props: {
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey?: string | null
  intent: "reading" | "editing"
  openRequest?: FocusOpenRequest | null
  diffs?: FileDiffEntry[]
  onActiveFileChange?: (rel: string | null) => void
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  onAddAnnotation?: (a: any) => void
  onSendComment?: (sid: string, text: string) => void
  onOpenReview?: () => void
  onOpenDiffFile?: (doc: DiffDocument) => void
  onSendDiffComment?: (sid: string, text: string) => void
  onAddDiffAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCloseMany: (ids: readonly string[]) => void
}): JSX.Element {
  const active = createMemo(() => {
    const id = activeDocumentTabId()
    return id ? (documentTabs().find((entry) => entry.id === id) ?? null) : null
  })
  const activeKind = () => active()?.kind ?? null
  const toolbar = createMemo(() => {
    const kind = activeKind()
    return kind ? documentToolbarProvider(kind)?.() ?? null : null
  })

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
      },
      (action) => {
        if (action === "documentTab.close") props.onClose(id)
        else if (action === "documentTab.closeOthers") {
          props.onCloseMany(closeOtherTabIds(entries, id))
        } else if (action === "documentTab.closeRight") {
          props.onCloseMany(closeRightTabIds(entries, id))
        } else if (action === "documentTab.copyPath" || action === "documentTab.copyLink") {
          if (copyValue) void navigator.clipboard.writeText(copyValue)
        } else if (action === "documentTab.openExternal") {
          if (copyValue) void window.api.browser.openExternal(copyValue)
        }
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <div class="mafw-document-stage">
      <DocumentTabs
        items={documentTabViews(documentTabs(), activeDocumentTabId())}
        ariaLabel="打开的文档"
        onSelect={props.onSelect}
        onClose={props.onClose}
        onMiddleClick={props.onClose}
        onContextMenu={requestTabMenu}
        onReorder={moveDocumentTab}
      />
      <Show when={toolbar()}>
        {(spec) => (
          <DocumentToolbar
            ariaLabel={spec().ariaLabel}
            leading={spec().leading?.()}
            center={spec().center?.()}
            trailing={spec().trailing?.()}
          />
        )}
      </Show>
      <div class="mafw-document-stage-body">
        <div
          class="mafw-document-stage-pane"
          style={{ display: activeKind() === "file" ? "contents" : "none" }}
        >
          <EditorDock
            embedded
            sessionID={props.sessionID}
            contentRoot={props.contentRoot}
            scopeKey={props.contentScopeKey ?? null}
            intent={props.intent}
            openRequest={props.openRequest ?? null}
            diffs={props.diffs}
            onActiveFileChange={props.onActiveFileChange}
            onSendAnnotation={props.onSendAnnotation}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
            onOpenReview={props.onOpenReview}
          />
        </div>
        <div
          class="mafw-document-stage-pane"
          style={{ display: activeKind() === "web" ? "contents" : "none" }}
        >
          <BrowserDock embedded sessionID={props.sessionID} />
        </div>
        <div
          class="mafw-document-stage-pane"
          style={{ display: activeKind() === "diff" ? "contents" : "none" }}
        >
          <Show when={activeDiffDocument()}>
            {(doc) => (
              <DiffDocumentView
                doc={doc()}
                onOpenFile={(item) => props.onOpenDiffFile?.(item)}
                onSendComment={props.onSendDiffComment}
                onAddAnnotation={props.onAddDiffAnnotation}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
