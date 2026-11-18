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
/** Injected by the loopback tunnel terminator; never accepted from clients. */
export const TUNNEL_HEADER = 'x-mafw-tunnel';

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

export type PrincipalKind = 'human' | 'service' | 'local' | 'relay' | 'anonymous';
export type PrincipalMethod = 'human-token' | 'device-token' | 'api-token' | 'loopback' | 'tunnel' | 'none';

export interface Principal {
  kind: PrincipalKind;
  method: PrincipalMethod;
  /** Present for `device-token` principals; used for push presence. */
  deviceId?: string;
  /** True when the request arrived through the loopback tunnel terminator. */
  tunneled?: boolean;
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
  /**
   * M0: per-process secret injected by the loopback tunnel terminator. A
   * request carrying this marker is `relay` (mobile allowlist) unless it also
   * presents a real credential.
   */
  tunnelSecret?: string;
}

/**
 * Resolve the request principal. Order is load-bearing (spec §3.3):
 *   human token → device token → shared apiToken → loopback → anonymous.
 * A presented-but-invalid device token never grants human and (F4) falls
 * through to the remaining credentials: a stale `X-MAFW-Device-Token` header
 * must not suppress a valid shared apiToken. Device verification itself is
 * fail-closed (a throwing verifier just falls through).
 */
export function resolvePrincipal(req: AuthRequest, opts: PrincipalResolveOpts): Principal {
  const marker = String(req.headers[TUNNEL_HEADER] || '').trim();
  const markerMatches = Boolean(marker && opts.tunnelSecret && constantTimeEqual(marker, opts.tunnelSecret));
  const tunneled = markerMatches || hasCloudflareForwardingHeaders(req.headers);
  const mark = (principal: Principal): Principal => (tunneled ? { ...principal, tunneled: true } : principal);

  const humanHeader = String(req.headers[HUMAN_TOKEN_HEADER] || '').trim();
  if (humanHeader && constantTimeEqual(humanHeader, opts.humanToken || '')) {
    return mark({ kind: 'human', method: 'human-token' });
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
      return mark({ kind: 'human', method: 'device-token', deviceId: verified.deviceId });
    }
    // F4: fall through instead of aborting. Possession of a valid shared
    // apiToken is still a (service) credential; a revoked device token simply
    // does not grant human rights.
  }

  const apiToken = opts.apiToken || '';
  if (apiToken) {
    const matches = constantTimeEqual(extractBearer(req), apiToken)
      || constantTimeEqual(extractXApiToken(req), apiToken)
      || constantTimeEqual(extractQueryToken(req), apiToken);
    if (matches) return mark({ kind: 'service', method: 'api-token' });
  }

  // M0: a tunneled request without a credential is `relay`, never `local`.
  // The marker is injected by our loopback terminator; Cloudflare's
  // `cf-connecting-ip` is the fail-closed hint when the marker is missing
  // (e.g. an older cloudflared path). A forged marker alone does nothing.
  if (tunneled) {
    return { kind: 'relay', method: 'tunnel', tunneled: true };
  }

  return fallbackPrincipal(req);
}

function hasCloudflareForwardingHeaders(headers: Record<string, string | undefined>): boolean {
  return Boolean(String(headers['cf-connecting-ip'] || '').trim());
}

/** Human-only routes accept `human` only (human token or device token). */
export function isHumanPrincipal(principal: Principal | undefined): boolean {
  return principal?.kind === 'human';
}

/** M0: tunneled requests get the mobile-only relay surface. */
export function isRelayPrincipal(principal: Principal | undefined): boolean {
  return principal?.kind === 'relay';
}

/** M0: true local clients keep the trusted loopback surface. */
export function isLocalPrincipal(principal: Principal | undefined): boolean {
  return principal?.kind === 'local';
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
// WebSocket upgrade rejection bytes
// ---------------------------------------------------------------------------

/**
 * Raw 401 bytes for upgrade rejections (the hub writes these byte-identically
 * before destroying the socket).
 *
 * E8-5 removed `authorizeWsUpgrade`: upgrades authorize through
 * `resolvePrincipal` (human/device/service/local) so they carry a principal,
 * and its credential matrix was a dead duplicate of that function.
 */
export const WS_UNAUTHORIZED_RESPONSE: Buffer = Buffer.from(
  'HTTP/1.1 401 Unauthorized\r\n\r\n'
);

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
 * Replace credentials with *** so no plaintext token reaches a log line.
 *
 * Covers the shapes the gateway actually logs:
 *   - `Authorization: Bearer <token>` / `?token=` / `&token=`
 *   - `X-MAFW-Human-Token: <token>` and `x-mafw-device-token=<token>` (header form)
 *   - `{"x-mafw-human-token":"<token>"}` / `{'x-mafw-device-token':'<token>'}`
 *     (logger stringifies object args with JSON.stringify)
 *   - `dev_…` device tokens anywhere (pairing responses carry them in `token`)
 *
 * Deliberately does NOT mask arbitrary 64-hex strings: those are common in
 * hashes/commit ids, and human tokens only leak through the named header.
 */
export function redactLog(s: string): string {
  return s
    .replace(/Bearer\s+[^\s"]+/gi, 'Bearer ***')
    .replace(/([?&]token=)[^&\s"]+/gi, '$1***')
    .replace(/(x-mafw-human-token["']?\s*[:=]\s*["']?)[^\s",;}']+/gi, '$1***')
    .replace(/(x-mafw-device-token["']?\s*[:=]\s*["']?)[^\s",;}']+/gi, '$1***')
    .replace(/dev_[A-Za-z0-9_-]{20,}/g, 'dev_***');
}

// ---------------------------------------------------------------------------
// Request context (E5a spec §3.4)
// ---------------------------------------------------------------------------

declare module 'http' {
  interface IncomingMessage {
    /** Principal resolved by the HTTP transport / WS upgrade (never logged). */
    mafwPrincipal?: Principal;
    /**
     * E5a-3: set by the transport for the credential-less pairing-verify
     * request (`POST /api/mobile/pairing/verify`). The nonce is the credential.
     */
    mafwPairingVerify?: boolean;
  }
}
