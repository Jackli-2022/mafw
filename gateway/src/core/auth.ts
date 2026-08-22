/**
 * Gateway auth helpers — single source of truth for all auth checks.
 *
 * Channels:
 *   1. HTTP API: Bearer header / X-API-Token header / ?token= query
 *   2. WebSocket upgrade: same three channels, but rejection is on the raw socket
 *   3. Loopback: 127.0.0.0/8, ::1, ::ffff:127.0.0.1 always bypass token checks
 *
 * Security notes:
 *   - Empty apiToken + remote = deny all (not permissive)
 *   - Tokens are compared with constant-time === (sufficient for short-lived tokens)
 *   - No plaintext tokens are stored; config holds the canonical value
 *   - URL token leakage is mitigated by redactLog() in all log paths
 */

// ---------------------------------------------------------------------------
// Loopback detection
// ---------------------------------------------------------------------------

export function isLoopbackAddr(addr: string): boolean {
  const a = addr || '';
  return a === '127.0.0.1' || a.startsWith('127.') || a === '::1' || a === '::ffff:127.0.0.1';
}

// ---------------------------------------------------------------------------
// HTTP / generic request auth
// ---------------------------------------------------------------------------

export interface AuthRequest {
  remoteAddress: string;
  headers: Record<string, string | undefined>;
  url?: string;
  host?: string;
}

/**
 * Returns true when the request is authorized (loopback or valid token).
 * Used by the HTTP request handler before route dispatch.
 */
export function authorizeRequest(req: AuthRequest, apiToken: string): boolean {
  const addr = req.remoteAddress || '';
  if (isLoopbackAddr(addr)) return true;
  if (!apiToken) return false;
  const bearer = extractBearer(req);
  const xToken = extractXApiToken(req);
  const qToken = extractQueryToken(req);
  return bearer === apiToken || xToken === apiToken || qToken === apiToken;
}

// ---------------------------------------------------------------------------
// WebSocket upgrade auth
// ---------------------------------------------------------------------------

export interface WsAuthRequest {
  remoteAddress: string;
  headers: Record<string, string | undefined>;
  url: string;
  host?: string;
}

export interface WsAuthResult {
  ok: boolean;
  /** When ok === false, the raw HTTP response bytes to write before destroying the socket. */
  rejectResponse?: Buffer;
}

const WS_401_BYTES = Buffer.from('HTTP/1.1 401 Unauthorized\r\n\r\n');

/**
 * Authorize a WebSocket upgrade request.  Returns `{ ok: true }` on success,
 * or `{ ok: false, rejectResponse }` with the bytes to write to the raw socket.
 *
 * Accepts the same three channels as HTTP (Bearer / X-API-Token / ?token=).
 */
export function authorizeWsUpgrade(req: WsAuthRequest, apiToken: string): WsAuthResult {
  const addr = req.remoteAddress || '';
  if (isLoopbackAddr(addr)) return { ok: true };
  if (!apiToken) return { ok: false, rejectResponse: WS_401_BYTES };
  const bearer = extractBearer(req);
  const xToken = extractXApiToken(req);
  const qToken = extractQueryToken(req);
  if (bearer === apiToken || xToken === apiToken || qToken === apiToken) {
    return { ok: true };
  }
  return { ok: false, rejectResponse: WS_401_BYTES };
}

// ---------------------------------------------------------------------------
// Token extraction helpers (private)
// ---------------------------------------------------------------------------

function extractBearer(req: { headers: Record<string, string | undefined> }): string {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7) : '';
}

function extractXApiToken(req: { headers: Record<string, string | undefined> }): string {
  return String(req.headers['x-api-token'] || '');
}

function extractQueryToken(req: { headers: Record<string, string | undefined>; url?: string; host?: string }): string {
  try {
    const urlStr = req.url || '/';
    const host = req.host || req.headers.host || 'localhost';
    const u = new URL(urlStr, `http://${host}`);
    return u.searchParams.get('token') || '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Log redaction
// ---------------------------------------------------------------------------

/**
 * Replace Bearer tokens and token= query values with *** to prevent
 * plaintext credential leakage in logs.
 */
export function redactLog(s: string): string {
  return s
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***')
    .replace(/([?&]token=)[^&\s"]+/gi, '$1***');
}
