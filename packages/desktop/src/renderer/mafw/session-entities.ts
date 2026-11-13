// E6-2: the ONE metadata cache for desktop sessions.
//
// Before this module, `session-store` kept a full `SessionInfo[]` per project
// bucket, tabs copied the title again (`ChatSession.title`) and ChatPane read a
// third copy (`store.session[].title`), so `session.updated` had to write every
// copy by hand and any missed write surfaced as a stale label.
//
// Now: entities own `title/directory/projectID/metadata/time/agent/parentID`,
// `session-store` keeps only project buckets of ids, and tab objects keep their
// title strictly as a first-frame fallback for persisted `{id,title}` resumes.
// `version()` is the reactive heartbeat: every reader goes through `get`, which
// subscribes to it, so one patch re-renders Rail / tabs / ChatPane together.
import { createSignal } from "solid-js"

export interface SessionEntity {
  id: string
  title?: string
  directory?: string
  projectID?: string
  metadata?: { mafw?: { role?: string } }
  time?: { created?: number; updated?: number }
  /** opencode 2.1.0 sticky agent id（build/plan/…）——用于恢复 agent 药丸 */
  agent?: string
  parentID?: string
}

const entities = new Map<string, SessionEntity>()
const [version, setVersion] = createSignal(0)
const bump = () => setVersion((v) => v + 1)

/** Merge `patch` into `base`, ignoring undefined (an absent key is not a clear). */
function merge(base: SessionEntity, patch: Partial<SessionEntity>): SessionEntity {
  const next: SessionEntity = { ...base, id: base.id }
  if (patch.title !== undefined) next.title = patch.title
  if (patch.directory !== undefined) next.directory = patch.directory
  if (patch.projectID !== undefined) next.projectID = patch.projectID
  if (patch.metadata !== undefined) next.metadata = patch.metadata
  if (patch.time !== undefined) next.time = patch.time
  if (patch.agent !== undefined) next.agent = patch.agent
  if (patch.parentID !== undefined) next.parentID = patch.parentID
  return next
}

export const sessionEntities = {
  /** Reactive read (subscribes to `version`). */
  get(id: string): SessionEntity | undefined {
    version()
    return entities.get(id)
  },

  /** Merge/replace by id; fields not provided are preserved. */
  upsert(entity: SessionEntity): void {
    if (!entity?.id) return
    const base = entities.get(entity.id)
    entities.set(entity.id, merge(base ?? { id: entity.id }, entity))
    bump()
  },

  /** Merge a partial into an existing entity. False when the id is unknown. */
  patch(id: string, partial: Partial<SessionEntity>): boolean {
    const base = entities.get(id)
    if (!base) return false
    entities.set(id, merge(base, partial))
    bump()
    return true
  },

  /** Drop an entity. False when the id is unknown. */
  remove(id: string): boolean {
    if (!entities.delete(id)) return false
    bump()
    return true
  },

  /** Reactive heartbeat: bumped on upsert/patch/remove/reset. */
  version(): number {
    return version()
  },

  /**
   * Drop every entity. Used on a full SSE resync (reset/truncated/instance
   * change): a reset epoch must not leave rows the gateway no longer has.
   * A plain `sessionStore.invalidate` keeps entities for offline reads.
   */
  reset(): void {
    if (entities.size === 0) return
    entities.clear()
    bump()
  },
}
