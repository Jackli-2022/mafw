// @ts-nocheck
import { Show } from "solid-js"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

export function RightDock(props: {
  open: boolean
  tab: "tasks" | "trajectory"
  width: number
  onClose: () => void
  onTab: (tab: "tasks" | "trajectory") => void
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-tabs">
          <ButtonV2
            variant={props.tab === "tasks" ? "contrast" : "ghost"}
            size="small"
            class="mafw-right-dock-tab"
            onClick={() => props.onTab("tasks")}
            aria-label="任务列表"
          >
            📋 任务
          </ButtonV2>
          <ButtonV2
            variant={props.tab === "trajectory" ? "contrast" : "ghost"}
            size="small"
            class="mafw-right-dock-tab"
            onClick={() => props.onTab("trajectory")}
            aria-label="轨迹时间线"
          >
            📊 轨迹
          </ButtonV2>
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
