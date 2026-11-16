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

export type RestoredLeadTab = { id: string; active: boolean }

export type LeadTabRestorePlan = {
  /** Stored Lead tab ids that must not be restored. */
  skip: string[]
  /** Current Lead tab to open after the saved tabs are restored. */
  open: string | null
  /** Whether opening the current Lead should take focus. */
  activate: boolean
  /** Lead is known to have been in the layout, but the Pod has not resolved it yet. */
  pending: boolean
}

/**
 * Lead is an identity, not a fixed runtime session. A saved tab may point at a
 * dead/rotated session id; restoring it by id would show an unrelated or empty
 * transcript. Keep the tab only when it is the authoritative current Lead.
 */
export function planLeadTabRestore(input: {
  currentLeadId: string | null
  savedLeadTabs: readonly RestoredLeadTab[]
}): LeadTabRestorePlan {
  const saved = input.savedLeadTabs
  if (saved.length === 0) {
    return { skip: [], open: null, activate: false, pending: false }
  }
  const activate = saved.some((tab) => tab.active)
  if (!input.currentLeadId) {
    return { skip: saved.map((tab) => tab.id), open: null, activate: false, pending: true }
  }
  const current = input.currentLeadId
  return {
    skip: saved.filter((tab) => tab.id !== current).map((tab) => tab.id),
    open: saved.some((tab) => tab.id === current) ? null : current,
    activate,
    pending: false,
  }
}
