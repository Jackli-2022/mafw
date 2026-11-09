/**
 * Runtime-neutral session liveness check for `RuntimeClient.session.get`.
 *
 * `session.get` has three legal result shapes across runtimes:
 *  - a session record (`{ id, ... }`) → alive;
 *  - `undefined` / `null` → gone (pi returns undefined for unknown ids);
 *  - an SDK error envelope (`{ error, request, response }`) → gone.
 *
 * The last one is easy to miss: opencode's SDK defaults to
 * `throwOnError: false`, so a 404 resolves to an envelope without `data`.
 * A bare truthiness check (`!!info`) then reports every foreign/deleted
 * session id (e.g. a pi id after switching back to opencode) as alive and
 * the caller reuses a session that cannot be prompted.
 *
 * False negatives are acceptable (the caller rebuilds the session); false
 * positives are not (cross-runtime ids must never be reused).
 */
export function isLiveSessionInfo(info: unknown): boolean {
  if (!info || typeof info !== 'object') return false;
  const record = info as { id?: unknown; error?: unknown };
  if (record.error) return false;
  return typeof record.id === 'string' && record.id.length > 0;
}
