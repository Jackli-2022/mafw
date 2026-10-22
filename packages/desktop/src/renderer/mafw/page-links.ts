// Dashboard 枢纽页的「页面」链接卡（spec 2026-10-22-workbench-layout D6）。
// 单一来源：NAV_TABS 减 chat（Goals/Memory/Approvals/Triage/Automation）。
import { NAV_TABS, type NavTab } from "./components/nav-tab"

export type PageLinkId = Exclude<NavTab, "chat">
export interface PageLink {
  id: PageLinkId
  icon: string
  label: string
}

export const PAGE_LINKS: PageLink[] = NAV_TABS
  .filter((t) => t.id !== "chat")
  .map((t) => ({ id: t.id as PageLinkId, icon: t.icon, label: t.label }))
