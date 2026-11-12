/**
 * Gateway auth helpers — single source of truth for all auth checks.
 *
 * Channels:
 *   1. HTTP API: Bearer header / X-API-Token header / ?token= query
 *   2. WebSocket upgrade: same three channels, but rejection is on the raw socket
 *   3. Loopback: 127.0.0.0/8, ::1, ::ffff:127.0.0.1 always bypass token checks
 *
 * E5a principal model (spec docs/superpowers/specs/2026-11-12-gateway-e5a-identity-closure-design.md):
 *   human   — X-MAFW-Human-Token (desktop/TUI) or a device token (mobile)
 *   service — the shared server.apiToken (agents / MCP / automations)
 *   local   — loopback without credentials (legacy clients)
 *   anonymous — everything else (remote without credentials → 401)
 * Human-only routes additionally require `kind === 'human'`; "no actorSessionID"
 * is no longer evidence of a human.
 *
 * Security notes:
 *   - Empty apiToken / humanToken never match (fail-closed)
 *   - Tokens are compared with crypto.timingSafeEqual after a length check
 *   - No plaintext tokens are stored; config / the human token file hold the canonical values
 *   - URL token leakage is mitigated by redactLog() in all log paths
 *   - Human / device tokens are never logged (redactLog covers their headers)
 */
import * as crypto from 'crypto';
import type * as http from 'http';

const HUMAN_TOKEN_HEADER = 'x-mafw-human-token';
const DEVICE_TOKEN_HEADER = 'x-mafw-device-token';
const DEVICE_TOKEN_PREFIX = 'dev_';

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

// ---------------------------------------------------------------------------
// Principal model (E5a)
// ---------------------------------------------------------------------------

export type PrincipalKind = 'human' | 'service' | 'local' | 'anonymous';
export type PrincipalMethod = 'human-token' | 'device-token' | 'api-token' | 'loopback' | 'none';

export interface Principal {
  kind: PrincipalKind;
  method: PrincipalMethod;
  /** Present for `device-token` principals; used for push presence. */
  deviceId?: string;
}

export interface PrincipalResolveOpts {
  /** Shared gateway token (`server.apiToken`). Empty never matches. */
  apiToken: string;
  /** `~/.mafw/human.token`. Empty (file unreadable) never matches. */
  humanToken?: string;
  /**
   * Device token verifier (Task 3 wires this to the DeviceStore). A missing
   * verifier makes every device token invalid → fail-closed.
   */
  verifyDeviceToken?: (token: string) => { deviceId: string } | null;
}

/**
 * Resolve the request principal. Order is load-bearing (spec §3.3):
 *   human token → device token → shared apiToken → loopback → anonymous.
 * A presented-but-invalid device token must NOT fall through to the shared
 * apiToken (credential confusion: a revoked device would regain service access).
 */
export function resolvePrincipal(req: AuthRequest, opts: PrincipalResolveOpts): Principal {
  const humanHeader = String(req.headers[HUMAN_TOKEN_HEADER] || '').trim();
  if (humanHeader && constantTimeEqual(humanHeader, opts.humanToken || '')) {
    return { kind: 'human', method: 'human-token' };
  }

  const deviceToken = extractDeviceToken(req);
  if (deviceToken) {
    let verified: { deviceId: string } | null = null;
    try {
      verified = opts.verifyDeviceToken?.(deviceToken) ?? null;
    } catch {
      verified = null;
    }
    if (verified && verified.deviceId) {
      return { kind: 'human', method: 'device-token', deviceId: verified.deviceId };
    }
    return fallbackPrincipal(req);
  }

  const apiToken = opts.apiToken || '';
  if (apiToken) {
    const matches = constantTimeEqual(extractBearer(req), apiToken)
      || constantTimeEqual(extractXApiToken(req), apiToken)
      || constantTimeEqual(extractQueryToken(req), apiToken);
    if (matches) return { kind: 'service', method: 'api-token' };
  }

  return fallbackPrincipal(req);
}

/** Human-only routes accept `human` only (human token or device token). */
export function isHumanPrincipal(principal: Principal | undefined): boolean {
  return principal?.kind === 'human';
}

/** Stable 403 body for every human-only route (spec §4). */
export function humanOnlyDenied(): {
  status: 403;
  body: { error: string; code: 'human_principal_required' };
} {
  return {
    status: 403,
    body: { error: 'human principal required', code: 'human_principal_required' },
  };
}

function fallbackPrincipal(req: AuthRequest): Principal {
  return isLoopbackAddr(req.remoteAddress || '')
    ? { kind: 'local', method: 'loopback' }
    : { kind: 'anonymous', method: 'none' };
}

/**
 * Returns true when the request is authorized (loopback or valid token).
 * Kept for existing callers that only need service/local/anonymous semantics.
 * New code should use `resolvePrincipal` so human-only routes can distinguish
 * a human from a service.
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

/** Raw 401 bytes for upgrade rejections (exported so the hub keeps them byte-identical). */
export const WS_UNAUTHORIZED_RESPONSE: Buffer = WS_401_BYTES;

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

/**
 * Device credential: explicit header first, then `Authorization: Bearer dev_…`.
 * Only `dev_`-prefixed bearers are device candidates; other bearers stay on the
 * shared-apiToken path.
 */
function extractDeviceToken(req: { headers: Record<string, string | undefined> }): string {
  const header = String(req.headers[DEVICE_TOKEN_HEADER] || '').trim();
  if (header) return header;
  const bearer = extractBearer(req).trim();
  return bearer.startsWith(DEVICE_TOKEN_PREFIX) ? bearer : '';
}

/** Constant-time string compare; length mismatch / empty inputs return false. */
function constantTimeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
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
    .replace(/([?&]token=)[^&\s"]+/gi, '$1***')
    // E5a: human / device tokens must never reach a log line.
    .replace(/(x-mafw-human-token\s*[:=]\s*)[^\s",;}]+/gi, '$1***')
    .replace(/(x-mafw-device-token\s*[:=]\s*)[^\s",;}]+/gi, '$1***');
}

// ---------------------------------------------------------------------------
// Request context (E5a spec §3.4)
// ---------------------------------------------------------------------------

declare module 'http' {
  interface IncomingMessage {
    /** Principal resolved by the HTTP transport / WS upgrade (never logged). */
    mafwPrincipal?: Principal;
  }
}
