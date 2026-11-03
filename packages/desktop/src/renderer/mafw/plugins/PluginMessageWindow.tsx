// Task 11: one in-window plugin message window.
//
// The window is a controlled DOM overlay rendered inside the MAFW document.
// It owns only its `viewAction` state; singleton identity, focus ownership and
// revision cleanup live in `plugin-windows.ts` / `PluginWindowHost`.
//
// Fetch semantics match declarative panels (Task 8):
//   - capture the plugin generation + window identity before awaiting;
//   - discard responses for a superseded trigger/generation;
//   - keep the last good view on failure.
// Action widgets replace the view with a returned PluginView, show plain JSON
// output and refetch, and surface failures above the last good view.
import { Show, createEffect, createSignal, onCleanup, untrack, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { LoaderV2 } from "@mafw/ui/v2/loader-v2"
import { Icon } from "@mafw/ui/icon"
import { isPluginGenerationCurrent, pluginGeneration } from "./plugin-store"
import { classifyPanelActionOutput } from "./plugin-view-model"
import {
  EMPTY_PLUGIN_WINDOW_VIEW_STATE,
  beginWindowViewRequest,
  decidePluginWindowEscape,
  failWindowView,
  fetchPluginWindowView,
  pluginWindowActionInput,
  pluginWindowIdentity,
  replaceWindowView,
  setWindowActionOutput,
  settleWindowView,
  shouldShowPluginWindowClose,
  type PluginWindowEntry,
} from "./plugin-windows"
import { PluginViewRenderer } from "./PluginViewRenderer"

export function PluginMessageWindow(props: {
  entry: PluginWindowEntry
  /** Topmost modal owns the focus trap; lower modals stay inert. */
  topModal: boolean
  onClose: () => void
  /** Host focus-trap registry (called with the card element on mount/unmount). */
  onRegister: (element: HTMLElement | null) => void
}): JSX.Element {
  const [state, setState] = createSignal(EMPTY_PLUGIN_WINDOW_VIEW_STATE)
  let disposed = false

  onCleanup(() => {
    disposed = true
    props.onRegister(null)
  })

  const invokeView = (entry: PluginWindowEntry) =>
    window.api.mafw.plugins.invoke(
      entry.package,
      entry.declaration.viewAction,
      pluginWindowActionInput(entry.event),
      entry.event.sessionID,
    )

  async function load(): Promise<void> {
    if (disposed) return
    const entry = props.entry
    // Request bookkeeping is non-reactive: settling the view must not re-run
    // the identity effect (no fetch loop).
    const generation = untrack(() => pluginGeneration())
    const request = beginWindowViewRequest(untrack(() => state()), generation)
    setState(request)
    const requestId = request.requestId
    const result = await fetchPluginWindowView({
      invoke: () => invokeView(entry),
      generation: () => untrack(() => pluginGeneration()),
      isGenerationCurrent: (token) => isPluginGenerationCurrent(token),
      identity: () => pluginWindowIdentity(props.entry),
    })
    if (disposed || state().requestId !== requestId) return
    if (result.kind === "view") {
      setState((current) => settleWindowView(current, requestId, result.view))
    } else if (result.kind === "error") {
      setState((current) => failWindowView(current, requestId, result.message))
    }
    // `stale`: a newer trigger/revision/generation owns the view now.
  }

  // Fetch on mount and whenever the trigger, view action or package revision
  // changes. Compatible descriptor changes therefore refetch in place.
  createEffect(() => {
    props.entry.trigger
    props.entry.declaration.viewAction
    props.entry.descriptor.revision
    void load()
  })

  const runAction = async (action: string, input?: unknown) => {
    const entry = props.entry
    const generation = pluginGeneration()
    try {
      const raw = await window.api.mafw.plugins.invoke(
        entry.package,
        action,
        input,
        entry.event.sessionID,
      )
      if (disposed || !isPluginGenerationCurrent(generation)) return
      const outcome = classifyPanelActionOutput(raw)
      if (outcome.kind === "view") {
        setState((current) => replaceWindowView(current, outcome.view))
        return
      }
      if (outcome.kind === "result") {
        setState((current) => setWindowActionOutput(current, outcome.text))
      }
      void load()
    } catch (err) {
      if (disposed || !isPluginGenerationCurrent(generation)) return
      setState((current) => ({ ...current, error: `插件操作失败：${messageOf(err)}` }))
    }
  }

  const title = () => props.entry.declaration.title || props.entry.id
  const heading = () => (props.entry.modal ? "dialog" : "region")

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return
    // Modal Esc is decided by the host (capture phase); this handler only ever
    // sees modeless cards, and only closes when focus is inside a dismissible
    // one (the handler itself is proof of the focus context).
    const action = decidePluginWindowEscape({
      modalKey: null,
      entry: props.entry,
      focusInside: true,
    })
    if (action !== "close") return
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <div
      ref={(element) => {
        props.onRegister(element)
      }}
      class="mafw-plugin-window"
      classList={{ "is-modal": props.entry.modal, "is-under": props.entry.modal && !props.topModal }}
      role={heading()}
      aria-modal={props.entry.modal ? "true" : undefined}
      aria-label={title()}
      tabIndex={-1}
      data-plugin-window={props.entry.key}
      onKeyDown={onKeyDown}
    >
      <div class="mafw-plugin-window-head">
        <div class="mafw-plugin-window-title">{title()}</div>
        <Show when={shouldShowPluginWindowClose(props.entry)}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-plugin-window-close"
            aria-label="关闭插件窗口"
            onClick={props.onClose}
          >
            <Icon name="close" size="small" />
          </ButtonV2>
        </Show>
      </div>
      <div class="mafw-plugin-window-body">
        <Show
          when={state().view}
          fallback={
            <Show
              when={state().status === "loading" || state().status === "idle"}
              fallback={
                <div class="mafw-plugin-window-fallback">
                  <div class="mafw-empty">无法加载插件视图</div>
                  <Show when={state().error}>
                    <div class="mafw-plugin-window-error">{state().error}</div>
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
                <div class="mafw-plugin-window-error">{state().error}</div>
              </Show>
              <Show when={state().actionOutput}>
                <pre class="mafw-tool-output">{state().actionOutput}</pre>
              </Show>
              <PluginViewRenderer
                view={view()}
                heading={false}
                onAction={(action, input) => void runAction(action, input)}
              />
            </>
          )}
        </Show>
      </div>
    </div>
  )
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
