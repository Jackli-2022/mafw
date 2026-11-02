// Runtime ownership of manager-session kv entries — per-runtime SLOTS.
// The manager "topic" exists separately in each runtime's storage, so the kv
// value keeps one slot per runtime and switching runtimes never drops a topic:
// switching back resumes the previous manager.
//
// Ownership is EXPLICIT (the persisted `runtime` tag). Session id prefixes
// (`pi_` / `ses_`) are runtime-private naming conventions and must not be used
// to guess an owner: a legacy v1 entry without a tag stays dormant (never
// deleted, never attributed), and new writes always carry the tag.

export interface ManagerSlot {
  sessionId: string;
  createdAt?: string | null;
}

export interface ManagerSessionValueV2 {
  byRuntime: Record<string, ManagerSlot>;
  /**
   * Legacy v1 entry with no explicit runtime tag. Never surfaced for any
   * runtime (that would be a guess); preserved so a write cannot lose it.
   */
  unattributed?: ManagerSlot;
}

/**
 * Owner runtime of a persisted entry — explicit tag only.
 * Returns null when the entry carries no runtime tag (unknown origin).
 */
export function resolveManagerRuntime(slot: { runtime?: string; id?: string; sessionId?: string }): string | null {
  const runtime = slot?.runtime;
  if (typeof runtime !== 'string') return null;
  const trimmed = runtime.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read the slot for `currentRuntime`.
 * v2 value → byRuntime[currentRuntime]; tagged v1 legacy → its explicit slot
 * when it matches; untagged v1 → null (dormant, never guessed).
 */
export function readManagerSlot(
  value: unknown,
  currentRuntime: string,
): ManagerSlot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as {
    byRuntime?: Record<string, ManagerSlot>;
    sessionId?: string;
    createdAt?: string | null;
    runtime?: string;
  };
  if (v.byRuntime && typeof v.byRuntime === 'object') {
    return v.byRuntime[currentRuntime] ?? null;
  }
  const owner = resolveManagerRuntime(v);
  return owner === currentRuntime && v.sessionId ? { sessionId: v.sessionId, createdAt: v.createdAt } : null;
}

/**
 * Write the slot for `currentRuntime`, preserving all other runtimes' slots.
 * A tagged v1 legacy entry is migrated into its own slot; an untagged v1 entry
 * is preserved verbatim under `unattributed`.
 */
export function writeManagerSlot(
  existing: unknown,
  currentRuntime: string,
  slot: ManagerSlot,
): ManagerSessionValueV2 {
  const byRuntime: Record<string, ManagerSlot> = {};
  let unattributed: ManagerSlot | undefined;
  if (existing && typeof existing === 'object') {
    const v = existing as {
      byRuntime?: Record<string, ManagerSlot>;
      sessionId?: string;
      createdAt?: string | null;
      runtime?: string;
      unattributed?: ManagerSlot;
    };
    if (v.byRuntime && typeof v.byRuntime === 'object') {
      Object.assign(byRuntime, v.byRuntime);
      if (v.unattributed?.sessionId) unattributed = { ...v.unattributed };
    } else if (v.sessionId) {
      const owner = resolveManagerRuntime(v);
      if (owner) byRuntime[owner] = { sessionId: v.sessionId, createdAt: v.createdAt };
      else unattributed = { sessionId: v.sessionId, createdAt: v.createdAt };
    }
  }
  byRuntime[currentRuntime] = slot;
  return { byRuntime, ...(unattributed ? { unattributed } : {}) };
}
