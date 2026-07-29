// @ts-nocheck
import { Icon } from "@opencode-ai/ui/icon"
import { TabsV2 } from "@opencode-ai/ui/v2/tabs-v2"

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
}

export function TabStrip(props: Props) {
  return (
    <TabsV2 value={props.active} onChange={props.onChange} variant="normal">
      <TabsV2.List class="mafw-tabstrip">
        {TABS.map(t => (
          <TabsV2.Trigger value={t.id}>
            <Icon name={t.icon} size="small" />
            {t.label}
          </TabsV2.Trigger>
        ))}
      </TabsV2.List>
    </TabsV2>
  )
}
