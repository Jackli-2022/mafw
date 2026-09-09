// @ts-nocheck
import { Icon } from "@mafw/ui/icon"
import { TabsV2 } from "@mafw/ui/v2/tabs-v2"
import { ButtonV2 } from "@mafw/ui/v2/button-v2"
import { Show } from "solid-js"

export type Tab = "chat" | "goals" | "memory" | "approvals" | "triage" | "automation"

const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: "chat",       icon: "bubble-5",         label: "Chat" },
  { id: "goals",      icon: "status",            label: "Goals" },
  { id: "memory",     icon: "brain",             label: "Memory" },
  { id: "approvals",  icon: "checklist",         label: "Approvals" },
  { id: "triage",     icon: "warning",           label: "Triage" },
  { id: "automation", icon: "sliders",           label: "Automation" },
]

type Props = {
  active: Tab
  onChange: (tab: Tab) => void
  counts?: Partial<Record<Tab, number>>
  onOpenTrajectory?: () => void
  trajectoryActive?: boolean
}

export function TabStrip(props: Props) {
  return (
    <TabsV2 value={props.active} onChange={props.onChange} variant="normal">
      <TabsV2.List class="mafw-tabstrip">
        {TABS.map(t => (
          <TabsV2.Trigger value={t.id}>
            <Icon name={t.icon} size="small" />
            {t.label}
            <Show when={(props.counts?.[t.id] || 0) > 0}>
              <span class="mafw-tab-count">{props.counts?.[t.id]}</span>
            </Show>
          </TabsV2.Trigger>
        ))}
        <ButtonV2
          variant="ghost"
          size="small"
          class="mafw-tabstrip-trajectory"
          classList={{ active: !!props.trajectoryActive }}
          onClick={props.onOpenTrajectory}
          aria-label="轨迹时间线"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
            <path d="M8.5 4v16" />
            <circle cx="5.8" cy="9" r="1.1" />
            <path d="M5.8 11.5v3" />
          </svg>
        </ButtonV2>
      </TabsV2.List>
    </TabsV2>
  )
}
