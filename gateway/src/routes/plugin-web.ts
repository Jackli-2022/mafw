/**
 * Plugin Web surfaces — gateway half of the sandboxed `<webview>` contract.
 *
 * Four surfaces share one namespace (`/api/plugins/<pkg>/…`):
 * - `ui/*`  static assets from the committed package's `web/` tree;
 * - `web-ticket`  issues the path-scoped ticket cookie;
 * - `events`  SSE stream filtered to `plugin:<pkg>:*`;
 * - `api/*` + `ws/*`  the package's own `ctx.http` routes (Task 3 registry).
 *
 * Auth model (2026-11-09 hardening, spec §5.4–§5.7):
 * - `api|events|ws` require a **valid ticket** — even on loopback. The ticket
 *   is the only source of the handler context (`{ projectDir, sessionID? }`);
 *   there is no ambient "current project" fallback. A page from any site can
 *   reach a loopback port, so loopback alone must never authorize execution
 *   (a plugin WS route can create a PTY).
 * - `ui/*` assets stay loopback-reachable so a plain browser can bootstrap a
 *   page; assets do not execute host work, and a presented ticket is still
 *   validated (cross-package replay is a 403).
 * - `web-ticket` stays loopback-only for the desktop main process, rejects a
 *   non-gateway `Origin` and never emits `Access-Control-Allow-Origin`.
 * - A *presented* but invalid ticket is always a 403, so a ticket minted for
 *   one package cannot be replayed against another.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import type { Duplex } from 'stream';
import { canonicalProjectDir } from '../core/pod/pod-identity';
import {
  DEFAULT_WEB_SURFACE_ENTRY,
  pluginWebAssetContentType,
  resolvePluginWebEntry,
} from '../plugins/plugin-web-assets';
import type { PluginHttpRegistry } from '../plugins/plugin-http';
import type { PluginWebTicketBinding, PluginWebTicketStore } from '../plugins/plugin-web-ticket';
import type { ConnectionTable } from '../resources/connections';
import { SseBoundedWriter } from '../resources/outbound-buffer';
import type { BufferCounters } from '../resources/outbound-buffer';

/** Name of the path-scoped ticket cookie (spec §5.5). */
export const PLUGIN_WEB_TICKET_COOKIE = 'mafw_plugin_ticket';
/** Header alternative for non-browser clients that cannot store cookies. */
export const PLUGIN_WEB_TICKET_HEADER = 'x-mafw-plugin-ticket';

const ASSET_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const SSE_HEARTBEAT_MS = 15_000;
const TICKET_BODY_LIMIT_BYTES = 16 * 1024;
/**
 * Host names a loopback client may use. `isLoopback(req)` is the socket peer;
 * a DNS-rebinding page also connects from loopback, so the ticket mint also
 * checks that the URL host is a loopback name (desktop main always uses
 * `127.0.0.1`).
 */
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

export interface PluginWebRouteParams {
  name: string;
}

export interface PluginWebRouteDeps {
  /** True when the package has a committed revision (reachable at all). */
  isActivePackage(name: string): boolean;
  /** Committed directory package root (`web/` lives below it); null otherwise. */
  packageDir(name: string): string | null;
  /** Registered project directories (ticket validation). */
  listProjects(): readonly string[];
  /**
   * Known `session-worktree` directories (kv `session-worktree/<sid>.dir`).
   * Worktrees live beside the project, not below it, so the containment rule
   * needs them explicitly. Optional: hosts without worktree support pass none.
   */
  listWorktreeDirs?(): readonly string[];
  /** Process-local ticket store shared by every package-scoped route. */
  tickets: PluginWebTicketStore;
  /** Committed `ctx.http` registry, undefined before the host is ready. */
  httpRegistry(): PluginHttpRegistry | undefined;
  /** Loopback detection for `web-ticket` issuance and `ui/*` bootstrap only. */
  isLoopback(req: http.IncomingMessage): boolean;
  /**
   * Context for a loopback `ui/*` asset request without a ticket.
   *
   * Assets do not execute package code, so the ambient project is harmless
   * there; `api|events|ws` never use it (they require a ticket). Keeping the
   * fallback means a browser can open the page URL directly while developing.
   */
  defaultProjectDir(): string;
  /**
   * Attaches a filtered writer to the gateway's single broadcast stream and
   * returns its cleanup. The handler owns SSE framing + heartbeat; this hook
   * must not create a second event bus.
   */
  attachEventStream(
    res: http.ServerResponse,
    write: (frame: string, seq: number | null) => void,
  ): () => void;
  /** E4-4：live 连接表；缺省 = 不限制（与 /api/events 一致）。 */
  connections?: () => ConnectionTable | null;
  /** E4-5：有界写配置；缺省 = 直接 `res.write`（旧行为）。 */
  buffers?: () => { maxFrames: number; maxBytes: number; counters?: BufferCounters } | null;
}

interface PluginWebContext extends PluginWebTicketBinding {}

type PluginWebAuth =
  | { ok: true; context: PluginWebContext }
  | { ok: false; status: 403; error: string };

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const body = JSON.stringify(payload);
  try {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
      ...extraHeaders,
    });
    res.end(body);
  } catch {
    /* client already gone */
  }
}

function pathnameOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;
  try {
    // `new URL` strips the query/fragment for us (the revision token lives there)
    // and normalizes dot segments before the resolver applies its own checks.
    return new URL(rawUrl, 'http://localhost').pathname;
  } catch {
    return null;
  }
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

const ASSET_BASE_PATH = /^\/api\/plugins\/([^/]+)\/ui$/;
const ASSET_ENTRY_PATH = /^\/api\/plugins\/([^/]+)\/ui\/(.*)$/;
const API_BASE_PATH = /^\/api\/plugins\/([^/]+)\/api$/;
const API_ROUTE_PATH = /^\/api\/plugins\/([^/]+)\/api\/(.*)$/;
const WS_BASE_PATH = /^\/api\/plugins\/([^/]+)\/ws$/;
const WS_ROUTE_PATH = /^\/api\/plugins\/([^/]+)\/ws\/(.*)$/;

/** Parses `/api/plugins/<pkg>/ui[/<entry>]` (query string ignored). */
export function parsePluginWebAssetUrl(
  rawUrl: string | undefined,
): { name: string; entry: string } | null {
  const pathname = pathnameOf(rawUrl);
  if (!pathname) return null;

  const withEntry = ASSET_ENTRY_PATH.exec(pathname);
  if (withEntry) {
    const name = decodeSegment(withEntry[1]);
    const entry = decodeSegment(withEntry[2]);
    if (name === null || entry === null || entry.length === 0) return null;
    return { name, entry };
  }
  const base = ASSET_BASE_PATH.exec(pathname);
  if (base) {
    const name = decodeSegment(base[1]);
    if (name === null) return null;
    return { name, entry: DEFAULT_WEB_SURFACE_ENTRY };
  }
  return null;
}

/** Parses `/api/plugins/<pkg>/api[/<path>]`; the registry receives an exact path. */
export function parsePluginApiUrl(
  rawUrl: string | undefined,
): { name: string; path: string } | null {
  const pathname = pathnameOf(rawUrl);
  if (!pathname) return null;

  const route = API_ROUTE_PATH.exec(pathname);
  if (route) {
    const name = decodeSegment(route[1]);
    if (name === null) return null;
    return { name, path: `/${route[2]}` };
  }
  const base = API_BASE_PATH.exec(pathname);
  if (base) {
    const name = decodeSegment(base[1]);
    if (name === null) return null;
    return { name, path: '' };
  }
  return null;
}

/** Parses `/api/plugins/<pkg>/ws[/<path>]`; the registry receives an exact path. */
export function parsePluginWsUrl(
  rawUrl: string | undefined,
): { name: string; path: string } | null {
  const pathname = pathnameOf(rawUrl);
  if (!pathname) return null;

  const route = WS_ROUTE_PATH.exec(pathname);
  if (route) {
    const name = decodeSegment(route[1]);
    const rest = decodeSegment(route[2]);
    if (name === null || rest === null) return null;
    return { name, path: `/${rest}` };
  }
  const base = WS_BASE_PATH.exec(pathname);
  if (base) {
    const name = decodeSegment(base[1]);
    if (name === null) return null;
    return { name, path: '' };
  }
  return null;
}

/**
 * SSE frame matcher for one package (and optional session).
 *
 * Frames are the gateway's enriched `id: …\ndata: {…}\n\n` envelopes; only the
 * `data:` line is parsed. Package events always live in `plugin:<pkg>:*`
 * (PluginEventRegistry already enforces the namespace on emit).
 */
export function pluginWebEventFilter(
  pkg: string,
  sessionID?: string,
): (frame: string) => boolean {
  const prefix = `plugin:${pkg}:`;
  return (frame: string): boolean => {
    if (typeof frame !== 'string') return false;
    const line = frame.split('\n').find((candidate) => candidate.startsWith('data:'));
    if (!line) return false;
    let event: any;
    try {
      event = JSON.parse(line.slice('data:'.length).trim());
    } catch {
      return false;
    }
    if (!event || typeof event.type !== 'string' || !event.type.startsWith(prefix)) return false;
    if (sessionID !== undefined && event.sessionID !== sessionID) return false;
    return true;
  };
}

/** First ticket presented by the request (header wins over the cookie). */
function presentedTicket(req: http.IncomingMessage): string | null {
  const header = req.headers[PLUGIN_WEB_TICKET_HEADER];
  const headerValue = Array.isArray(header) ? header[0] : header;
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  const cookie = req.headers.cookie;
  if (typeof cookie !== 'string') return null;
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() !== PLUGIN_WEB_TICKET_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Resolves the context for a `ui/*` asset request.
 *
 * Assets are not code execution, so loopback may omit the ticket (plain
 * browser bootstrap). A presented ticket always wins over the loopback
 * fallback — and a presented *foreign/invalid* ticket is a 403, never a
 * downgrade.
 */
function resolvePluginWebAssetAuth(
  req: http.IncomingMessage,
  deps: PluginWebRouteDeps,
  pkg: string,
): PluginWebAuth {
  const presented = presentedTicket(req);
  if (presented) {
    const binding = deps.tickets.verify(pkg, presented);
    return binding
      ? { ok: true, context: binding }
      : { ok: false, status: 403, error: 'invalid plugin ticket' };
  }
  if (deps.isLoopback(req)) {
    return { ok: true, context: { projectDir: deps.defaultProjectDir() } };
  }
  return { ok: false, status: 403, error: 'plugin ticket required' };
}

/**
 * Resolves the context for a package-scoped **execution** route
 * (`api/*`, `events`, `ws/*`).
 *
 * A valid ticket is required even on loopback: the ticket is the only source
 * of the handler context, and loopback ports are reachable from any web page.
 * There is deliberately no ambient/current-project fallback here.
 */
function resolvePluginWebContextAuth(
  req: http.IncomingMessage,
  deps: PluginWebRouteDeps,
  pkg: string,
): PluginWebAuth {
  const presented = presentedTicket(req);
  if (!presented) return { ok: false, status: 403, error: 'plugin ticket required' };
  const binding = deps.tickets.verify(pkg, presented);
  return binding
    ? { ok: true, context: binding }
    : { ok: false, status: 403, error: 'invalid plugin ticket' };
}

/**
 * True when the request URL's host is a loopback name (see `LOOPBACK_HOSTNAMES`).
 *
 * Only used for the ticket mint: the mint is the credential grant, and a
 * DNS-rebinding page presents a matching non-loopback `Host`/`Origin` pair that
 * `pluginWebOriginAllowed` alone would accept.
 */
function pluginWebHostIsLoopback(req: http.IncomingMessage): boolean {
  const raw = req.headers.host;
  const host = Array.isArray(raw) ? raw[0] : raw;
  if (typeof host !== 'string' || host.trim().length === 0) return false;
  try {
    const parsed = new URL(`http://${host.trim()}`);
    return LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * True when the request may act as a browser request for the gateway itself.
 *
 * Browsers always send `Origin` on cross-site WebSocket handshakes and on
 * cross-origin `fetch`; the page served by the gateway has the gateway origin,
 * so a foreign `Origin` is a CSRF-grade refusal. A missing `Origin` is a
 * non-browser client (desktop main process, curl) and stays allowed — the
 * ticket still gates the route. `Sec-Fetch-Site: cross-site` catches a browser
 * request that somehow omitted `Origin`.
 *
 * Comparison is `Origin` host vs the request's `Host` header (the browser sets
 * both; a non-browser client can forge them, but then it already holds the
 * ticket, which is the real credential).
 */
export function pluginWebOriginAllowed(req: http.IncomingMessage): boolean {
  const raw = req.headers.origin;
  const origin = Array.isArray(raw) ? raw[0] : raw;
  if (typeof origin === 'string' && origin.trim().length > 0) {
    const value = origin.trim();
    // `Origin: null` (sandboxed iframe / file://) names no gateway origin.
    if (value.toLowerCase() === 'null') return false;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = String(req.headers.host ?? '').trim().toLowerCase();
    if (host.length === 0) return false;
    return parsed.host.toLowerCase() === host;
  }
  const site = req.headers['sec-fetch-site'];
  const fetchSite = Array.isArray(site) ? site[0] : site;
  if (typeof fetchSite === 'string' && fetchSite.trim().toLowerCase() === 'cross-site') {
    return false;
  }
  return true;
}

class BodyTooLargeError extends Error {}

function readJsonObject(
  req: http.IncomingMessage,
  limitBytes: number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const fail = (err: Error): void => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > limitBytes) {
        // Keep receiving (drain) so the 413 written by the caller reaches the
        // client instead of surfacing as a connection reset.
        try { req.resume(); } catch { /* already flowing */ }
        fail(new BodyTooLargeError(`request body exceeds ${limitBytes} bytes`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.trim().length === 0) return resolve({});
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return reject(new Error('invalid JSON body'));
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return reject(new Error('body must be a JSON object'));
      }
      resolve(parsed as Record<string, unknown>);
    });
    req.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    // Client aborted before the body ended: never leave the request pending.
    req.on('close', () => {
      if (!settled) fail(new Error('request aborted'));
    });
  });
}

function sameProjectDir(left: string, right: string): boolean {
  const a = canonicalProjectDir(left);
  const b = canonicalProjectDir(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** True when `candidate` is `root` or below it (canonical, case-normalized on Windows). */
function isInsideDir(root: string, candidate: string): boolean {
  const normalize = (value: string): string =>
    process.platform === 'win32' ? value.toLowerCase() : value;
  const relative = path.relative(normalize(root), normalize(candidate));
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** Ticket-issuable directories: registered projects plus known worktrees. */
export interface PluginWebProjectScope {
  projects: readonly string[];
  worktrees?: readonly string[];
}

/**
 * Resolves the `projectDir` a Web surface ticket may bind to.
 *
 * Accepted (all canonicalized first, so `..` and symlinks cannot widen the
 * scope):
 * - a registered project (returned with the registered spelling — it is the
 *   stable partition identity);
 * - a known `session-worktree` directory (parallel-worktree sessions open
 *   surfaces bound to the worktree);
 * - a subdirectory of either (monorepo subdir / bench root below the repo).
 *
 * Everything else is `null` (the ticket route answers 400).
 */
export function resolvePluginWebProjectDir(
  scope: PluginWebProjectScope,
  requested: string,
): string | null {
  const raw = typeof requested === 'string' ? requested.trim() : '';
  if (raw.length === 0) return null;
  const canonical = canonicalProjectDir(raw);
  const worktrees = scope.worktrees ?? [];

  for (const project of scope.projects) {
    if (sameProjectDir(project, canonical)) return project;
  }
  for (const worktree of worktrees) {
    if (sameProjectDir(worktree, canonical)) return worktree;
  }
  for (const root of [...scope.projects, ...worktrees]) {
    if (isInsideDir(canonicalProjectDir(root), canonical)) return canonical;
  }
  return null;
}

function ticketCookie(pkg: string, ticket: string, expiresAt: number, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
  const parts = [
    `${PLUGIN_WEB_TICKET_COOKIE}=${ticket}`,
    `Path=/api/plugins/${pkg}/`,
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** `POST /api/plugins/:name/web-ticket` — loopback only, known project required. */
export async function handlePluginWebTicket(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginWebRouteDeps,
  params: PluginWebRouteParams,
): Promise<void> {
  const name = params?.name;
  if (!name) return sendJson(res, 404, { error: 'not found' });
  if (!deps.isLoopback(req)) {
    return sendJson(res, 403, { error: 'plugin tickets are issued to local clients only' });
  }
  // Socket peer is loopback for a DNS-rebinding page too; the URL host must be
  // a loopback name as well (desktop main always calls 127.0.0.1).
  if (!pluginWebHostIsLoopback(req)) {
    return sendJson(res, 403, { error: 'plugin tickets are issued to loopback hosts only' });
  }
  // A browser minting a ticket would re-bind its own surface context; only the
  // gateway's own pages (desktop renderer / dev page) may ask. No Origin =
  // desktop main process (`@mafw/sdk` fetch), which is the intended caller.
  if (!pluginWebOriginAllowed(req)) {
    return sendJson(res, 403, { error: 'plugin tickets are issued to the gateway origin only' });
  }
  if (!deps.isActivePackage(name)) return sendJson(res, 404, { error: 'not found' });

  let body: Record<string, unknown>;
  try {
    body = await readJsonObject(req, TICKET_BODY_LIMIT_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) return sendJson(res, 413, { error: err.message });
    return sendJson(res, 400, { error: (err as Error)?.message ?? 'invalid request body' });
  }

  const projectDir = typeof body.projectDir === 'string' ? body.projectDir.trim() : '';
  if (!projectDir) return sendJson(res, 400, { error: 'projectDir is required' });
  const sessionID = body.sessionID;
  if (sessionID !== undefined
    && (typeof sessionID !== 'string' || sessionID.trim().length === 0)) {
    return sendJson(res, 400, { error: 'sessionID must be a non-empty string' });
  }

  const resolved = resolvePluginWebProjectDir(
    { projects: deps.listProjects(), worktrees: deps.listWorktreeDirs?.() ?? [] },
    projectDir,
  );
  if (!resolved) {
    return sendJson(res, 400, {
      error: 'projectDir is not a registered project, a worktree or a directory below one',
    });
  }

  const issued = deps.tickets.issue(name, {
    projectDir: resolved,
    ...(sessionID === undefined ? {} : { sessionID: (sessionID as string).trim() }),
  });
  const secure = req.headers['x-forwarded-proto'] === 'https';
  // A readable ticket response is a credential leak: a foreign page can send a
  // (CORS-preflighted) request and read the JSON. The gateway-level CORS header
  // would make it readable, so this one response opts out.
  try { res.removeHeader('Access-Control-Allow-Origin'); } catch { /* not set */ }
  sendJson(res, 200, issued, {
    'Set-Cookie': ticketCookie(name, issued.ticket, issued.expiresAt, secure),
    'Cache-Control': 'no-store',
  });
}

/** `GET /api/plugins/:name/ui[/<entry>]` — active packages only, MIME whitelist. */
export async function handlePluginWebAsset(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginWebRouteDeps,
  params?: PluginWebRouteParams,
): Promise<void> {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });

  const parsed = parsePluginWebAssetUrl(req.url);
  const name = params?.name ?? parsed?.name;
  if (!name) return sendJson(res, 404, { error: 'not found' });

  const auth = resolvePluginWebAssetAuth(req, deps, name);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const dir = deps.packageDir(name);
  if (!dir) return sendJson(res, 404, { error: 'not found' });

  const entry = parsed?.entry ?? DEFAULT_WEB_SURFACE_ENTRY;
  const filePath = resolvePluginWebEntry(dir, entry);
  if (!filePath) return sendJson(res, 404, { error: 'not found' });

  const contentType = pluginWebAssetContentType(filePath);
  if (!contentType) return sendJson(res, 404, { error: 'not found' });

  let size: number;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return sendJson(res, 404, { error: 'not found' });
    size = stat.size;
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }

  try {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Cache-Control': 'no-store',
      'Content-Security-Policy': ASSET_CSP,
      'X-Content-Type-Options': 'nosniff',
    });
  } catch {
    return;
  }
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => {
    try { res.destroy(); } catch { /* already gone */ }
  });
  stream.pipe(res);
}

/** `GET /api/plugins/:name/events` — SSE filtered to this package (optional session). */
export async function handlePluginWebEvents(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginWebRouteDeps,
  params: PluginWebRouteParams,
): Promise<void> {
  const name = params?.name;
  if (!name) return sendJson(res, 404, { error: 'not found' });
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  if (!deps.isActivePackage(name)) return sendJson(res, 404, { error: 'not found' });

  const auth = resolvePluginWebContextAuth(req, deps, name);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  let sessionID: string | undefined;
  try {
    const search = new URL(req.url || '/', 'http://localhost').searchParams;
    const requested = search.get('sessionID');
    sessionID = requested && requested.length > 0 ? requested : undefined;
  } catch {
    sessionID = undefined;
  }

  // E4-4：与 /api/events 共用连接表；超限在写任何 SSE 字节之前拒绝（不建流、
  // 不写 greeting），格式与主事件流一致。
  const connections = deps.connections?.() ?? null;
  const lease = connections ? connections.tryAcquire('sse') : null;
  if (connections && !lease) {
    return sendJson(res, 503, { error: 'too many sse connections', code: 'connection_limit' });
  }

  // E4-5：writer 只改变写路径；greeting / 过滤后的广播帧 / 心跳统一走它。
  const bufferOpts = deps.buffers?.() ?? null;
  const writer = bufferOpts
    ? new SseBoundedWriter({
      res,
      maxFrames: bufferOpts.maxFrames,
      maxBytes: bufferOpts.maxBytes,
      counters: bufferOpts.counters,
    })
    : null;
  const write = (frame: string): void => {
    if (!frame) return;
    if (writer) writer.write(frame);
    else res.write(frame);
  };

  let cleanupStream: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    const streamCleanup = cleanupStream;
    cleanupStream = null;
    try { streamCleanup?.(); } catch { /* best effort */ }
    writer?.dispose();
    lease?.release();
  };

  try {
    // No hardcoded `*`: the gateway-level CORS middleware already applied the
    // configured origin (`config.server.cors.origin`) to this response.
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  } catch {
    close();
    return;
  }

  const greeting = { type: 'connected', package: name, ...(sessionID ? { sessionID } : {}) };
  write(`data: ${JSON.stringify(greeting)}\n\n`);

  const matches = pluginWebEventFilter(name, sessionID);
  try {
    cleanupStream = deps.attachEventStream(res, (frame) => {
      if (matches(frame)) write(frame);
    });
  } catch (err) {
    close();
    throw err;
  }
  heartbeat = setInterval(() => {
    try { write(': ping\n\n'); } catch { /* closed; close handler cleans up */ }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  res.on('close', close);
  res.on('error', close);
}

/**
 * Pass-through for `/api/plugins/:name/api/*`.
 *
 * The body is offered as an iterator that does **not** destroy the inbound
 * request when the route cap aborts it (`destroyOnReturn: false`), and
 * `onBodyTooLarge` drains it, so a real client receives the 413 instead of a
 * socket reset.
 */
export async function handlePluginApiRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: PluginWebRouteDeps,
  name: string,
  routePath: string,
): Promise<void> {
  if (!deps.isActivePackage(name)) return sendJson(res, 404, { error: 'not found' });

  const auth = resolvePluginWebContextAuth(req, deps, name);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  const registry = deps.httpRegistry();
  if (!registry) return sendJson(res, 404, { error: 'not found' });

  const method = (req.method || 'GET').toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';
  let search: URLSearchParams | undefined;
  try {
    search = new URL(req.url || '/', 'http://localhost').searchParams;
  } catch {
    search = undefined;
  }

  const drain = (): void => {
    try { req.resume(); } catch { /* already flowing */ }
  };
  const handled = await registry.dispatch(
    name,
    {
      method,
      path: routePath,
      query: search,
      headers: req.headers,
      ...(hasBody
        ? {
            body: {
              [Symbol.asyncIterator]: () => (typeof (req as any).iterator === 'function'
                ? (req as any).iterator({ destroyOnReturn: false })
                : (req as any)[Symbol.asyncIterator]()),
            } as AsyncIterable<Buffer>,
            onBodyTooLarge: () => { setImmediate(drain); },
          }
        : {}),
    },
    res,
    auth.context,
  );

  // Drain whatever the handler did not consume (notably the 413 body-cap path):
  // the aborting body iterator pauses the stream, so a plain resume() must run
  // after the registry unwinds; otherwise the client sees a reset, not the 413.
  if (hasBody && !req.readableEnded) drain();

  if (!handled) {
    sendJson(res, 404, { error: `no plugin route for ${method} ${routePath || '/'}` });
  }
}

function rejectUpgrade(socket: Duplex, status: number, text: string): void {
  try {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  } catch { /* already gone */ }
  try { socket.destroy(); } catch { /* already gone */ }
}

/**
 * `/api/plugins/:name/ws/*` upgrade dispatcher.
 *
 * @returns `false` when the URL is not in the plugin namespace (the caller
 *   keeps its own routing); `true` once the socket is consumed, including every
 *   rejection path.
 */
export function handlePluginWsUpgrade(
  deps: PluginWebRouteDeps,
  req: http.IncomingMessage,
  socket: Duplex,
  head: Buffer,
): boolean {
  const route = parsePluginWsUrl(req.url);
  if (!route) return false;

  if (!deps.isActivePackage(route.name)) {
    rejectUpgrade(socket, 404, 'Not Found');
    return true;
  }
  // A plugin WS route can execute host work (the demo opens a PTY), so a
  // foreign page must never reach it: the ticket is mandatory and the browser
  // Origin must be the gateway itself.
  if (!pluginWebOriginAllowed(req)) {
    rejectUpgrade(socket, 403, 'Forbidden');
    return true;
  }
  const auth = resolvePluginWebContextAuth(req, deps, route.name);
  if (!auth.ok) {
    rejectUpgrade(socket, 403, 'Forbidden');
    return true;
  }
  const registry = deps.httpRegistry();
  if (!registry) {
    rejectUpgrade(socket, 404, 'Not Found');
    return true;
  }
  if (!registry.upgrade(route.name, route.path, req, socket, head, auth.context)) {
    rejectUpgrade(socket, 404, 'Not Found');
  }
  return true;
}
