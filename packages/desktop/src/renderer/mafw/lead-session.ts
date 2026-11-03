// Current Lead identity is exclusive: historical `manager` rows remain
// ordinary history and must never resolve as the active project coordinator.

export type SessionRoleMetadata = { mafw?: { role?: string } } | null | undefined

export type RoleSessionLike = {
  id: string
  title?: string
  metadata?: SessionRoleMetadata
}

export type CoordinatorSession = {
  id: string
  title: string
  lead: true
  metadata: { mafw: { role: "lead" } }
}

export function isLeadRole(role?: string | null): boolean {
  return role === "lead"
}

/** Tab role: metadata wins; the explicit marker only represents current Lead. */
export function tabSessionRole(
  tab?: { metadata?: SessionRoleMetadata; lead?: boolean } | null,
): string | undefined {
  const role = tab?.metadata?.mafw?.role
  if (role) return role
  return tab?.lead ? "lead" : undefined
}

export function leadTabMetadata(): { mafw: { role: "lead" } } {
  return { mafw: { role: "lead" } }
}

/**
 * Resolve the current hidden Lead session from an explicit id only.
 * No history fallback: manager/manager-archived rows are not current Lead.
 */
export function resolveLeadSession(input: {
  leadSessionId?: string | null
}): CoordinatorSession | null {
  const id = (input.leadSessionId ?? "").trim()
  if (!id) return null
  return { id, title: "Lead", lead: true, metadata: leadTabMetadata() }
}
