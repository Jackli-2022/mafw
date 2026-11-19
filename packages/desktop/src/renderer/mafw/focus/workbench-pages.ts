// 工作台页面：审批 / 分诊 / 自动化 / MCP / 设置。
// 页面不是主区 tab，而是右工作台的一种焦点对象（subject.kind === "page"）。
export const WORKBENCH_PAGE_IDS = ["approvals", "triage", "automation", "mcp", "config"] as const

export type WorkbenchPageId = (typeof WORKBENCH_PAGE_IDS)[number]

export const WORKBENCH_PAGE_META: Record<WorkbenchPageId, { label: string; icon: string }> = {
  approvals: { label: "审批", icon: "checklist" },
  triage: { label: "分诊", icon: "warning" },
  automation: { label: "自动化", icon: "sliders" },
  mcp: { label: "MCP", icon: "mcp" },
  config: { label: "设置", icon: "settings-gear" },
}

import type { SubjectRef } from "./focus-model"

export function isWorkbenchPageId(value: unknown): value is WorkbenchPageId {
  return typeof value === "string" && (WORKBENCH_PAGE_IDS as readonly string[]).includes(value)
}

/**
 * 重启恢复时，持久化的 page tab 只有在焦点栈里还有同一页时才应保持高亮；
 * 旧快照可能只存了 activeId 而没有 page focus（页面系统上线前 / 栈被裁剪）。
 */
export function isStalePageActiveTab(activeId: string | null, subjects: readonly SubjectRef[]): boolean {
  if (!activeId?.startsWith("scene:page:")) return false
  const id = activeId.slice("scene:page:".length)
  return !subjects.some((subject) => subject.kind === "page" && subject.id === id)
}
