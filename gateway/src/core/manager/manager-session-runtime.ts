// Runtime ownership of manager-session kv entries.
// Session ids belong to the ACTIVE runtime's storage (opencode 'ses_*' vs
// pi 'pi_*'); an entry written under another runtime is dead here ("Pi
// session not found"). New entries carry an explicit `runtime` tag; legacy
// entries are inferred from the id prefix. Unknown origin is kept
// conservatively (deletion is irreversible).

export function managerEntryRuntime(value: { sessionId?: string; runtime?: string }): string | null {
  if (value?.runtime) return value.runtime;
  const sid = value?.sessionId || '';
  if (sid.startsWith('pi_')) return 'pi';
  if (sid.startsWith('ses_')) return 'opencode';
  return null;
}

/** True when the entry cannot be valid under `currentRuntime` (and should be dropped). */
export function isManagerEntryStale(
  value: { sessionId?: string; runtime?: string } | null | undefined,
  currentRuntime: string | undefined,
): boolean {
  if (!value?.sessionId) return true;
  const entryRuntime = managerEntryRuntime(value);
  if (!entryRuntime || !currentRuntime) return false;
  return entryRuntime !== currentRuntime;
}
