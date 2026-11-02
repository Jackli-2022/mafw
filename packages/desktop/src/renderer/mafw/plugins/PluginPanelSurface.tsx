// Task 8: one dynamic workbench L2 surface backed by a package `viewAction`.
//
// Fetch contract:
//   - capture the plugin generation + a local request id before awaiting;
//   - discard responses whose request id or generation is stale;
//   - subscribe only to the panel's declared `refreshOn` events;
//   - keep the last good view on failures.
// Action widgets invoke the current package action through the preload API:
// a valid PluginView replaces the view, other JSON is shown and triggers a
// refetch, errors keep the last good view.
import { Show, createEffect, createSignal, onCleanup } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import type { PluginClientDescriptor, PluginPanelDescriptor } from "@mafw/plugin-contract"
import { isPluginGenerationCurrent, pluginGeneration, subscribePluginEvent } from "./plugin-store"
import {
  EMPTY_PLUGIN_PANEL_VIEW_STATE,
  beginPanelViewRequest,
  classifyPanelActionOutput,
  failPanelView,
  panelRequestStillCurrent,
  panelRequestToken,
  pluginPanelRefreshesOn,
  replacePanelView,
  setPanelActionOutput,
  settlePanelView,
  type PluginPanelViewState,
} from "./plugin-view-model"
import { PluginViewRenderer } from "./PluginViewRenderer"

export function PluginPanelSurface(props: {
  descriptor: PluginClientDescriptor
  panel: PluginPanelDescriptor
  sessionID: string | null
}) {
  const [state, setState] = createSignal<PluginPanelViewState>(EMPTY_PLUGIN_PANEL_VIEW_STATE)
  let disposed = false

  const load = async () => {
    if (disposed) return
    setState((current) => beginPanelViewRequest(current, pluginGeneration()))
    const token = panelRequestToken(state())
    if (!token) return
    try {
      const raw = await window.api.mafw.plugins.invoke(
        props.descriptor.name,
        props.panel.viewAction,
        { input: {}, sessionID: props.sessionID ?? undefined },
        props.sessionID ?? undefined,
      )
      if (disposed) return
      if (!panelRequestStillCurrent(state(), token, pluginGeneration())) return
      setState((current) => settlePanelView(current, token.requestId, raw))
    } catch (err) {
      if (disposed) return
      if (!panelRequestStillCurrent(state(), token, pluginGeneration())) return
      setState((current) => failPanelView(current, token.requestId, messageOf(err)))
    }
  }

  // Initial load + descriptor/panel/session identity changes.
  createEffect(() => {
    // Track the inputs explicitly: descriptor objects may be recreated without
    // changing the panel, and the revision proves the package content changed.
    props.descriptor.revision
    props.descriptor.name
    props.panel.id
    props.panel.viewAction
    props.sessionID
    void load()
  })

  // Refresh only when the package emits an event this panel subscribed to.
  createEffect(() => {
    const packageName = props.descriptor.name
    const refreshOn = props.panel.refreshOn ?? []
    if (refreshOn.length === 0) return
    const unsubscribes = refreshOn.map((eventType) =>
      subscribePluginEvent(eventType, (notice) => {
        if (!pluginPanelRefreshesOn(props.panel, packageName, notice.type)) return
        void load()
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
      if (disposed || !isPluginGenerationCurrent(generation)) return
      const outcome = classifyPanelActionOutput(raw)
      if (outcome.kind === "view") {
        // A valid PluginView replaces the current view; no refetch is needed.
        setState((current) => replacePanelView(current, outcome.view))
        return
      }
      if (outcome.kind === "result") {
        setState((current) => setPanelActionOutput(current, outcome.text))
      }
      // JSON result or undefined → show whatever arrived and refetch fresh state.
      void load()
    } catch (err) {
      if (disposed || !isPluginGenerationCurrent(generation)) return
      // Keep the last good view; surface the action failure as a banner.
      setState((current) => ({ ...current, error: `插件操作失败：${messageOf(err)}` }))
    }
  }

  onCleanup(() => {
    disposed = true
  })

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
                <ButtonV2 variant="outline" size="small" onClick={() => void load()}>
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
