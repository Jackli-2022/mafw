import { Show, createMemo, type JSX } from "solid-js"
import { DocumentToolbar } from "./document-frame"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import { ChangeSetView } from "./ChangeSetView"
import { activeDocumentTabKind } from "../documents/document-tabs-store"
import { activeChangeSetDocument } from "../documents/change-set-documents"
import { documentToolbarProvider } from "../documents/document-toolbar-registry"
import type { FocusOpenRequest } from "../focus/focus-open"
import type { FileDiffEntry } from "./DiffReviewPanel"

export function DocumentStage(props: {
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey?: string | null
  openRequest?: FocusOpenRequest | null
  diffs?: FileDiffEntry[]
  onActiveFileChange?: (rel: string | null) => void
  onAddAnnotation?: (a: any) => void
  onSendComment?: (sid: string, text: string) => void
  onInlineEdit?: (input: import("../editor/inline-edit").InlineEditSubmission) => void
  onOpenReview?: () => void
  onOpenFile?: (rel: string, line?: number) => void
  onSendDiffComment?: (sid: string, text: string) => void
  onAddDiffAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
}): JSX.Element {
  const activeKind = () => activeDocumentTabKind()
  const toolbar = createMemo(() => {
    const kind = activeKind()
    return kind ? documentToolbarProvider(kind)?.() ?? null : null
  })

  const openFile = (rel: string, line?: number) => {
    props.onOpenFile?.(rel, line)
  }

  return (
    <div class="mafw-document-stage">
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
            openRequest={props.openRequest ?? null}
            diffs={props.diffs}
            onActiveFileChange={props.onActiveFileChange}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
            onInlineEdit={props.onInlineEdit}
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
          style={{ display: activeKind() === "changeset" ? "contents" : "none" }}
        >
          <Show when={activeChangeSetDocument()}>
            {(doc) => (
              <ChangeSetView
                doc={doc()}
                onOpenFile={openFile}
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
