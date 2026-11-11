// 右工作台 › 工作台：文件树 + 编辑器/浏览器。插件 surface 两类渲染器都在这里
// 落地：声明式面板（`renderPluginSurface`，MafwShell 解析 descriptor）与沙箱
// Web 页面（`PluginWebSurfaceHost`）。
// 文件树在窄内容宽（<600px）由 CSS 收为抽屉；宽屏始终作为左列。
import { For, Show, createEffect, createMemo, createSignal, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon } from "@mafw/ui/icon"
import { FilesDock } from "./FilesDock"
import { EditorDock } from "./EditorDock"
import { BrowserDock } from "./BrowserDock"
import { TerminalSurface } from "./TerminalSurface"
import type { FileDiffEntry } from "./DiffReviewPanel"
import { isPluginSurfaceId, type WorkbenchSurface } from "../workbench-views"
import { PluginWebSurfaceHost } from "../plugins/PluginWebSurfaceHost"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import type { AnnotationAnchor } from "../../../shared/annotation-types"

export function WorkbenchCodeView(props: {
  active: boolean
  surface: WorkbenchSurface
  sessionID: string | null
  contentRoot: string | null
  contentScopeKey: string | null
  diffs: FileDiffEntry[]
  onOpenFile: (rel: string) => void
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
  /** Task 8: mount the active `plugin:<package>:<panel>` surface. */
  renderPluginSurface?: (id: string) => JSX.Element
  /** Task 9: declared Web surfaces (sandboxed pages) reachable as L2 tabs. */
  webSurfaces?: readonly PluginWebSurfaceView[]
  /** Gateway origin; a restart on another port rebuilds the pages. */
  gatewayUrl?: string
  /** Page `setBadge(n)` → the shell's rail/tab badge store. */
  onWebBadge?: (surfaceId: string, count: number) => void
  /** Page `setTitle(t)` (or its `<title>`) → the tab/rail label. */
  onWebTitle?: (surfaceId: string, title: string) => void
  /** Bridge protocol/security failure or a terminal load failure. */
  onWebError?: (surfaceId: string, message: string) => void
}) {
  const [filesOpen, setFilesOpen] = createSignal(false)
  const openFile = (rel: string) => {
    setFilesOpen(false)
    props.onOpenFile(rel)
  }

  const webSurface = createMemo(
    () => props.webSurfaces?.find((view) => view.surfaceId === props.surface) ?? null,
  )
  // A page is mounted on its first visit and then kept alive (hidden) like the
  // browser tab: switching L2 tabs must not re-prepare a ticket and reload the
  // page. Unopened pages never boot, so a package cannot run a page the user
  // never opened. Removal from `webSurfaces` (revision) drops it automatically.
  const [visited, setVisited] = createSignal<readonly string[]>([])
  createEffect(() => {
    const view = webSurface()
    if (!view || visited().includes(view.surfaceId)) return
    setVisited((prev) => [...prev, view.surfaceId])
  })
  const mountedWebSurfaces = createMemo(() => {
    const ids = visited()
    return (props.webSurfaces ?? []).filter((view) => ids.includes(view.surfaceId))
  })

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
          <FilesDock
            sessionID={props.sessionID}
            contentRoot={props.contentRoot}
            scopeKey={props.contentScopeKey}
            onOpenFile={openFile}
          />
        </div>
      </Show>
      <div class="mafw-rw-code-main">
        <div class="mafw-rw-code-pane" style={{ display: props.surface === "code" ? "contents" : "none" }}>
          <EditorDock
            sessionID={props.sessionID}
            contentRoot={props.contentRoot}
            scopeKey={props.contentScopeKey}
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
        <div class="mafw-rw-code-pane" style={{ display: props.surface === "terminal" ? "contents" : "none" }}>
          <TerminalSurface
            directory={props.contentRoot}
            active={props.active && props.surface === "terminal"}
          />
        </div>
        <Show when={isPluginSurfaceId(props.surface) && !webSurface()}>
          <div class="mafw-rw-code-pane" style={{ display: "contents" }}>
            {props.renderPluginSurface?.(props.surface)}
          </div>
        </Show>
        <Show when={props.gatewayUrl}>
          <For each={mountedWebSurfaces()}>
            {(view) => (
              <div
                class="mafw-rw-code-pane"
                style={{ display: props.surface === view.surfaceId ? "contents" : "none" }}
              >
                <PluginWebSurfaceHost
                  view={view}
                  gatewayUrl={props.gatewayUrl ?? ""}
                  sessionID={props.sessionID}
                  projectDir={props.contentRoot ?? ""}
                  onBadge={(count) => props.onWebBadge?.(view.surfaceId, count)}
                  onTitle={(title) => props.onWebTitle?.(view.surfaceId, title)}
                  onError={(message) => props.onWebError?.(view.surfaceId, message)}
                />
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
