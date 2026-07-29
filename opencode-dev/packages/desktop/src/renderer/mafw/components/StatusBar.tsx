// @ts-nocheck
import { createSignal, onMount, onCleanup } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { MafwContextMenu } from "./MafwContextMenu"
import type { ContextMenuItem } from "./MafwContextMenu"

export function StatusBar() {
  const [status, setStatus] = createSignal<any>(null)

  onMount(() => {
    window.api.mafw.gateway.info().then(setStatus)
    const unsub = window.api.mafw.gateway.onStateChange(setStatus)
    onCleanup(() => unsub())
  })

  const s = () => status()
  const state = () => s()?.state || "unknown"
  const items: ContextMenuItem[] = [
    { label: "Restart Gateway", onSelect: () => window.api.mafw.gateway.restart() },
    { label: "Copy Gateway URL", onSelect: () => s()?.url ? navigator.clipboard.writeText(s().url) : undefined, disabled: !s()?.url },
  ]

  return (
    <MafwContextMenu items={items}>
      <div class="mafw-statusbar">
        <span class={`mafw-status-dot ${state()}`} />
        <TooltipV2 value={s()?.url || state()} openDelay={300}>
          <span class="mafw-status-text">
            {state() === "ready" ? `connected` :
             state() === "starting" ? "starting..." :
             state() === "failed" ? "failed" :
             "disconnected"}
          </span>
        </TooltipV2>
        {s()?.port && <span class="mafw-status-port">:{s().port}</span>}
        {state() === "failed" && (
          <ButtonV2 variant="ghost" size="small" onClick={() => window.api.mafw.gateway.restart()}>
            restart
          </ButtonV2>
        )}
      </div>
    </MafwContextMenu>
  )
}
