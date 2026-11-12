// 插件 Web 页面缓存：首次访问后保持挂载，切换焦点不重新加载。
// 声明式面板由 FocusStage 渲染；这里只承载 sandboxed Web surface。
import { For, Show, createEffect, createSignal } from "solid-js"
import type { JSX } from "solid-js"
import { PluginWebSurfaceHost } from "../plugins/PluginWebSurfaceHost"
import type { PluginWebSurfaceView } from "../plugins/plugin-web-surface"
import type { PluginSurfaceId } from "../workbench-views"

export function PluginSurfaceStage(props: {
  activeSurfaceId: PluginSurfaceId | null
  sessionID: string | null
  projectDir: string | null
  gatewayUrl?: string
  webSurfaces?: readonly PluginWebSurfaceView[]
  onBadge?: (surfaceId: string, count: number) => void
  onTitle?: (surfaceId: string, title: string) => void
  onError?: (surfaceId: string, message: string) => void
}): JSX.Element {
  const [visited, setVisited] = createSignal<readonly string[]>([])

  createEffect(() => {
    const active = props.activeSurfaceId
    if (!active) return
    const view = (props.webSurfaces ?? []).find((item) => item.surfaceId === active)
    if (!view || visited().includes(view.surfaceId)) return
    setVisited((prev) => [...prev, view.surfaceId])
  })

  const mounted = () => (props.webSurfaces ?? []).filter((view) => visited().includes(view.surfaceId))

  return (
    <Show when={props.gatewayUrl}>
      <For each={mounted()}>
        {(view) => (
          <div
            class="mafw-plugin-web-stage"
            style={{ display: props.activeSurfaceId === view.surfaceId ? "contents" : "none" }}
          >
            <PluginWebSurfaceHost
              view={view}
              gatewayUrl={props.gatewayUrl ?? ""}
              sessionID={props.sessionID}
              projectDir={props.projectDir ?? ""}
              onBadge={(count) => props.onBadge?.(view.surfaceId, count)}
              onTitle={(title) => props.onTitle?.(view.surfaceId, title)}
              onError={(message) => props.onError?.(view.surfaceId, message)}
            />
          </div>
        )}
      </For>
    </Show>
  )
}
