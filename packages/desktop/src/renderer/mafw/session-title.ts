// E6-2: single read path for session titles.
//
// The entity cache is the source of truth; a tab title is only a fallback for
// persisted `{id,title}` resumes whose entity has not been fetched yet (offline
// start, pruned bucket). Role-named tabs (the Lead) keep the role label no
// matter what the runtime wrote into the entity title.
import { isRoleNamedTab, type TabIdentityLike } from "./session-tab-identity"
import { sessionEntities } from "./session-entities"

/** Non-blank string or "" — used so a whitespace title never masks a fallback. */
const printable = (value?: string | null): string =>
  typeof value === "string" && value.trim() ? value : ""

/** Entity title first, caller fallback second. */
export function sessionTitle(id: string, fallback?: string | null): string {
  return printable(sessionEntities.get(id)?.title) || printable(fallback) || ""
}

/**
 * Tab label. Role-named tabs are a role surface (Lead), so a runtime retitle
 * must not leak into the strip; every other tab follows the entity title.
 */
export function sessionTabTitle(
  id: string,
  fallback: string,
  tab?: TabIdentityLike | null,
): string {
  if (isRoleNamedTab(tab)) return "Lead"
  return sessionTitle(id, fallback)
}
