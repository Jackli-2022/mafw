import { isRoleNamedTab, type TabIdentityLike } from "./session-tab-identity"

export function retitleTab<T extends { id: string; title: string }>(
  tabs: T[],
  sessionId: string,
  title: string | undefined,
): T[] {
  const next = title?.trim()
  if (!next) return tabs
  let changed = false
  const updated = tabs.map((tab) => {
    if (tab.id !== sessionId || tab.title === next) return tab
    changed = true
    return { ...tab, title: next }
  })
  return changed ? updated : tabs
}

/**
 * Runtime auto-titles (opencode rewrites a session title after its first turn)
 * may only reach ordinary tabs. Role-named tabs — the Lead conversation — keep
 * their identity: they change label only through an explicit user rename.
 */
export function shouldRetitleTab(tab: TabIdentityLike | undefined, title: string | undefined): boolean {
  if (!title?.trim()) return false
  if (!tab) return false
  return !isRoleNamedTab(tab)
}
