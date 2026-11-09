/**
 * In-memory tickets for plugin Web surfaces.
 *
 * A Web surface is loaded inside a sandboxed `<webview>`; the page itself never
 * sees a token. The desktop main process asks the gateway for a ticket
 * (`POST /api/plugins/<pkg>/web-ticket`) and installs it as a path-scoped
 * cookie. Every package-scoped request (assets, `ctx.http` routes, websocket
 * upgrades and the event stream) then resolves its `{ projectDir, sessionID? }`
 * context from that ticket — never from the gateway's launch directory or the
 * global "current project", so two windows on different projects cannot leak
 * each other's files.
 *
 * The store is deliberately process-local: a gateway restart invalidates every
 * ticket and the client re-fetches one. Expired entries are dropped lazily, so
 * a stale ticket cannot be refreshed back to life. Spec §5.5/§5.7.
 */
import { randomBytes } from 'crypto';

/** Ticket lifetime from the spec (8 hours). */
export const DEFAULT_PLUGIN_WEB_TICKET_TTL_MS = 8 * 60 * 60 * 1000;

export interface PluginWebTicketBinding {
  /** Registered project directory the surface is bound to. */
  projectDir: string;
  /** Optional session the surface was opened for. */
  sessionID?: string;
}

export interface PluginWebTicketIssue {
  ticket: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

export interface PluginWebTicketStore {
  /**
   * Issues a ticket bound to `(pkg, projectDir, sessionID?)`.
   *
   * At most one live ticket exists per binding: issuing again revokes the
   * previous ticket (spec §5.7). Callers must send the new cookie.
   */
  issue(pkg: string, binding: PluginWebTicketBinding): PluginWebTicketIssue;
  /** Resolves a ticket, or `null` when unknown, expired or issued for another package. */
  verify(pkg: string, ticket: string): PluginWebTicketBinding | null;
  /** Extends a live ticket's expiry; `null` when unknown/expired. */
  refresh(ticket: string): PluginWebTicketIssue | null;
}

interface TicketEntry extends PluginWebTicketBinding {
  pkg: string;
  expiresAt: number;
}

function bindingKey(pkg: string, binding: PluginWebTicketBinding): string {
  return `${pkg}\u0000${binding.projectDir}\u0000${binding.sessionID ?? ''}`;
}

/**
 * @param deps.now Injectable clock (tests); defaults to `Date.now`.
 * @param deps.ttlMs Ticket lifetime; defaults to 8 hours.
 */
export function createPluginWebTicketStore(
  deps: { now?: () => number; ttlMs?: number } = {},
): PluginWebTicketStore {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? DEFAULT_PLUGIN_WEB_TICKET_TTL_MS;
  if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError('ttlMs must be a positive finite number');
  }

  const entries = new Map<string, TicketEntry>();
  const byBinding = new Map<string, string>();

  function drop(ticket: string): void {
    const entry = entries.get(ticket);
    if (!entry) return;
    entries.delete(ticket);
    const key = bindingKey(entry.pkg, entry);
    if (byBinding.get(key) === ticket) byBinding.delete(key);
  }

  function liveEntry(ticket: string): TicketEntry | null {
    if (typeof ticket !== 'string' || ticket.length === 0) return null;
    const entry = entries.get(ticket);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      drop(ticket);
      return null;
    }
    return entry;
  }

  function issue(pkg: string, binding: PluginWebTicketBinding): PluginWebTicketIssue {
    if (typeof pkg !== 'string' || pkg.length === 0) {
      throw new TypeError('plugin web ticket requires a non-empty package name');
    }
    if (!binding || typeof binding.projectDir !== 'string' || binding.projectDir.length === 0) {
      throw new TypeError('plugin web ticket requires a projectDir');
    }
    if (binding.sessionID !== undefined
      && (typeof binding.sessionID !== 'string' || binding.sessionID.length === 0)) {
      throw new TypeError('plugin web ticket sessionID must be a non-empty string');
    }

    const key = bindingKey(pkg, binding);
    const previous = byBinding.get(key);
    if (previous) drop(previous);

    const ticket = randomBytes(24).toString('hex');
    const expiresAt = now() + ttlMs;
    const entry: TicketEntry = {
      pkg,
      projectDir: binding.projectDir,
      expiresAt,
      ...(binding.sessionID === undefined ? {} : { sessionID: binding.sessionID }),
    };
    entries.set(ticket, entry);
    byBinding.set(key, ticket);
    return { ticket, expiresAt };
  }

  function verify(pkg: string, ticket: string): PluginWebTicketBinding | null {
    const entry = liveEntry(ticket);
    if (!entry || entry.pkg !== pkg) return null;
    return {
      projectDir: entry.projectDir,
      ...(entry.sessionID === undefined ? {} : { sessionID: entry.sessionID }),
    };
  }

  function refresh(ticket: string): PluginWebTicketIssue | null {
    const entry = liveEntry(ticket);
    if (!entry) return null;
    entry.expiresAt = now() + ttlMs;
    return { ticket, expiresAt: entry.expiresAt };
  }

  return { issue, verify, refresh };
}
