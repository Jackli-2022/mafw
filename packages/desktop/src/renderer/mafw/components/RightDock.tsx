// @ts-nocheck
import { Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"

export function RightDock(props: {
  open: boolean
  width: number
  onClose: () => void
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-head">
          <div class="mafw-right-dock-spacer" />
          <TooltipV2 value="关闭面板" openDelay={300}>
            <ButtonV2 variant="ghost" size="small" class="mafw-right-dock-close" onClick={props.onClose} aria-label="关闭面板">
              ✕
            </ButtonV2>
          </TooltipV2>
        </div>
        <div class="mafw-right-dock-body">{props.children}</div>
      </div>
    </Show>
  )
}
