// Task 8 fix: panel fetch controller.
//
// Request bookkeeping is deliberately non-reactive: `requestSeq` is a plain
// counter and the plugin generation is read with `untrack`. A component effect
// may therefore call `load()` while depending only on its identity inputs —
// settling the view never re-runs the effect and never triggers a fetch loop.
import {
  createSignal as solidCreateSignal,
  untrack as solidUntrack,
  type Accessor,
  type Setter,
} from "solid-js"
import type { PluginView } from "@mafw/plugin-contract"
import type { PluginGeneration } from "./plugin-client"
import {
  EMPTY_PLUGIN_PANEL_VIEW_STATE,
  beginPanelViewRequest,
  failPanelView,
  replacePanelView,
  setPanelActionOutput,
  settlePanelView,
  type PluginPanelViewState,
} from "./plugin-view-model"

/**
 * Signal runtime seam. Production uses `solid-js` (the renderer bundle gets
 * Solid's browser build); the effect-loop regression test injects the browser
 * build explicitly because Node resolves `solid-js` to the non-reactive SSR
 * build where `createEffect` is a no-op.
 */
export interface PluginPanelLoaderRuntime {
  createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  untrack<T>(fn: () => T): T
}

const defaultRuntime: PluginPanelLoaderRuntime = {
  createSignal: solidCreateSignal,
  untrack: solidUntrack,
}

export interface PluginPanelLoaderDeps {
  /** Runs the panel `viewAction` (may synchronously read identity inputs). */
  invoke: () => Promise<unknown>
  /** Current plugin client generation, captured before the await. */
  generation: () => PluginGeneration
  /** Stale-boot/revision guard evaluated after the await. */
  isGenerationCurrent: (generation: PluginGeneration) => boolean
}

export interface PluginPanelLoader {
  state: Accessor<PluginPanelViewState>
  load: () => Promise<void>
  /** Replace the view with one returned by an action widget. */
  applyView: (view: PluginView) => void
  setActionOutput: (text: string | null) => void
  setActionError: (message: string) => void
  dispose: () => void
}

export function createPluginPanelLoader(
  deps: PluginPanelLoaderDeps,
  runtime: PluginPanelLoaderRuntime = defaultRuntime,
): PluginPanelLoader {
  const [state, setState] = runtime.createSignal<PluginPanelViewState>(
    EMPTY_PLUGIN_PANEL_VIEW_STATE,
  )
  let requestSeq = 0
  let disposed = false

  const load = async (): Promise<void> => {
    if (disposed) return
    const requestId = ++requestSeq
    const generation = runtime.untrack(() => deps.generation())
    setState((current) => ({ ...beginPanelViewRequest(current, generation), requestId }))
    try {
      const raw = await deps.invoke()
      if (disposed || requestId !== requestSeq) return
      if (!deps.isGenerationCurrent(generation)) return
      setState((current) => settlePanelView(current, requestId, raw))
    } catch (err) {
      if (disposed || requestId !== requestSeq) return
      if (!deps.isGenerationCurrent(generation)) return
      setState((current) => failPanelView(current, requestId, messageOf(err)))
    }
  }

  return {
    state,
    load,
    applyView: (view) => setState((current) => replacePanelView(current, view)),
    setActionOutput: (text) => setState((current) => setPanelActionOutput(current, text)),
    setActionError: (message) => setState((current) => ({ ...current, error: message })),
    dispose: () => {
      disposed = true
    },
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
