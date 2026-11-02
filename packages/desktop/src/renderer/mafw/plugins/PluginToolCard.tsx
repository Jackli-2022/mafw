// Task 10: unified declarative tool-card proxy.
//
// Registration mirrors `UserPluginCards` (restore-original + proxy + fail-open)
// and runs after the built-in MAFW cards so it can capture them:
//   - only `override: true` may replace an occupied (built-in/legacy) card;
//   - unified cards claim their targets so an async legacy rescan cannot
//     silently overwrite them (and a removed descriptor releases the claim);
//   - every plugin revision re-applies the proxy set (removal restores the
//     original card).
//
// Rendering keeps the default chain while the tool part is pending/running and
// invokes the package `viewAction` exactly once when it settles
// (completed/error). The neutral ToolCardModel is sent as the raw action input.
// Invalid output, action failures and stale plugin generations fall back to the
// original card; plugin code never runs in the renderer.
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
  effectiveToolCardTargets,
  planToolCardInvocation,
  toolCardModel,
  toolCardResponseCurrent,
  toolCardViewOf,
  type LegacyToolCardEntry,
} from "./plugin-tool-card-model"
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
    return original ? original(props) : <GenericTool {...props} />
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

const proxies = new Map<string, UnifiedCardBinding>()

/**
 * Rebuild the unified proxy set from the committed client snapshot.
 *
 * Stale responses (a newer revision arrived while the legacy list was in flight)
 * are discarded. The claim set is swapped before registration so a concurrent
 * legacy rescan skips taken tools; removed descriptors restore the original
 * card and release claims, then legacy cards are re-listed.
 */
export async function applyUnifiedToolCards(): Promise<void> {
  const generation = pluginGeneration()
  const descriptors = pluginDescriptors()

  let legacyEntries: LegacyToolCardEntry[] = []
  try {
    legacyEntries = await window.api.mafw.uiPlugins.list()
  } catch {
    legacyEntries = []
  }
  if (!isPluginGenerationCurrent(generation)) return

  const next = effectiveToolCardTargets(descriptors, legacyEntries, {
    // Currently registered unified proxies are handled by the restore below,
    // so only externally owned keys count as occupied.
    isOccupied: (target) => !proxies.has(target) && ToolRegistry.render(target) !== undefined,
  })
  setUnifiedToolCardClaims(next.map((entry) => entry.target))

  // Restore every card replaced by the previous revision before registering the
  // new set; `ToolRegistry.register` is overwrite semantics.
  for (const [target, binding] of [...proxies]) {
    ToolRegistry.register({ name: target, render: binding.original })
  }
  proxies.clear()

  for (const entry of next) {
    // `override: true` may take a slot from a legacy card. Releasing also
    // prevents a later legacy rescan from reclaiming the tool.
    if (entry.card.override === true) releaseLegacyToolCard(entry.target)
    const binding: UnifiedCardBinding = {
      packageName: entry.descriptor.name,
      viewAction: entry.card.viewAction,
      original: ToolRegistry.render(entry.target),
    }
    proxies.set(entry.target, binding)
    ToolRegistry.register({
      name: entry.target,
      render: (props: ToolProps) => <UnifiedToolCardProxy {...props} unified={binding} />,
    })
  }

  // Bring back legacy cards on tools that are no longer claimed (removed
  // descriptor, or a legacy card released by an earlier override).
  reapplyUserPluginCards()
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
      void applyUnifiedToolCards().catch(() => {
        // Fail-open: registration never breaks the transcript.
      })
    })
    return dispose
  })
}

/** Test/dev teardown: restores originals and drops claims. */
export function resetUnifiedToolCards(): void {
  for (const [target, binding] of [...proxies]) {
    ToolRegistry.register({ name: target, render: binding.original })
  }
  proxies.clear()
  setUnifiedToolCardClaims([])
  disposeRegistration?.()
  disposeRegistration = undefined
}
