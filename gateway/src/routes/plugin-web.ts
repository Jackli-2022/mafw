/**
 * Plugin Web surfaces — gateway half of the sandboxed `<webview>` contract.
 *
 * Four surfaces share one namespace (`/api/plugins/<pkg>/…`):
 * - `ui/*`  static assets from the committed package's `web/` tree;
 * - `web-ticket`  issues the path-scoped ticket cookie;
 * - `events`  SSE stream filtered to `plugin:<pkg>:*`;
 * - `api/*` + `ws/*`  the package's own `ctx.http` routes (Task 3 registry).
 *
 * Every package-scoped request resolves its context from the ticket
 * (`{ projectDir, sessionID? }`), never from the gateway's launch directory.
 * Loopback clients may omit the ticket (desktop dev + curl); a *presented* but
 * invalid ticket is always a 403, so a ticket minted for one package cannot be
 * replayed against another. Spec §5.4–§5.7.
 */
import * as fs from 'fs';
import * as http from 'http';
import type { Duplex } from 'stream';
import { canonicalProjectDir } from '../core/pod/pod-identity';
import {
  DEFAULT_WEB_SURFACE_ENTRY,
  pluginWebAssetContentType,
  resolvePluginWebEntry,
} from '../plugins/plugin-web-assets';
import type { PluginHttpRegistry } from '../plugins/plugin-http';
import type { PluginWebTicketBinding, PluginWebTicketStore } from '../plugins/plugin-web-ticket';

/** Name of the path-scoped ticket cookie (spec §5.5). */
export const PLUGIN_WEB_TICKET_COOKIE = 'mafw_plugin_ticket';
/** Header alternative for non-browser clients that cannot store cookies. */
export const PLUGIN_WEB_TICKET_HEADER = 'x-mafw-plugin-ticket';

const ASSET_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const SSE_HEARTBEAT_MS = 15_000;
const TICKET_BODY_LIMIT_BYTES = 16 * 1024;

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
  /** Process-local ticket store shared by every package-scoped route. */
  tickets: PluginWebTicketStore;
  /** Committed `ctx.http` registry, undefined before the host is ready. */
  httpRegistry(): PluginHttpRegistry | undefined;
  /** Loopback fallback auth for host-local clients. */
  isLoopback(req: http.IncomingMessage): boolean;
  /** Context used for loopback requests without a ticket (gateway project). */
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
 * Resolves the context for a package-scoped request.
 *
 * A presented ticket must verify for *this* package, even on loopback: that is
 * what makes cross-package replay a 403 instead of silently downgrading to the
 * loopback fallback.
 */
function resolvePluginWebAuth(
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

function findRegisteredProject(
  projects: readonly string[],
  requested: string,
): string | null {
  for (const project of projects) {
    if (sameProjectDir(project, requested)) return project;
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

/** `POST /api/plugins/:name/web-ticket` — loopback only, registered project required. */
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

  const registered = findRegisteredProject(deps.listProjects(), projectDir);
  if (!registered) {
    return sendJson(res, 400, { error: 'projectDir is not a registered project' });
  }

  const issued = deps.tickets.issue(name, {
    projectDir: registered,
    ...(sessionID === undefined ? {} : { sessionID: (sessionID as string).trim() }),
  });
  const secure = req.headers['x-forwarded-proto'] === 'https';
  sendJson(res, 200, issued, {
    'Set-Cookie': ticketCookie(name, issued.ticket, issued.expiresAt, secure),
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

  const auth = resolvePluginWebAuth(req, deps, name);
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

  const auth = resolvePluginWebAuth(req, deps, name);
  if (!auth.ok) return sendJson(res, auth.status, { error: auth.error });

  let sessionID: string | undefined;
  try {
    const search = new URL(req.url || '/', 'http://localhost').searchParams;
    const requested = search.get('sessionID');
    sessionID = requested && requested.length > 0 ? requested : undefined;
  } catch {
    sessionID = undefined;
  }

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
  } catch {
    return;
  }

  const greeting = { type: 'connected', package: name, ...(sessionID ? { sessionID } : {}) };
  res.write(`data: ${JSON.stringify(greeting)}\n\n`);

  const matches = pluginWebEventFilter(name, sessionID);
  const cleanup = deps.attachEventStream(res, (frame) => {
    if (matches(frame)) res.write(frame);
  });
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* closed; close handler cleans up */ }
  }, SSE_HEARTBEAT_MS);
  heartbeat.unref?.();

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    cleanup();
  };
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

  const auth = resolvePluginWebAuth(req, deps, name);
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
  const auth = resolvePluginWebAuth(req, deps, route.name);
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
