// Task 10: unified declarative tool-card proxy (Solid binding).
//
// Registration/restore/claim logic lives in the Solid-free, injectable
// `plugin-tool-card-registry.ts`; this file only supplies the JSX proxy and the
// concrete ports (ToolRegistry, legacy cards, plugin store).
//
// While a tool part is pending/running the original card renders. When it
// settles (completed/error) the package `viewAction` runs exactly once with the
// neutral ToolCardModel as its raw input. Invalid output, failures and stale
// plugin generations fall back to the original card; plugin code never runs in
// the renderer. The proxy opts into error rendering (`handlesError`) so error
// parts reach the package card instead of the generic ToolErrorCard.
// `handlesError: true` suppresses the generic ToolErrorCard, so the fallback
// (no plugin view / failed action / stale generation) renders the part error
// above the original card instead of hiding the reason.
import { Show, createEffect, createResource, createRoot, createSignal } from "solid-js"
import { GenericTool } from "@mafw/session-ui/basic-tool"
import {
  ToolRegistry,
  type ToolComponent,
  type ToolProps,
} from "@mafw/session-ui/message-part"
import type { PluginView } from "@mafw/plugin-contract"
import { setUnifiedToolCardClaims } from "../components/tool-cards/registered-tools"
import { reapplyUserPluginCards, releaseLegacyToolCard } from "../components/UserPluginCards"
import {
  isPluginGenerationCurrent,
  pluginClientRevision,
  pluginDescriptors,
  pluginGeneration,
} from "./plugin-store"
import {
  planToolCardInvocation,
  toolCardModel,
  toolCardResponseCurrent,
  toolCardViewOf,
} from "./plugin-tool-card-model"
import { createUnifiedToolCardController } from "./plugin-tool-card-registry"
import { PluginViewRenderer } from "./PluginViewRenderer"
import { classifyPanelActionOutput } from "./plugin-view-model"

interface UnifiedCardBinding {
  packageName: string
  viewAction: string
  /** Card replaced by this proxy; `undefined` = the default GenericTool chain. */
  original?: ToolComponent
}

function UnifiedToolCardProxy(props: ToolProps & { unified: UnifiedCardBinding }) {
  // A valid view returned by an embedded action widget replaces the view; other
  // JSON is shown and the current `viewAction` is refetched (spec §8.2).
  const [actionView, setActionView] = createSignal<PluginView | null>(null)
  const [actionOutput, setActionOutput] = createSignal<string | null>(null)
  const [actionError, setActionError] = createSignal<string | null>(null)

  // Invoke-once gate: a settled part sets the resource source exactly once, so
  // streaming output growth never re-invokes the package action.
  const [invokeKey, setInvokeKey] = createSignal<string | null>(null)
  let previousKey: string | null = null
  createEffect(() => {
    const plan = planToolCardInvocation(previousKey, { tool: props.tool, status: props.status })
    previousKey = plan.key
    if (plan.invoke) setInvokeKey(plan.key)
  })

  const [result, { refetch }] = createResource(invokeKey, async () => {
    const generation = pluginGeneration()
    const payload = toolCardModel({
      tool: props.tool,
      input: props.input,
      output: props.output,
      metadata: props.metadata,
      status: props.status,
      error: props.error,
      sessionID: props.sessionID,
    })
    try {
      const raw = await window.api.mafw.plugins.invoke(
        props.unified.packageName,
        props.unified.viewAction,
        payload,
        props.sessionID,
      )
      if (!toolCardResponseCurrent(generation, pluginGeneration())) return null
      return toolCardViewOf(raw)
    } catch {
      return null // fail-open: keep the default card
    }
  })

  const view = () => actionView() ?? result() ?? null

  const fallback = () => {
    const original = props.unified.original
    // `handlesError: true` suppresses the generic ToolErrorCard, so the fallback
    // (no plugin view / failed action / stale generation) must show the reason
    // itself while keeping the original card visible.
    return (
      <div class="mafw-plugin-tool-fallback">
        <Show when={typeof props.error === "string" && props.error.length > 0}>
          <div class="mafw-plugin-tool-error">{props.error}</div>
        </Show>
        {original ? original(props) : <GenericTool {...props} />}
      </div>
    )
  }

  const runAction = async (action: string, input?: unknown) => {
    const generation = pluginGeneration()
    setActionError(null)
    try {
      const raw = await window.api.mafw.plugins.invoke(
        props.unified.packageName,
        action,
        input,
        props.sessionID,
      )
      if (!toolCardResponseCurrent(generation, pluginGeneration())) return
      const outcome = classifyPanelActionOutput(raw)
      if (outcome.kind === "view") {
        setActionOutput(null)
        setActionView(outcome.view)
        return
      }
      if (outcome.kind === "result") setActionOutput(outcome.text)
      // Plain JSON / no output: show the result, then refetch the card view.
      setActionView(null)
      void refetch()
    } catch (err) {
      if (!toolCardResponseCurrent(generation, pluginGeneration())) return
      setActionError(`插件操作失败：${messageOf(err)}`)
    }
  }

  const hasPluginContent = () => view() !== null || actionOutput() !== null || actionError() !== null

  return (
    <Show when={hasPluginContent()} fallback={fallback()}>
      <div class="mafw-plugin-tool-card" style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
        <Show when={actionError()}>
          <div
            style={{
              "font-size": "12px",
              color: "var(--text-weak)",
              "border-left": "2px solid var(--danger, #e5484d)",
              "padding-left": "8px",
            }}
          >
            {actionError()}
          </div>
        </Show>
        <Show when={actionOutput()}>
          <pre class="mafw-tool-output">{actionOutput()}</pre>
        </Show>
        <Show when={view()} fallback={fallback()}>
          {(current) => (
            <PluginViewRenderer view={current()} onAction={(action, input) => void runAction(action, input)} />
          )}
        </Show>
      </div>
    </Show>
  )
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const controller = createUnifiedToolCardController<ToolComponent>({
  descriptors: () => pluginDescriptors(),
  generation: () => pluginGeneration(),
  isGenerationCurrent: (generation) => isPluginGenerationCurrent(generation),
  listLegacy: () => window.api.mafw.uiPlugins.list(),
  registry: {
    render: (target) => ToolRegistry.render(target),
    register: (target, card) => ToolRegistry.register({ name: target, render: card }),
  },
  releaseLegacy: (target) => releaseLegacyToolCard(target),
  reapplyLegacy: () => reapplyUserPluginCards(),
  setClaims: (targets) => setUnifiedToolCardClaims(targets),
  bind: (entry, fallback) => {
    const binding: UnifiedCardBinding = {
      packageName: entry.descriptor.name,
      viewAction: entry.card.viewAction,
      original: fallback,
    }
    ToolRegistry.register({
      name: entry.target,
      handlesError: true,
      render: (props: ToolProps) => <UnifiedToolCardProxy {...props} unified={binding} />,
    })
  },
})

/** Apply the committed snapshot (exported for tests / later management UI). */
export function applyUnifiedToolCards(): Promise<boolean> {
  return controller.apply()
}

/** Targets currently bound to unified proxies. */
export function unifiedToolCardTargets(): string[] {
  return controller.targets()
}

let disposeRegistration: (() => void) | undefined

/**
 * Register unified tool cards and keep them in sync with plugin revisions.
 * Must run after `registerMafwToolCards()` (captures original cards) and
 * preferably after `registerUserPluginCards()`.
 */
export function registerUnifiedToolCards(): void {
  if (disposeRegistration) return
  disposeRegistration = createRoot((dispose) => {
    createEffect(() => {
      // Track the committed revision; descriptor identity changes with it.
      pluginClientRevision()
      void controller.apply().catch(() => {
        // Fail-open: registration never breaks the transcript.
      })
    })
    return dispose
  })
}

/** Test/dev teardown: restores originals and drops claims. */
export function resetUnifiedToolCards(): void {
  controller.reset()
  disposeRegistration?.()
  disposeRegistration = undefined
}
