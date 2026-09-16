// Runtime ownership of manager-session kv entries — per-runtime SLOTS.
// The manager "topic" exists separately in each runtime's storage (opencode
// SQLite 'ses_*' vs pi SessionManager 'pi_*'), so the kv value keeps one slot
// per runtime and switching runtimes never drops a topic: switching back
// resumes the previous manager. Legacy v1 entries ({sessionId, createdAt})
// are migrated by session-id prefix on read/write. Unknown origin is kept
// conservatively (deletion is irreversible).

export interface ManagerSlot {
  sessionId: string;
  createdAt?: string | null;
}

export interface ManagerSessionValueV2 {
  byRuntime: Record<string, ManagerSlot>;
}

/** Which runtime does this entry belong to? Explicit tag wins, then id-prefix inference, then null. */
export function managerEntryRuntime(value: { sessionId?: string; runtime?: string }): string | null {
  if (value?.runtime) return value.runtime;
  const sid = value?.sessionId || '';
  if (sid.startsWith('pi_')) return 'pi';
  if (sid.startsWith('ses_')) return 'opencode';
  return null;
}

/**
 * Read the slot for `currentRuntime`.
 * v2 value → byRuntime[currentRuntime]; v1 legacy → its prefix-inferred slot
 * when it matches, else null (the entry stays dormant, never deleted).
 */
export function readManagerSlot(
  value: unknown,
  currentRuntime: string,
): ManagerSlot | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as { byRuntime?: Record<string, ManagerSlot>; sessionId?: string; createdAt?: string | null };
  if (v.byRuntime && typeof v.byRuntime === 'object') {
    return v.byRuntime[currentRuntime] ?? null;
  }
  // v1 legacy: belongs to exactly one runtime (prefix-inferred).
  const owner = managerEntryRuntime(v);
  return owner === currentRuntime ? { sessionId: v.sessionId as string, createdAt: v.createdAt } : null;
}

/**
 * Write the slot for `currentRuntime`, preserving all other runtimes' slots.
 * v1 legacy input is migrated into its prefix-inferred slot first.
 */
export function writeManagerSlot(
  existing: unknown,
  currentRuntime: string,
  slot: ManagerSlot,
): ManagerSessionValueV2 {
  const byRuntime: Record<string, ManagerSlot> = {};
  if (existing && typeof existing === 'object') {
    const v = existing as { byRuntime?: Record<string, ManagerSlot>; sessionId?: string; createdAt?: string | null };
    if (v.byRuntime && typeof v.byRuntime === 'object') {
      Object.assign(byRuntime, v.byRuntime);
    } else {
      const owner = managerEntryRuntime(v);
      if (owner && v.sessionId) byRuntime[owner] = { sessionId: v.sessionId, createdAt: v.createdAt };
    }
  }
  byRuntime[currentRuntime] = slot;
  return { byRuntime };
}
