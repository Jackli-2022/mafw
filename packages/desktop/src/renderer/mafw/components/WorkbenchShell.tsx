// 焦点工作台壳：Frame + Stage + Instruments + Picker。
// 不再有 context / L2 / execution drawer；所有导航来自焦点栈。
import { Show, type JSX } from "solid-js"
import { DockEmpty } from "./dock-panel"
import { FrameBar } from "./FrameBar"
import { FocusStage } from "./FocusStage"
import { PluginSurfaceStage } from "./PluginSurfaceStage"
import { SubjectPicker } from "./SubjectPicker"
import { pluginSurfaceId, type PluginSurfaceId } from "../plugins/surface-id"
import type { Focus } from "../focus/focus-model"
import type { FrameView } from "../focus/frame-view"
import type { FocusOpenRequest } from "../focus/focus-open"
import type { PickerItem } from "../focus/picker-model"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { DiffDocument } from "../documents/diff-documents"
import type { AnnotationAnchor } from "../../../shared/annotation-types"

export type WorkbenchShellProps = {
  open: boolean
  /** 焦点栈当前对象；null 时显示取景器空态。 */
  focusView: Focus | null
  frame: FrameView | null
  onFocusBack: () => void
  onFocusCrumb: (index: number) => void
  focusOpenRequest?: FocusOpenRequest | null
  pickerOpen: boolean
  pickerItems: readonly PickerItem[]
  onOpenPicker: () => void
  onClosePicker: () => void
  onPick: (item: PickerItem) => void
  sessionID: string | null
  sessionDirectory?: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  /** Plugin Web surfaces stay session/project-bound; they are not project files. */
  pluginProjectDir: string | null
  diffs: FileDiffEntry[]
  liveDiffs?: unknown
  onActiveFileChange?: (rel: string | null) => void
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
  renderGoal?: () => JSX.Element
  renderWorld?: () => JSX.Element
  onDocumentSelect?: (id: string) => void
  onDocumentClose?: (id: string) => void
  onDocumentCloseMany?: (ids: readonly string[]) => void
  /** Mounts one plugin panel surface. */
  renderPluginSurface?: (id: string) => JSX.Element
  /** Declared Web surfaces (sandboxed pages). */
  webSurfaces?: readonly PluginWebSurfaceView[]
  /** Gateway origin; a restart on another port rebuilds the pages. */
  gatewayUrl?: string
  onWebBadge?: (surfaceId: string, count: number) => void
  onWebTitle?: (surfaceId: string, title: string) => void
  onWebError?: (surfaceId: string, message: string) => void
}

export function WorkbenchShell(props: WorkbenchShellProps): JSX.Element {
  const activePluginSurfaceId = (): PluginSurfaceId | null => {
    const subject = props.focusView?.subject
    return subject?.kind === "plugin"
      ? pluginSurfaceId(subject.package, subject.panel)
      : null
  }

  return (
    <div class="mafw-rw-shell">
      <Show
        when={props.focusView}
        fallback={
          <DockEmpty
            icon="layout-right"
            text="选择一个对象"
            hint="文件、Goal、变更或世界总览"
            action={{ label: "打开取景器", onClick: props.onOpenPicker }}
          />
        }
      >
        <FrameBar
          crumbs={props.frame?.crumbs ?? []}
          badges={props.frame?.badges ?? []}
          canBack={true}
          onBack={props.onFocusBack}
          onCrumb={props.onFocusCrumb}
          onOpenPicker={props.onOpenPicker}
        />
        <div class="mafw-focus-body">
          <FocusStage
            focus={props.focusView!}
            active={props.open}
            sessionID={props.sessionID}
            sessionDirectory={props.sessionDirectory}
            contentRoot={props.contentRoot}
            contentScopeKey={props.contentScopeKey}
            diffs={props.diffs}
            liveDiffs={props.liveDiffs}
            onActiveFileChange={props.onActiveFileChange}
            openRequest={props.focusOpenRequest}
            onSendAnnotation={props.onSendAnnotation}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
            onOpenReview={props.onOpenReview}
            onOpenDiffFile={props.onOpenDiffFile}
            onSendDiffComment={props.onSendDiffComment}
            onAddDiffAnnotation={props.onAddDiffAnnotation}
            renderPluginSurface={props.renderPluginSurface}
            webSurfaces={props.webSurfaces}
            gatewayUrl={props.gatewayUrl}
            onWebBadge={props.onWebBadge}
            onWebTitle={props.onWebTitle}
            onWebError={props.onWebError}
            renderGoal={props.renderGoal}
            renderWorld={props.renderWorld}
            onDocumentSelect={props.onDocumentSelect}
            onDocumentClose={props.onDocumentClose}
            onDocumentCloseMany={props.onDocumentCloseMany}
          />
          <PluginSurfaceStage
            activeSurfaceId={activePluginSurfaceId()}
            sessionID={props.sessionID}
            projectDir={props.pluginProjectDir}
            gatewayUrl={props.gatewayUrl}
            webSurfaces={props.webSurfaces}
            onBadge={props.onWebBadge}
            onTitle={props.onWebTitle}
            onError={props.onWebError}
          />
        </div>
      </Show>

      <SubjectPicker
        open={props.pickerOpen}
        items={props.pickerItems}
        onClose={props.onClosePicker}
        onPick={props.onPick}
      />
    </div>
  )
}
