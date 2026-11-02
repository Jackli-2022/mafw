// Task 8: one dynamic workbench L2 surface backed by a package `viewAction`.
//
// Fetch contract:
//   - capture the plugin generation + a plain request counter before awaiting;
//   - discard responses whose counter or generation is stale;
//   - subscribe only to the panel's declared `refreshOn` events;
//   - keep the last good view on failures.
// Action widgets invoke the current package action through the preload API:
// a valid PluginView replaces the view, other JSON is shown and triggers a
// refetch, errors keep the last good view.
import { Show, createEffect, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import type { PluginClientDescriptor, PluginPanelDescriptor } from "@mafw/plugin-contract"
import { isPluginGenerationCurrent, pluginGeneration, subscribePluginEvent } from "./plugin-store"
import { createPluginPanelLoader } from "./plugin-panel-loader"
import { invokePanelViewAction } from "./plugin-panel-invoke"
import {
  classifyPanelActionOutput,
  pluginPanelRefreshesOn,
  replacePanelView,
  setPanelActionOutput,
} from "./plugin-view-model"
import { PluginViewRenderer } from "./PluginViewRenderer"

export function PluginPanelSurface(props: {
  descriptor: PluginClientDescriptor
  panel: PluginPanelDescriptor
  sessionID: string | null
}) {
  const loader = createPluginPanelLoader({
    invoke: () =>
      invokePanelViewAction(
        (...args) => window.api.mafw.plugins.invoke(...args),
        props.descriptor.name,
        props.panel.viewAction,
        props.sessionID,
      ),
    generation: () => pluginGeneration(),
    isGenerationCurrent: (generation) => isPluginGenerationCurrent(generation),
  })
  const state = loader.state

  // Initial load + descriptor/panel/session identity changes. Request
  // bookkeeping inside `load` is non-reactive, so settling the view cannot
  // re-trigger this effect (no fetch loop).
  createEffect(() => {
    // Track the inputs explicitly: descriptor objects may be recreated without
    // changing the panel, and the revision proves the package content changed.
    props.descriptor.revision
    props.descriptor.name
    props.panel.id
    props.panel.viewAction
    props.sessionID
    void loader.load()
  })

  // Refresh only when the package emits an event this panel subscribed to.
  createEffect(() => {
    const packageName = props.descriptor.name
    const refreshOn = props.panel.refreshOn ?? []
    if (refreshOn.length === 0) return
    const unsubscribes = refreshOn.map((eventType) =>
      subscribePluginEvent(eventType, (notice) => {
        if (!pluginPanelRefreshesOn(props.panel, packageName, notice.type)) return
        void loader.load()
      }),
    )
    onCleanup(() => {
      for (const unsubscribe of unsubscribes) unsubscribe()
    })
  })

  const runAction = async (action: string, input?: unknown) => {
    const generation = pluginGeneration()
    try {
      const raw = await window.api.mafw.plugins.invoke(
        props.descriptor.name,
        action,
        input,
        props.sessionID ?? undefined,
      )
      if (!isPluginGenerationCurrent(generation)) return
      const outcome = classifyPanelActionOutput(raw)
      if (outcome.kind === "view") {
        // A valid PluginView replaces the current view; no refetch is needed.
        loader.applyView(outcome.view)
        return
      }
      if (outcome.kind === "result") {
        loader.setActionOutput(outcome.text)
      }
      // JSON result or undefined → show whatever arrived and refetch fresh state.
      void loader.load()
    } catch (err) {
      // Keep the last good view; surface the action failure as a banner.
      if (!isPluginGenerationCurrent(generation)) return
      loader.setActionError(`插件操作失败：${messageOf(err)}`)
    }
  }

  onCleanup(() => loader.dispose())

  return (
    <div
      class="mafw-plugin-surface"
      style={{
        flex: "1",
        "min-height": "0",
        "overflow-y": "auto",
        padding: "12px",
        display: "flex",
        "flex-direction": "column",
        gap: "8px",
      }}
    >
      <Show
        when={state().view}
        fallback={
          <Show
            when={state().status === "loading" || state().status === "idle"}
            fallback={
              <div style={{ display: "flex", "flex-direction": "column", gap: "6px", "align-items": "flex-start" }}>
                <div class="mafw-empty">无法加载插件视图</div>
                <Show when={state().error}>
                  <div style={{ "font-size": "12px", color: "var(--text-weak)" }}>{state().error}</div>
                </Show>
                <ButtonV2 variant="outline" size="small" onClick={() => void loader.load()}>
                  重试
                </ButtonV2>
              </div>
            }
          >
            <div class="mafw-config-inline-loading">
              <LoaderV2 width={14} height={14} /> 加载中…
            </div>
          </Show>
        }
      >
        {(view) => (
          <>
            <Show when={state().error}>
              <div
                style={{
                  "font-size": "12px",
                  color: "var(--text-weak)",
                  "border-left": "2px solid var(--danger, #e5484d)",
                  "padding-left": "8px",
                }}
              >
                {state().error}
              </div>
            </Show>
            <Show when={state().actionOutput}>
              <pre class="mafw-tool-output">{state().actionOutput}</pre>
            </Show>
            <PluginViewRenderer view={view()} onAction={(action, input) => void runAction(action, input)} />
          </>
        )}
      </Show>
    </div>
  )
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
