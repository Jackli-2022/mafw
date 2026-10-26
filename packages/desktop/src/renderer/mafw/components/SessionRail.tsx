// SessionRail：会话数据面板的右侧细图标轨 + 浮层面板（spec 2026-10-26-workbench-merge-design）。
// 七面板：任务/轨迹/用量/便签/改动/子代理/后台；badge 保留；点击开浮层，Esc / 点外部关闭。
import { For, Show, createEffect, onCleanup, type JSX } from "solid-js"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { Icon, type IconProps } from "@mafw/ui/icon"
import { DockPanelHeader } from "./dock-panel"
import { type DockTab } from "./dock-tab"

export const RAIL_ITEMS: { id: DockTab; label: string; icon: IconProps["name"] }[] = [
  { id: "tasks", label: "任务", icon: "checklist" },
  { id: "trajectory", label: "轨迹", icon: "dot-grid" },
  { id: "usage", label: "用量", icon: "chart" },
  { id: "notes", label: "便签", icon: "pencil-line" },
  { id: "changes", label: "改动", icon: "review" },
  { id: "subagents", label: "子代理", icon: "subagent" },
  { id: "background", label: "后台", icon: "console" },
]

export function SessionRail(props: {
  /** null = 浮层关闭 */
  openTab: DockTab | null
  onSelect: (tab: DockTab) => void
  onClose: () => void
  subagentBadge?: number
  backgroundBadge?: number
  children: JSX.Element
}) {
  const labelOf = (tab: DockTab | null) => RAIL_ITEMS.find((t) => t.id === tab)?.label ?? ""

  createEffect(() => {
    if (!props.openTab) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") props.onClose() }
    window.addEventListener("keydown", onKey)
    onCleanup(() => window.removeEventListener("keydown", onKey))
  })

  return (
    <div class="mafw-session-rail">
      <div class="mafw-session-rail-icons">
        <For each={RAIL_ITEMS}>
          {(item) => (
            <TooltipV2 value={item.label} openDelay={300}>
              <ButtonV2
                variant={props.openTab === item.id ? "contrast" : "ghost"}
                size="small"
                class="mafw-session-rail-btn"
                aria-label={item.label}
                aria-pressed={props.openTab === item.id}
                onClick={() => props.onSelect(item.id)}
              >
                <Icon name={item.icon} size="small" />
                <Show when={item.id === "subagents" ? (props.subagentBadge ?? 0) > 0 : (props.backgroundBadge ?? 0) > 0}>
                  <span class="mafw-session-rail-badge">
                    {item.id === "subagents" ? props.subagentBadge : props.backgroundBadge}
                  </span>
                </Show>
              </ButtonV2>
            </TooltipV2>
          )}
        </For>
      </div>
      <Show when={props.openTab}>
        <div class="mafw-session-float-mask" onClick={() => props.onClose()} />
        <div class="mafw-session-float" role="dialog" aria-label={labelOf(props.openTab)}>
          <DockPanelHeader title={labelOf(props.openTab)}>
            <ButtonV2 variant="ghost" size="small" aria-label="关闭面板" onClick={() => props.onClose()}>
              <Icon name="close" size="small" />
            </ButtonV2>
          </DockPanelHeader>
          <div class="mafw-session-float-body">{props.children}</div>
        </div>
      </Show>
    </div>
  )
}
