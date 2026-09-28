// @ts-nocheck
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { TooltipV2 } from "@mafw/ui/v2/tooltip-v2"
import { type DockTab } from "./dock-tab"

const ITEMS: { tab: DockTab; icon: string; label: string }[] = [
  { tab: "tasks", icon: "📋", label: "任务" },
  { tab: "trajectory", icon: "📊", label: "轨迹" },
  { tab: "usage", icon: "📈", label: "用量" },
  { tab: "notes", icon: "📝", label: "便签" },
  { tab: "changes", icon: "🗒", label: "改动" },
]

export function DockTabButtons(props: {
  tab: () => DockTab
  open: () => boolean
  onToggle: (tab: DockTab) => void
}) {
  return (
    <div class="mafw-dock-buttons">
      {ITEMS.map(({ tab: t, icon, label }) => (
        <TooltipV2 value={label} openDelay={300}>
          <ButtonV2
            variant="ghost"
            size="small"
            class="mafw-dock-button"
            classList={{ active: props.open() && props.tab() === t }}
            aria-label={label}
            onClick={() => props.onToggle(t)}
          >
            {icon}
          </ButtonV2>
        </TooltipV2>
      ))}
    </div>
  )
}
