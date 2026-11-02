// Task 8: resolves one `plugin:<package>:<panel>` surface id to its committed
// descriptor and mounts the dynamic panel. The keyed Show remounts the panel
// when the id changes, so no state leaks between packages/panels.
import { Show, createMemo } from "solid-js"
import { PluginPanelSurface } from "./PluginPanelSurface"
import type { PluginSurface } from "./plugin-view-model"

export function PluginSurfaceHost(props: {
  id: string
  surfaces: readonly PluginSurface[]
  sessionID: string | null
}) {
  const surface = createMemo(() => props.surfaces.find((entry) => entry.id === props.id) ?? null)

  return (
    <Show
      keyed
      when={surface()}
      fallback={<div class="mafw-empty">插件视图不可用</div>}
    >
      {(entry) => (
        <PluginPanelSurface
          descriptor={entry.descriptor}
          panel={entry.panel}
          sessionID={props.sessionID}
        />
      )}
    </Show>
  )
}
