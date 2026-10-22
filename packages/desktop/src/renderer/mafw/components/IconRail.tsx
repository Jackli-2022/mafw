import { For, Show, type ComponentProps } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import type { LeftDockFace } from "../left-dock"
import { connDotState, railAriaLabel } from "../left-dock"

type IconName = ComponentProps<typeof Icon>["name"]

export type IconRailProps = {
  face: LeftDockFace | null
  onToggleFace: (face: LeftDockFace) => void
  onNewSession: () => void
  onDashboard: () => void
  onConfig: () => void
  onToggleTheme: () => void
  approvals: number
  connPhase: string // connected | reconnecting | down | initial
  gatewayState?: string | null // stopped | starting | ready | failed（stopped 用中性色，不报红）
  dashboardActive?: boolean
  configActive?: boolean
  theme: string // light | dark | system
}

type RailItem = {
  key: string
  icon?: IconName
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
  connDot?: boolean
}

// 左栏图标轨：顶部=高频导航，中部=搜索，底部=meta（spec D3）。
export function IconRail(props: IconRailProps) {
  const connClass = () => connDotState(props.connPhase, props.gatewayState)

  const topItems = (): RailItem[] => [
    { key: "sessions", icon: "bubble-5", label: "会话 (Ctrl+B)", onClick: () => props.onToggleFace("sessions"), active: props.face === "sessions" },
    { key: "new", icon: "plus-small", label: "新建会话", onClick: props.onNewSession },
  ]
  const middleItems = (): RailItem[] => [
    { key: "search", icon: "magnifying-glass", label: "搜索", onClick: () => props.onToggleFace("search"), active: props.face === "search" },
  ]
  const bottomItems = (): RailItem[] => [
    { key: "dashboard", icon: "status", label: "Dashboard", onClick: props.onDashboard, active: props.dashboardActive, badge: props.approvals },
    { key: "config", icon: "settings-gear", label: "Config", onClick: props.onConfig, active: props.configActive, connDot: true },
    // 主题图标沿用旧 Rail 品牌块：亮色 ☀ / 暗色月亮 SVG（图标集无 sun/moon）
    { key: "theme", label: "切换主题", onClick: props.onToggleTheme },
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
        <Show when={item.icon} fallback={
          props.theme === "light" ? "☀" : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M11.2 8.9A5 5 0 1 1 5.1 2.8a4 4 0 0 0 6.1 6.1Z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          )
        }>
          <Icon name={item.icon!} size="small" />
        </Show>
        <Show when={(item.badge ?? 0) > 0}>
          <span class="mafw-icon-rail-badge">{item.badge}</span>
        </Show>
        <Show when={item.connDot}>
          <span class="mafw-icon-rail-conn-dot" classList={{ [connClass()]: true }} />
        </Show>
      </ButtonV2>
    </TooltipV2>
  )

  return (
    <nav class="mafw-icon-rail" aria-label="主导航">
      <For each={topItems()}>{renderItem}</For>
      <div class="mafw-icon-rail-spacer" />
      <For each={middleItems()}>{renderItem}</For>
      <div class="mafw-icon-rail-spacer" />
      <For each={bottomItems()}>{renderItem}</For>
    </nav>
  )
}
