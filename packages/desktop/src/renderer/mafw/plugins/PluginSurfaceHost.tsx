// Task 8/9: resolves one `plugin:<package>:<id>` surface id to its committed
// descriptor and mounts the dynamic panel or declarative config page.
//
// The keyed Show keys on the *surface id*, not the surface object: a plugin
// revision replaces descriptors (and therefore surface objects), but the id is
// stable. Panel/config view state therefore survives a revision change and the
// child controller can implement "stale draft requires reload" instead of
// being silently remounted with fresh values.
import { Show, createMemo } from "solid-js"
import { PluginPanelSurface } from "./PluginPanelSurface"
import { PluginConfigPage } from "./PluginConfigPage"
import type { PluginConfigSurface, PluginSurface } from "./plugin-view-model"

export function PluginSurfaceHost(props: {
  id: string
  surfaces: readonly PluginSurface[]
  configSurfaces?: readonly PluginConfigSurface[]
  sessionID: string | null
}) {
  const panel = createMemo(() => props.surfaces.find((entry) => entry.id === props.id) ?? null)
  const config = createMemo(
    () => props.configSurfaces?.find((entry) => entry.id === props.id) ?? null,
  )
  const panelKey = createMemo(() => (panel() ? props.id : null))
  const configKey = createMemo(() => (config() ? props.id : null))

  return (
    <Show
      keyed
      when={panelKey()}
      fallback={
        <Show
          keyed
          when={configKey()}
          fallback={<div class="mafw-empty">插件视图不可用</div>}
        >
          {(_key) => {
            const entry = createMemo(
              () => props.configSurfaces?.find((item) => item.id === props.id) ?? null,
            )
            return (
              <Show when={entry()}>
                {(surface) => (
                  <PluginConfigPage
                    descriptor={surface().descriptor}
                    page={surface().page}
                    sessionID={props.sessionID}
                  />
                )}
              </Show>
            )
          }}
        </Show>
      }
    >
      {(_key) => {
        const entry = createMemo(
          () => props.surfaces.find((item) => item.id === props.id) ?? null,
        )
        return (
          <Show when={entry()}>
            {(surface) => (
              <PluginPanelSurface
                descriptor={surface().descriptor}
                panel={surface().panel}
                sessionID={props.sessionID}
              />
            )}
          </Show>
        )
      }}
    </Show>
  )
}
