import { For, Show, type ComponentProps } from "solid-js"
import { Icon } from "@mafw/ui/icon"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { menuController } from "../context-menu/controller"
import { buildRailNewMenu } from "../context-menu/builders/rail"
import { guardFactsFromEvent, shouldUseNativeMenu } from "../context-menu/guard"
import type { LeftDockFace } from "../left-dock"
import { connDotState, railAriaLabel } from "../left-dock"
import { formatRailBadge } from "../pod-rail-badge"
import type { PluginRailItemState } from "../plugins/plugin-surface-state"
import type { PluginSurfaceId } from "../plugins/surface-id"

type IconName = ComponentProps<typeof Icon>["name"]

export type IconRailProps = {
  face: LeftDockFace | null
  onToggleFace: (face: LeftDockFace) => void
  /** 团队是项目属性：打开项目首页并定位团队条，不再切换左 dock face。 */
  onTeam: () => void
  onApprovals: () => void
  onConfig: () => void
  /** 顶部动作：新建会话（单击）；右键菜单含「并行 worktree」 */
  onNewSession: () => void
  onNewWorktreeSession?: () => void
  worktreeEnabled?: boolean
  approvals: number
  /** 鲸群：人类阻塞 attention 数字（spec 2026-10-30-pod-left-rail §4.3） */
  podBadge?: number
  /** 鲸群：有未查看的结果（Task 21）——独立圆点，不计入 attention 数字。 */
  podResultDot?: boolean
  /**
   * 统一插件包的 Web surface 入口（spec 2026-11-09 §6.4），已按 `rail.order`
   * 排序；声明了 `rail.badge` 的条目带 `count`。
   */
  pluginItems?: readonly PluginRailItemState[]
  /** 当前激活的插件 surface（仅工作台 L1=workbench 时由 shell 传入）。 */
  pluginActiveSurface?: string | null
  /** 打开插件 surface：切到工作台并激活该二级 tab。 */
  onPluginItem?: (surfaceId: PluginSurfaceId) => void
  connPhase: string // connected | reconnecting | down | initial
  gatewayState?: string | null // stopped | starting | ready | failed（stopped 用中性色，不报红）
  approvalsActive?: boolean
  configActive?: boolean
}

type RailItem = {
  key: string
  icon: IconName
  label: string
  onClick: () => void
  active?: boolean
  badge?: number
  /** 覆盖 badge 的显示文案（如 9+）；aria 仍用数字 badge。 */
  badgeLabel?: string
  /** 未查看结果圆点（与数字 badge 视觉/语义分开）。 */
  resultDot?: boolean
  connDot?: boolean
}

// 左栏图标轨（spec 2026-11-04-agent-workbench-right-primary）：
// 顶部动作（新建）→ 目的地组连排（讨论/搜索/便签/团队）→ spacer → meta 组（审批/Config）。
// 团队是项目属性：图标只是项目首页团队条的快捷入口，不再有独立 Pod 面。
export function IconRail(props: IconRailProps) {
  const connClass = () => connDotState(props.connPhase, props.gatewayState)

  const destinationItems = (): RailItem[] => [
    { key: "files", icon: "folder", label: props.face === "files" ? "收起文件" : "文件", onClick: () => props.onToggleFace("files"), active: props.face === "files" },
    { key: "sessions", icon: "bubble-5", label: props.face === "sessions" ? "收起讨论 (Ctrl+B)" : "讨论 (Ctrl+B)", onClick: () => props.onToggleFace("sessions"), active: props.face === "sessions" },
    { key: "search", icon: "magnifying-glass", label: props.face === "search" ? "收起搜索" : "搜索", onClick: () => props.onToggleFace("search"), active: props.face === "search" },
    { key: "notes", icon: "sticky-note", label: props.face === "notes" ? "收起便签" : "便签", onClick: () => props.onToggleFace("notes"), active: props.face === "notes" },
    {
      key: "team",
      icon: "team-three",
      label: "团队",
      onClick: () => props.onTeam(),
      badge: props.podBadge,
      badgeLabel: formatRailBadge(props.podBadge ?? 0) || undefined,
      resultDot: !!props.podResultDot,
    },
  ]
  const metaItems = (): RailItem[] => [
    { key: "approvals", icon: "checklist", label: "审批", onClick: props.onApprovals, active: props.approvalsActive, badge: props.approvals },
    { key: "config", icon: "settings-gear", label: "Config", onClick: props.onConfig, active: props.configActive, connDot: true },
  ]

  // 插件 Web surface 入口（spec 2026-11-09 §6.4）：与内置目的地同组，排在资源
  // （讨论/搜索/便签/Pod）之后。图标名来自 descriptor 校验过的 PLUGIN_ICON_NAMES
  // 白名单（契约侧只允许命中 v1 图标表的名字），因此可以直接当图标名使用。
  const pluginEntries = (): RailItem[] =>
    (props.pluginItems ?? []).map((item) => {
      const count = item.badge ? item.count ?? 0 : 0
      return {
        key: item.surfaceId,
        icon: item.icon as IconName,
        label: item.label,
        onClick: () => props.onPluginItem?.(item.surfaceId),
        active: !!props.pluginActiveSurface && props.pluginActiveSurface === item.surfaceId,
        badge: count,
        badgeLabel: formatRailBadge(count) || undefined,
      }
    })

  const renderItem = (item: RailItem) => (
    <TooltipV2 value={railAriaLabel(item.label, item.badge)} openDelay={300}>
      <ButtonV2
        variant="ghost"
        size="small"
        class="mafw-icon-rail-icon"
        classList={{ active: !!item.active }}
        aria-label={item.resultDot ? `${railAriaLabel(item.label, item.badge)}（有新结果）` : railAriaLabel(item.label, item.badge)}
        aria-pressed={item.active}
        onClick={item.onClick}
      >
        <Icon name={item.icon} size="small" />
        <Show when={(item.badge ?? 0) > 0}>
          <span class="mafw-icon-rail-badge">{item.badgeLabel ?? item.badge}</span>
        </Show>
        <Show when={item.resultDot}>
          <span class="mafw-icon-rail-result-dot" aria-hidden="true" />
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
      <For each={pluginEntries()}>{renderItem}</For>
      <div class="mafw-icon-rail-spacer" />
      <For each={metaItems()}>{renderItem}</For>
    </nav>
  )
}
