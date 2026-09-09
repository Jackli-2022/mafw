// @ts-nocheck
import { Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { TabsV2 } from "@mafw/ui/v2/tabs-v2"

export function RightDock(props: {
  open: boolean
  tab: "tasks" | "trajectory" | "usage" | "quota"
  width: number
  onClose: () => void
  onTab: (tab: "tasks" | "trajectory" | "usage" | "quota") => void
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-tabs">
          <TabsV2 value={props.tab} onChange={props.onTab} variant="pill">
            <TabsV2.List class="mafw-right-dock-tab-list">
              <TabsV2.Trigger value="tasks">📋 任务</TabsV2.Trigger>
              <TabsV2.Trigger value="trajectory">📊 轨迹</TabsV2.Trigger>
              <TabsV2.Trigger value="usage">📈 用量</TabsV2.Trigger>
              <TabsV2.Trigger value="quota">⏳ 配额</TabsV2.Trigger>
              <TabsV2.Trigger value="notes">📝 便签</TabsV2.Trigger>
            </TabsV2.List>
          </TabsV2>
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
