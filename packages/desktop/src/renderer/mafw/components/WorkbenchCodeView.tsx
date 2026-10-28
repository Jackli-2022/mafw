// 右工作台 › 工作台：文件树 + 编辑器/浏览器。
// 文件树在窄内容宽（<600px）由 CSS 收为抽屉；宽屏始终作为左列。
import { Show, createSignal } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { FilesDock } from "./FilesDock"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { WorkbenchSurface } from "../workbench-views"
import type { AnnotationAnchor } from "../../../shared/annotation-types"

export function WorkbenchCodeView(props: {
  surface: WorkbenchSurface
  sessionID: string | null
  sessionDirectory: string | null
  diffs: FileDiffEntry[]
  onOpenFile: (rel: string) => void
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  onAddAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string; anchor?: AnnotationAnchor; imageDataUrl?: string }) => void
  onSendComment?: (sid: string, text: string) => void
  onOpenReview?: () => void
}) {
  const [filesOpen, setFilesOpen] = createSignal(false)
  const openFile = (rel: string) => {
    setFilesOpen(false)
    props.onOpenFile(rel)
  }

  return (
    <div class="mafw-rw-code" classList={{ "files-open": filesOpen() }}>
      <Show when={props.surface === "code"}>
        <TooltipV2 value={filesOpen() ? "收起文件树" : "打开文件树"} openDelay={300}>
          <ButtonV2
            variant={filesOpen() ? "contrast" : "ghost"}
            size="small"
            class="mafw-rw-files-toggle"
            aria-label={filesOpen() ? "收起文件树" : "打开文件树"}
            aria-expanded={filesOpen()}
            onClick={() => setFilesOpen((v) => !v)}
          >
            <Icon name="folder" size="small" />
          </ButtonV2>
        </TooltipV2>
        <div class="mafw-rw-files">
          <FilesDock sessionID={props.sessionID} sessionDirectory={props.sessionDirectory} onOpenFile={openFile} />
        </div>
      </Show>
      <div class="mafw-rw-code-main">
        <div class="mafw-rw-code-pane" style={{ display: props.surface === "code" ? "contents" : "none" }}>
          <EditorDock
            sessionID={props.sessionID}
            sessionDirectory={props.sessionDirectory}
            diffs={props.diffs}
            onSendAnnotation={props.onSendAnnotation}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
            onOpenReview={props.onOpenReview}
          />
        </div>
        <div class="mafw-rw-code-pane" style={{ display: props.surface === "browser" ? "contents" : "none" }}>
          <BrowserDock sessionID={props.sessionID} />
        </div>
      </div>
    </div>
  )
}
