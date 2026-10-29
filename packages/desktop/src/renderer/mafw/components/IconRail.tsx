import { For, Show, type ComponentProps } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { menuController } from "../context-menu/controller"
import { buildRailNewMenu } from "../context-menu/builders/rail"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import type { LeftDockFace } from "../left-dock"
import { connDotState, railAriaLabel } from "../left-dock"

type IconName = ComponentProps<typeof Icon>["name"]

export type IconRailProps = {
  face: LeftDockFace | null
  onToggleFace: (face: LeftDockFace) => void
  onDashboard: () => void
  onConfig: () => void
  /** 顶部动作：新建会话（单击）；右键菜单含「并行 worktree」 */
  onNewSession: () => void
  onNewWorktreeSession?: () => void
  worktreeEnabled?: boolean
  approvals: number
  connPhase: string // connected | reconnecting | down | initial
  gatewayState?: string | null // stopped | starting | ready | failed（stopped 用中性色，不报红）
  dashboardActive?: boolean
  configActive?: boolean
}

type RailItem = {
  key: string
  icon: IconName
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
  connDot?: boolean
}

// 左栏图标轨（spec 2026-10-27 §6.1）：
// 顶部动作（新建）→ 目的地组连排（工作/搜索/便签）→ spacer → meta 组（Dashboard/Config）。
// 主题切换已迁 Config（业界六家无一放 rail）。
export function IconRail(props: IconRailProps) {
  const connClass = () => connDotState(props.connPhase, props.gatewayState)

  const destinationItems = (): RailItem[] => [
    { key: "sessions", icon: "bubble-5", label: props.face === "sessions" ? "收起工作 (Ctrl+B)" : "工作 (Ctrl+B)", onClick: () => props.onToggleFace("sessions"), active: props.face === "sessions" },
    { key: "search", icon: "magnifying-glass", label: props.face === "search" ? "收起搜索" : "搜索", onClick: () => props.onToggleFace("search"), active: props.face === "search" },
    { key: "notes", icon: "sticky-note", label: props.face === "notes" ? "收起便签" : "便签", onClick: () => props.onToggleFace("notes"), active: props.face === "notes" },
  ]
  const metaItems = (): RailItem[] => [
    { key: "dashboard", icon: "layout-grid", label: "Dashboard", onClick: props.onDashboard, active: props.dashboardActive, badge: props.approvals },
    { key: "config", icon: "settings-gear", label: "Config", onClick: props.onConfig, active: props.configActive, connDot: true },
  ]

  const renderItem = (item: RailItem) => (
    <TooltipV2 value={item.label} openDelay={300}>
      <ButtonV2
        variant="ghost"
        size="small"
        class="mafw-icon-rail-icon"
        classList={{ active: !!item.active }}
        aria-label={railAriaLabel(item.label, item.badge)}
        aria-pressed={item.active}
        onClick={item.onClick}
      >
        <Icon name={item.icon} size="small" />
        <Show when={(item.badge ?? 0) > 0}>
          <span class="mafw-icon-rail-badge">{item.badge}</span>
        </Show>
        <Show when={item.connDot}>
          <span class="mafw-icon-rail-conn-dot" classList={{ [connClass()]: true }} />
        </Show>
      </ButtonV2>
    </TooltipV2>
  )

  const openNewMenu = (event: MouseEvent) => {
    if (shouldUseNativeMenu(guardFactsFromEvent(event))) return
    event.preventDefault()
    menuController.request(
      buildRailNewMenu,
      { worktreeEnabled: !!props.worktreeEnabled },
      (id) => {
        if (id === "rail.newSession") props.onNewSession()
        else if (id === "rail.newWorktree") props.onNewWorktreeSession?.()
      },
      { point: { x: event.clientX, y: event.clientY } },
    )
  }

  return (
    <nav class="mafw-icon-rail" aria-label="主导航">
      <div class="mafw-icon-rail-new" style={{ display: "contents" }} onContextMenu={openNewMenu}>
        <TooltipV2 value="新建会话" openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-icon-rail-icon new-action"
            aria-label="新建会话"
            onClick={props.onNewSession}
          >
            <Icon name="plus-small" size="small" />
          </ButtonV2>
        </TooltipV2>
      </div>
      <For each={destinationItems()}>{renderItem}</For>
      <div class="mafw-icon-rail-spacer" />
      <For each={metaItems()}>{renderItem}</For>
    </nav>
  )
}
