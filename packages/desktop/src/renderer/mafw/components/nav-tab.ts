// 主导航表（spec 2026-11-04）：`goals` 保留在 NavTab 联合中作为 legacy deep-link 兼容值，
// 但不再出现在公开导航表——项目工作由右工作台「工作」主面承担。
export type NavTab = "chat" | "goals" | "memory" | "approvals" | "triage" | "automation"

export const NAV_TABS: { id: NavTab; icon: string; label: string }[] = [
  { id: "chat", icon: "bubble-5", label: "Chat" },
  { id: "memory", icon: "brain", label: "Memory" },
  { id: "approvals", icon: "checklist", label: "Approvals" },
  { id: "triage", icon: "warning", label: "Triage" },
  { id: "automation", icon: "sliders", label: "Automation" },
]
