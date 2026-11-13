// diff tab：会话 diff 保留回退/评论；Goal diff 只读。
import { Show, onCleanup, onMount, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { DiffReviewPanel } from "./DiffReviewPanel"
import { registerDocumentToolbar } from "../documents/document-toolbar-registry"
import type { DiffDocument } from "../documents/diff-documents"

export type DiffDocumentViewProps = {
  doc: DiffDocument
  onOpenFile: (doc: DiffDocument) => void
  onSendComment?: (sessionID: string, text: string) => void
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
}

export function DiffDocumentView(props: DiffDocumentViewProps): JSX.Element {
  const isSession = () => props.doc.source.kind === "session"

  onMount(() => {
    const unregister = registerDocumentToolbar("diff", () => ({
      ariaLabel: "改动工具栏",
      leading: () => (
        <ButtonV2 variant="ghost" size="small" onClick={() => props.onOpenFile(props.doc)}>
          打开文件
        </ButtonV2>
      ),
      center: () => (
        <span class="mafw-diff-tab-path" title={props.doc.rel}>
          {props.doc.rel}
          <span class="mafw-diff-stat add">+{props.doc.additions}</span>
          <span class="mafw-diff-stat del">-{props.doc.deletions}</span>
        </span>
      ),
      trailing: () => (
        <ButtonV2
          variant="ghost"
          size="small"
          disabled={!props.doc.rel}
          onClick={() => { void navigator.clipboard.writeText(props.doc.rel) }}
        >
          复制路径
        </ButtonV2>
      ),
    }))
    onCleanup(unregister)
  })

  return (
    <div class="mafw-diff-document">
      <Show
        when={isSession()}
        fallback={
          <DiffReviewPanel
            chrome="tab"
            previewOnly
            sessionID=""
            diffs={[props.doc]}
            initialFile={props.doc.rel}
            allowSessionFallback={false}
            hint={null}
            focusLine={props.doc.anchorLine}
          />
        }
      >
        <DiffReviewPanel
          chrome="tab"
          sessionID={props.doc.source.kind === "session" ? props.doc.source.sessionID : ""}
          diffs={[props.doc]}
          initialFile={props.doc.rel}
          allowSessionFallback={false}
          allowNonInvertibleRevert={false}
          onSendComment={props.onSendComment}
          onAddAnnotation={props.onAddAnnotation}
          focusLine={props.doc.anchorLine}
        />
      </Show>
    </div>
  )
}
