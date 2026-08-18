/**
 * Auth helpers extracted for testability. Index.ts inlines same logic.
 * - isLoopbackAddr: strict 127.0.0.0/8 + ::1 variants
 * - authorizeRequest: three-channel Bearer / x-api-token / ?token= + empty-token remote deny
 */

export function isLoopbackAddr(addr: string): boolean {
  const a = addr || '';
  return a === '127.0.0.1' || a.startsWith('127.') || a === '::1' || a === '::ffff:127.0.0.1';
}

export interface AuthRequest {
  remoteAddress: string;
  headers: Record<string, string | undefined>;
  url?: string;
  host?: string;
}

export function authorizeRequest(req: AuthRequest, apiToken: string): boolean {
  const addr = req.remoteAddress || '';
  if (isLoopbackAddr(addr)) return true;
  if (!apiToken) return false;
  // Normalize headers case-insensitive (Node lowercases, but tests may vary)
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (v != null) lower[k.toLowerCase()] = String(v);
  }
  const h = String(lower['authorization'] || '');
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
  const xToken = String(lower['x-api-token'] || '');
  let qToken = '';
  try {
    const urlStr = req.url || '/';
    const host = req.host || lower['host'] || 'localhost';
    const u = new URL(urlStr, `http://${host}`);
    qToken = u.searchParams.get('token') || '';
  } catch {
    qToken = '';
  }
  return bearer === apiToken || xToken === apiToken || qToken === apiToken;
}

/**
 * Log redaction helper (also in gateway/src/core/utils/logger.ts)
 * Replaces Bearer tokens and token= query values with ***
 */
export function redactLog(s: string): string {
  return s.replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***').replace(/([?&]token=)[^&\s"]+/gi, '$1***');
}
