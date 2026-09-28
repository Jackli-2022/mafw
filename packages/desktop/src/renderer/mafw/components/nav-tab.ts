// 主导航表（v6 §0b）：Rail 垂直导航吸收原 TabStrip 六页职责。
export type NavTab = "chat" | "goals" | "memory" | "approvals" | "triage" | "automation"

export const NAV_TABS: { id: NavTab; icon: string; label: string }[] = [
  { id: "chat", icon: "bubble-5", label: "Chat" },
  { id: "goals", icon: "status", label: "Goals" },
  { id: "memory", icon: "brain", label: "Memory" },
  { id: "approvals", icon: "checklist", label: "Approvals" },
  { id: "triage", icon: "warning", label: "Triage" },
  { id: "automation", icon: "sliders", label: "Automation" },
]
