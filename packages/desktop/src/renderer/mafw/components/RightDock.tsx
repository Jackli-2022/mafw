// @ts-nocheck
import { Show } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { TabsV2 } from "@mafw/ui/v2/tabs-v2"
import { type DockTab } from "./dock-tab"

export function RightDock(props: {
  open: boolean
  tab: DockTab
  width: number
  onClose: () => void
  onTab: (tab: DockTab) => void
  /** 全局 running 子代理数（徽标；0/缺省不显示）。 */
  subagentBadge?: number
  /** 全局 running 后台任务数（徽标；0/缺省不显示）。 */
  backgroundBadge?: number
  children: any
}) {
  return (
    <Show when={props.open}>
      <div class="mafw-right-dock" style={{ width: `${props.width}px` }}>
        <div class="mafw-right-dock-head">
          <TabsV2 value={props.tab} onChange={props.onTab} variant="pill">
            <TabsV2.List class="mafw-right-dock-tab-list">
              <TabsV2.Trigger value="tasks">📋 任务</TabsV2.Trigger>
              <TabsV2.Trigger value="trajectory">📊 轨迹</TabsV2.Trigger>
              <TabsV2.Trigger value="usage">📈 用量</TabsV2.Trigger>
              <TabsV2.Trigger value="notes">📝 便签</TabsV2.Trigger>
              <TabsV2.Trigger value="changes">🗒 改动</TabsV2.Trigger>
              <TabsV2.Trigger value="subagents">🤖 子代理{props.subagentBadge ? ` ${props.subagentBadge}` : ""}</TabsV2.Trigger>
              <TabsV2.Trigger value="background">⚡ 后台{props.backgroundBadge ? ` ${props.backgroundBadge}` : ""}</TabsV2.Trigger>
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
