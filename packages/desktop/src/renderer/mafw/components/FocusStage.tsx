import { Match, Show, Switch, type JSX } from "solid-js"
import { TerminalSurface } from "./TerminalSurface"
import { DocumentStage } from "./DocumentStage"
import { DockEmpty } from "./dock-panel"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { DiffDocument } from "../documents/diff-documents"
import type { AnnotationAnchor } from "../../../shared/annotation-types"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import type { Focus } from "../focus/focus-model"
import type { FocusOpenRequest } from "../focus/focus-open"
import { stageKindFor } from "../focus/stage-dispatch"
import "../focus-goal-stage.css"

/** 工作台的「台」：只放当前对象；文件 / 浏览器 / 终端 / 插件 / 变更集 / Goal / 世界。 */
export function FocusStage(props: {
  focus: Focus
  active: boolean
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  sessionDirectory?: string | null
  diffs: FileDiffEntry[]
  liveDiffs?: unknown
  onActiveFileChange?: (rel: string | null) => void
  openRequest?: FocusOpenRequest | null
  onSendAnnotation?: (text: string, opts?: { imageDataUrl?: string }) => void
  onAddAnnotation?: (a: {
    rel: string
    startLine: number
    endLine: number
    code: string
    comment: string
    anchor?: AnnotationAnchor
    imageDataUrl?: string
    scopeKey?: string
    root?: string
  }) => void
  onSendComment?: (sid: string, text: string) => void
  onOpenReview?: () => void
  onOpenDiffFile?: (doc: DiffDocument) => void
  onSendDiffComment?: (sid: string, text: string) => void
  onAddDiffAnnotation?: (a: { rel: string; startLine: number; endLine: number; code: string; comment: string }) => void
  renderPluginSurface?: (id: string) => JSX.Element
  webSurfaces?: readonly PluginWebSurfaceView[]
  gatewayUrl?: string
  onWebBadge?: (surfaceId: string, count: number) => void
  onWebTitle?: (surfaceId: string, title: string) => void
  onWebError?: (surfaceId: string, message: string) => void
  renderGoal?: () => JSX.Element
  renderWorld?: () => JSX.Element
  onDocumentSelect?: (id: string) => void
  onDocumentClose?: (id: string) => void
  onDocumentCloseMany?: (ids: readonly string[]) => void
}): JSX.Element {
  const kind = () => stageKindFor(props.focus)
  const isDocument = () => kind() === "editor" || kind() === "browser" || kind() === "diff"
  const pluginId = () => {
    const subject = props.focus.subject
    return subject.kind === "plugin" ? `plugin:${subject.package}:${subject.panel}` : null
  }
  const pluginWebSurface = () => {
    const id = pluginId()
    return id ? props.webSurfaces?.find((view) => view.surfaceId === id) ?? null : null
  }

  return (
    <div class="mafw-focus-stage">
      <div class="mafw-focus-document" style={{ display: isDocument() ? "contents" : "none" }}>
        <DocumentStage
          sessionID={props.sessionID}
          contentRoot={props.contentRoot}
          contentScopeKey={props.contentScopeKey}
          openRequest={props.openRequest}
          diffs={props.diffs}
          onActiveFileChange={props.onActiveFileChange}
          onSendAnnotation={props.onSendAnnotation}
          onAddAnnotation={props.onAddAnnotation}
          onSendComment={props.onSendComment}
          onOpenReview={props.onOpenReview}
          onOpenDiffFile={props.onOpenDiffFile}
          onSendDiffComment={props.onSendDiffComment}
          onAddDiffAnnotation={props.onAddDiffAnnotation}
          onSelect={(id) => props.onDocumentSelect?.(id)}
          onClose={(id) => props.onDocumentClose?.(id)}
          onCloseMany={(ids) => props.onDocumentCloseMany?.(ids)}
        />
      </div>

      <Switch>
        <Match when={kind() === "terminal"}>
          <TerminalSurface directory={props.contentRoot} active={props.active} />
        </Match>

        <Match when={kind() === "plugin"}>
          <Show when={!pluginWebSurface()}>
            {pluginId() ? props.renderPluginSurface?.(pluginId()!) : null}
          </Show>
        </Match>

        <Match when={kind() === "goal"}>
          <div class="mafw-focus-goal-stage">
            {props.renderGoal?.() ?? <DockEmpty icon="dot-grid" text="Goal 总览待接入" />}
          </div>
        </Match>

        <Match when={kind() === "world"}>
          {props.renderWorld?.() ?? <DockEmpty icon="folder" text="世界总览待接入" />}
        </Match>
      </Switch>
    </div>
  )
}
