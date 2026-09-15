// Plans sessionStore actions from raw /api/events SSE lifecycle events.
// The gateway broadcasts opencode runtime events passthrough as
// { type, properties, sessionID?, internal? }; this module is the single
// place deciding what a lifecycle event means for the desktop caches.
//
// Hidden-session parity with gateway listSessions (gateway/src/index.ts
// isHiddenSession): subagent children (parentID) and legacy worker title
// prefixes never reach the desktop list, so their events must not create
// churn either. Gateway drops memory-worker lifecycle noise itself; the
// internal flag covers anything that slips through.
//
// Overwrite guard: SSE `info` lacks the local `metadata.mafw.role` that
// listSessions enriches in, so patches carry a strict field whitelist —
// never a spread of info.

export type SessionEventPatch = {
  title?: string
  time?: { updated?: number }
  directory?: string
  projectID?: string
}

export type SessionEventAction =
  | { kind: "patch"; id: string; patch: SessionEventPatch }
  | { kind: "remove"; id: string }
  | { kind: "invalidate"; directory?: string }
  | { kind: "none" }

export type RawSessionEvent = {
  type?: string
  properties?: {
    sessionID?: string
    info?: {
      id?: string
      title?: string
      directory?: string
      projectID?: string
      parentID?: string
      time?: { updated?: number }
    }
  }
  sessionID?: string
  internal?: boolean
}

const LEGACY_WORKER_TITLE_PREFIXES = ["# Memory Index", "{", "```", "标题："]

const isHiddenSessionInfo = (info: NonNullable<NonNullable<RawSessionEvent["properties"]>["info"]>): boolean => {
  if (info.parentID) return true
  const title = info.title || ""
  return LEGACY_WORKER_TITLE_PREFIXES.some(prefix => title.startsWith(prefix))
}

const sessionIdOf = (evt: RawSessionEvent): string | undefined =>
  evt.sessionID || evt.properties?.sessionID || evt.properties?.info?.id

export function planSessionEvent(evt: RawSessionEvent): SessionEventAction {
  const type = evt.type
  const info = evt.properties?.info
  if (evt.internal) return { kind: "none" }

  if (type === "session.created") {
    if (!info || isHiddenSessionInfo(info)) return { kind: "none" }
    // Broadcast carries no project mapping, so the consumer refetches cached
    // buckets; directory (from info) is passed for targeted consumers.
    return { kind: "invalidate", directory: info.directory }
  }

  if (type === "session.updated") {
    if (!info || isHiddenSessionInfo(info)) return { kind: "none" }
    const id = sessionIdOf(evt)
    if (!id) return { kind: "none" }
    const patch: SessionEventPatch = {}
    if (typeof info.title === "string") patch.title = info.title
    if (typeof info.time?.updated === "number") patch.time = { updated: info.time.updated }
    if (typeof info.directory === "string") patch.directory = info.directory
    if (typeof info.projectID === "string") patch.projectID = info.projectID
    return { kind: "patch", id, patch }
  }

  if (type === "session.deleted") {
    const id = sessionIdOf(evt)
    if (!id) return { kind: "none" }
    return { kind: "remove", id }
  }

  return { kind: "none" }
}
