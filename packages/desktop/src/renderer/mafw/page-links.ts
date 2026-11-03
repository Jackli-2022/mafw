// 项目资源页链接（spec 2026-11-04）：公开页面只保留全局资源；
// `goals` 是 legacy deep-link 值，不再作为页面入口。
import { NAV_TABS, type NavTab } from "./components/nav-tab"

export type PageLinkId = Exclude<NavTab, "chat" | "goals">
export interface PageLink {
  id: PageLinkId
  icon: string
  label: string
}

export const PAGE_LINKS: PageLink[] = NAV_TABS
  .filter((t) => t.id !== "chat")
  .map((t) => ({ id: t.id as PageLinkId, icon: t.icon, label: t.label }))
