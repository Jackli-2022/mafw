import { Match, Switch, type JSX } from "solid-js"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import { TerminalSurface } from "./TerminalSurface"
import { DockEmpty } from "./dock-panel"
import type { FileDiffEntry } from "./DiffReviewPanel"
import type { AnnotationAnchor } from "../../../shared/annotation-types"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import type { Focus } from "../focus/focus-model"
import { stageKindFor } from "../focus/stage-dispatch"

/** 工作台的「台」：只放当前对象；文件 / 浏览器 / 终端 / 插件 / 变更集 / Goal / 世界。 */
export function FocusStage(props: {
  focus: Focus
  active: boolean
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  diffs: FileDiffEntry[]
  onActiveFileChange?: (rel: string | null) => void
  openRequest?: { root: string; rel: string; nonce: number } | null
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
  renderPluginSurface?: (id: string) => JSX.Element
  webSurfaces?: readonly PluginWebSurfaceView[]
  gatewayUrl?: string
  onWebBadge?: (surfaceId: string, count: number) => void
  onWebTitle?: (surfaceId: string, title: string) => void
  onWebError?: (surfaceId: string, message: string) => void
  renderChangeSet?: () => JSX.Element
  renderGoal?: () => JSX.Element
  renderWorld?: () => JSX.Element
}): JSX.Element {
  const kind = () => stageKindFor(props.focus)
  const pluginId = () => {
    const subject = props.focus.subject
    return subject.kind === "plugin" ? `plugin:${subject.package}:${subject.panel}` : null
  }

  return (
    <div class="mafw-focus-stage">
      <Switch>
        <Match when={kind() === "editor"}>
          <EditorDock
            sessionID={props.sessionID}
            contentRoot={props.contentRoot}
            scopeKey={props.contentScopeKey}
            intent={props.focus.lens === "edit" ? "editing" : "reading"}
            onActiveFileChange={props.onActiveFileChange}
            openRequest={props.openRequest}
            diffs={props.diffs}
            onSendAnnotation={props.onSendAnnotation}
            onAddAnnotation={props.onAddAnnotation}
            onSendComment={props.onSendComment}
            onOpenReview={props.onOpenReview}
          />
        </Match>

        <Match when={kind() === "browser"}>
          <BrowserDock sessionID={props.sessionID} />
        </Match>

        <Match when={kind() === "terminal"}>
          <TerminalSurface directory={props.contentRoot} active={props.active} />
        </Match>

        <Match when={kind() === "plugin"}>
          {pluginId() ? props.renderPluginSurface?.(pluginId()!) : null}
        </Match>

        <Match when={kind() === "changeSet"}>
          {props.renderChangeSet?.() ?? <DockEmpty icon="code-lines" text="变更集舞台待接入" />}
        </Match>

        <Match when={kind() === "goal"}>
          {props.renderGoal?.() ?? <DockEmpty icon="dot-grid" text="Goal 总览待接入" />}
        </Match>

        <Match when={kind() === "world"}>
          {props.renderWorld?.() ?? <DockEmpty icon="folder" text="世界总览待接入" />}
        </Match>
      </Switch>
    </div>
  )
}
