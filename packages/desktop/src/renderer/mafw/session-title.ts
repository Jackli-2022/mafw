// E6-2: single read path for session titles.
//
// The entity cache is the source of truth; a tab title is only a fallback for
// persisted `{id,title}` resumes whose entity has not been fetched yet (offline
// start, pruned bucket). Role-named tabs (the Lead) keep the role label no
// matter what the runtime wrote into the entity title.
//
// F1/F2: opening a tab and snapshotting the layout both resolve titles here, so
// a stale persisted "Chat 1" can neither overwrite a fresh gateway title nor a
// user rename.
import {
  isGeneratedSessionTitle,
  isRoleNamedTab,
  type TabIdentityLike,
} from "./session-tab-identity"
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

/**
 * Title stored when opening a tab. The already-known entity title wins unless
 * it is missing or a generated placeholder; only then may the caller seed it.
 * That keeps a user rename (and the freshest gateway title) while still
 * upgrading a restored `Chat N` tab with the Pod/Goal identity the caller has.
 * `lead` is the role surface, not a title: opening the Lead writes the role
 * label; metadata-only role tabs keep their title and are pinned at display.
 */
export function resolveOpenSessionTitle(input: {
  lead?: boolean
  knownTitle?: string | null
  callerTitle?: string | null
  fallback?: string
}): string {
  if (input.lead === true) return "Lead"
  const known = printable(input.knownTitle)
  if (known && !isGeneratedSessionTitle(known)) return known
  const caller = printable(input.callerTitle)
  if (caller && !isGeneratedSessionTitle(caller)) return caller
  return known || caller || printable(input.fallback)
}

/**
 * Layout snapshot rows (`{id,title}` written to localStorage). Persist the live
 * label every surface shows, not the tab's first-frame fallback, so a resume
 * cannot resurrect a stale placeholder. Role-named tabs persist `Lead`.
 */
export function sessionSnapshotTabs<T extends TabIdentityLike>(
  tabs: readonly T[],
): Array<{ id: string; title: string }> {
  return tabs.map(tab => ({
    id: tab.id,
    title: sessionTabTitle(tab.id, tab.title ?? "", tab),
  }))
}
