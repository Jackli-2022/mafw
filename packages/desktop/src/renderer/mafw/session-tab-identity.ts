type TabRoleMetadata = { mafw?: { role?: string } } | null | undefined

export type TabIdentityLike = {
  id: string
  lead?: boolean
  metadata?: TabRoleMetadata
}

/** Upgrade an already-open tab when its identity becomes known later. */
export function mergeTabIdentity<T extends TabIdentityLike>(
  tabs: T[],
  sessionID: string,
  lead?: boolean,
  metadata?: TabRoleMetadata,
): T[] {
  if (lead === undefined && metadata === undefined) return tabs
  return tabs.map((tab) => tab.id === sessionID
    ? {
      ...tab,
      ...(lead !== undefined ? { lead } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
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
