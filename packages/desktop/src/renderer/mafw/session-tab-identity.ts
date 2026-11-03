type TabRoleMetadata = { mafw?: { role?: string } } | null | undefined

export type TabIdentityLike = {
  id: string
  title?: string
  lead?: boolean
  metadata?: TabRoleMetadata
}

/**
 * 只把「系统生成的占位标题」升级为 Goal 身份：用户手动重命名过的 tab
 * （任意自由文本）必须保留，重新打开同一会话也不得覆盖。
 */
export function isGeneratedSessionTitle(title?: string | null): boolean {
  const raw = (title ?? "").trim()
  if (!raw) return true
  if (/^Chat \d+$/.test(raw)) return true
  if (raw === "未命名" || /^New conversation$/i.test(raw)) return true
  // 旧 PodDock 成员入口写过的 `Pod · Builder` 这类泛化标题。
  if (/^Pod · /.test(raw)) return true
  return false
}

/** Upgrade an already-open tab when its identity becomes known later. */
export function mergeTabIdentity<T extends TabIdentityLike>(
  tabs: T[],
  sessionID: string,
  lead?: boolean,
  metadata?: TabRoleMetadata,
  title?: string,
): T[] {
  const nextTitle = typeof title === "string" && title.trim() ? title.trim() : undefined
  if (lead === undefined && metadata === undefined && !nextTitle) return tabs
  return tabs.map((tab) => tab.id === sessionID
    ? {
      ...tab,
      ...(lead !== undefined ? { lead } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
      ...(nextTitle && isGeneratedSessionTitle(tab.title) ? { title: nextTitle } : {}),
    }
    : tab)
}

/** A project has at most one current Lead tab; drop stale Lead identities. */
export function dropOtherLeadTabs<T extends TabIdentityLike>(
  tabs: T[],
  keepSessionID: string,
): T[] {
  return tabs.filter((tab) =>
    tab.id === keepSessionID
    || (!tab.lead && tab.metadata?.mafw?.role !== "lead"))
}
