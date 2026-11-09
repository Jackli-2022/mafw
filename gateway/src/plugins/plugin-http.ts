/**
 * Package-scoped HTTP/WebSocket routes (`ctx.http`).
 *
 * A package registers routes from its `activate()`; the PluginHost replays the
 * validated recording into this registry only when the candidate is committed,
 * and retires the routes (closing their websockets) when the owning revision is
 * replaced, disabled or removed. The public URL space is namespaced by the
 * host: `/api/plugins/<package>/api<path>` for HTTP and
 * `/api/plugins/<package>/ws<path>` for websockets — a package can never reach
 * another package's routes or a gateway route.
 *
 * During an offline `checkPackage()` the recorder validates the exact same
 * rules but its registrations are discarded, so a candidate is never reachable
 * before commit.
 */
import type { IncomingHttpHeaders, IncomingMessage } from 'http';
import type { Duplex } from 'stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { log } from '../core/utils/logger';

/** Default request body cap for package routes (32 MiB, per the design). */
export const DEFAULT_PLUGIN_HTTP_MAX_BODY_BYTES = 32 * 1024 * 1024;

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/** Request handed to a package HTTP handler (already scoped by the ticket). */
export interface PluginHttpRequest {
  method: string;
  /** Path relative to `/api/plugins/<package>/api` (`''` for the base URL). */
  path: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  /** Ticket-bound session, absent for `scope: "project"` surfaces. */
  sessionID?: string;
  /** Ticket-bound project directory — never the gateway's launch directory. */
  projectDir: string;
  body: AsyncIterable<Buffer>;
}

export interface PluginHttpResponseInit {
  status?: number;
  headers?: Record<string, string>;
  body?: string | Buffer | NodeJS.ReadableStream | AsyncIterable<Uint8Array>;
}

export type PluginHttpHandler = (req: PluginHttpRequest) => Promise<PluginHttpResponseInit | void>;

export interface PluginWsContext {
  sessionID?: string;
  projectDir: string;
}

export type PluginWsHandler = (ws: WebSocket, ctx: PluginWsContext) => void;

export interface PluginHttpRouteOptions {
  /** Per-route override of the request body cap. */
  maxBodyBytes?: number;
}

/** The package-facing surface injected as `ctx.http`. */
export interface PluginHttpApi {
  route(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    handler: PluginHttpHandler,
    opts?: PluginHttpRouteOptions,
  ): void;
  ws(path: string, handler: PluginWsHandler): void;
}

export interface PluginHttpRouteInfo {
  package: string;
  /** HTTP method, or `WS` for a websocket route. */
  method: string;
  path: string;
  ws: boolean;
}

/** Minimal response writer; Node's `ServerResponse` structurally satisfies it. */
export interface PluginHttpResponseWriter {
  writeHead(status: number, headers?: Record<string, string>): void;
  /**
   * Node returns `false` when the socket buffer is above `highWaterMark`; the
   * caller must then wait for `drain` before writing more (a plugin can stream
   * megabytes, so ignoring this would grow the gateway's heap to the size of
   * the response). Test doubles may return `void`.
   */
  write(chunk: string | Buffer | Uint8Array): boolean | void;
  end(chunk?: string | Buffer | Uint8Array): void;
  /** Present on Node streams; absent on doubles without backpressure. */
  once?(event: 'drain' | 'close', listener: (...args: unknown[]) => void): void;
  removeListener?(event: 'drain' | 'close', listener: (...args: unknown[]) => void): void;
  /** Node stream state; used to stop a stream whose peer went away. */
  readonly destroyed?: boolean;
  readonly writableEnded?: boolean;
}

/** Request shape accepted by `dispatch()` (the host adds ticket context). */
export interface PluginHttpDispatchRequest {
  method: string;
  path: string;
  query?: URLSearchParams;
  headers?: IncomingHttpHeaders;
  body?: AsyncIterable<Buffer | Uint8Array>;
  /**
   * Invoked once when `body` exceeds the route cap, before the 413 is written.
   * Hosts use it to drain the inbound stream (`req.resume()`); the body iterator
   * passed by the host must not destroy the socket on return or a real client
   * would see a reset instead of the 413.
   */
  onBodyTooLarge?: () => void;
}

export interface PluginHttpRegistry {
  register(
    pkg: string,
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: PluginHttpRouteOptions,
  ): void;
  registerWs(pkg: string, path: string, handler: PluginWsHandler): void;
  /** Drops every route of the package and closes its live websockets (1001). */
  retire(pkg: string): void;
  /**
   * Writes the matched route's response to `res`.
   *
   * @returns `false` when no route matches (the caller should 404 without
   *   touching the response); `true` once a response has been written.
   */
  dispatch(
    pkg: string,
    req: PluginHttpDispatchRequest,
    res: PluginHttpResponseWriter,
    ctx: PluginWsContext,
  ): Promise<boolean>;
  /**
   * Completes the websocket handshake for a matching route.
   *
   * @returns `false` when no route matches; the caller owns the socket then.
   */
  upgrade(
    pkg: string,
    path: string,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    ctx: PluginWsContext,
  ): boolean;
  routes(): PluginHttpRouteInfo[];
}

/** Thrown by the body wrapper when a request exceeds its route's cap. */
export class PluginHttpBodyTooLargeError extends Error {
  constructor(readonly maxBodyBytes: number) {
    super(`request body exceeds ${maxBodyBytes} bytes`);
    this.name = 'PluginHttpBodyTooLargeError';
  }
}

export type PluginHttpRecordedRoute =
  | {
      kind: 'http';
      method: string;
      path: string;
      handler: PluginHttpHandler;
      maxBodyBytes?: number;
    }
  | { kind: 'ws'; path: string; handler: PluginWsHandler };

/**
 * Per-activation recorder behind `ctx.http`.
 *
 * `seal()` is called by the host as soon as `activate()` returns: a late
 * registration outside activation would never be committed, so it throws
 * instead of silently disappearing.
 */
export interface PluginHttpRecorder {
  api: PluginHttpApi;
  readonly entries: readonly PluginHttpRecordedRoute[];
  seal(): void;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function assertPackageName(pkg: unknown): asserts pkg is string {
  if (typeof pkg !== 'string' || pkg.length === 0) {
    throw new TypeError('plugin http routes require a non-empty package name');
  }
}

function assertHandler(handler: unknown, label: string): void {
  if (typeof handler !== 'function') {
    throw new TypeError(`${label} must be a function (got ${typeof handler})`);
  }
}

function normalizeMethod(method: unknown): string {
  if (typeof method !== 'string' || method.length === 0) {
    throw new TypeError('route method must be a non-empty string');
  }
  const upper = method.toUpperCase();
  if (!SUPPORTED_METHODS.has(upper)) {
    throw new Error(`unsupported route method "${method}" (allowed: GET, POST, PUT, PATCH, DELETE)`);
  }
  return upper;
}

/**
 * Normalizes a registered path: `''` (or `/`) is the package's API root,
 * everything else must be an absolute path with no traversal, params, query or
 * fragment. Only exact matches are supported in v1.
 */
function normalizeRoutePath(path: unknown): string {
  if (typeof path !== 'string') throw new TypeError('route path must be a string');
  if (path === '' || path === '/') return '';
  if (!path.startsWith('/')) {
    throw new Error(`route path "${path}" must be '' or start with '/'`);
  }
  if (path.includes('..')) {
    throw new Error(`route path "${path}" must not contain ".."`);
  }
  if (path.includes(':')) {
    throw new Error(`route path "${path}" must not contain ":" (path params are not supported)`);
  }
  if (path.includes('?') || path.includes('#')) {
    throw new Error(`route path "${path}" must not contain a query or fragment`);
  }
  if (path.includes('\\') || path.includes('\0')) {
    throw new Error(`route path "${path}" contains an invalid character`);
  }
  return path;
}

/** Lenient path normalization for inbound requests; invalid paths never match. */
function normalizeRequestPath(path: unknown): string | null {
  if (typeof path !== 'string') return null;
  const clean = path.replace(/[?#].*$/, '');
  if (clean === '' || clean === '/') return '';
  if (!clean.startsWith('/')) return null;
  if (clean.includes('..') || clean.includes(':') || clean.includes('\\') || clean.includes('\0')) {
    return null;
  }
  return clean;
}

function normalizeMaxBodyBytes(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('maxBodyBytes must be a positive integer');
  }
  return value;
}

function routeKey(method: string, path: string): string {
  return `${method}\u0000${path}`;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === wanted);
}

function writeJson(res: PluginHttpResponseWriter, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(body)),
  });
  res.end(body);
}

/** Buffers one limited, Buffer-typed copy of the inbound body. */
async function* limitBody(
  source: AsyncIterable<Buffer | Uint8Array> | undefined,
  maxBodyBytes: number,
  onBodyTooLarge?: () => void,
): AsyncIterable<Buffer> {
  if (!source) return;
  let total = 0;
  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBodyBytes) {
      try { onBodyTooLarge?.(); } catch { /* drain failures must not mask the 413 */ }
      throw new PluginHttpBodyTooLargeError(maxBodyBytes);
    }
    yield buffer;
  }
}

/** True once the response can no longer receive bytes (peer gone / ended). */
function writerClosed(res: PluginHttpResponseWriter): boolean {
  return res.destroyed === true || res.writableEnded === true;
}

/**
 * Resolves when the socket drained, the peer went away, or the writer has no
 * backpressure signals (test doubles). Never rejects: a closed peer is not a
 * handler error, the caller stops on `writerClosed`.
 */
function waitForDrain(res: PluginHttpResponseWriter): Promise<void> {
  const add = res.once;
  if (typeof add !== 'function') return Promise.resolve();
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      try { res.removeListener?.('drain', finish); } catch { /* already removed */ }
      try { res.removeListener?.('close', finish); } catch { /* already removed */ }
      resolve();
    };
    try {
      add.call(res, 'drain', finish);
      add.call(res, 'close', finish);
    } catch {
      finish();
    }
  });
}

/** One backpressure-aware write; resolves after `drain` when the buffer is full. */
async function writeChunk(res: PluginHttpResponseWriter, chunk: Buffer): Promise<void> {
  if (writerClosed(res)) return;
  if (res.write(chunk) !== false) return;
  await waitForDrain(res);
}

async function writeResponseBody(
  res: PluginHttpResponseWriter,
  body: string | Buffer | NodeJS.ReadableStream | AsyncIterable<Uint8Array>,
): Promise<number> {
  if (typeof body === 'string') {
    res.end(body);
    return Buffer.byteLength(body);
  }
  if (Buffer.isBuffer(body)) {
    res.end(body);
    return body.length;
  }
  if (typeof (body as any)[Symbol.asyncIterator] === 'function') {
    let total = 0;
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (writerClosed(res)) break;
      await writeChunk(res, buffer);
    }
    res.end();
    return total;
  }
  // Legacy readable stream without Symbol.asyncIterator.
  const stream = body as NodeJS.ReadableStream;
  let total = 0;
  await new Promise<void>((resolve, reject) => {
    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (writerClosed(res)) {
        stream.pause?.();
        return;
      }
      if (res.write(buffer) === false) {
        stream.pause?.();
        void waitForDrain(res).then(() => {
          if (!writerClosed(res)) stream.resume?.();
        });
      }
    });
    stream.on('end', () => resolve());
    stream.on('error', (err) => reject(err));
  });
  res.end();
  return total;
}

/**
 * Creates the package-facing recorder.
 *
 * The registry is deliberately not referenced here: offline checks use the same
 * recorder and throw away its entries.
 */
export function createPluginHttpRecorder(pkg: string): PluginHttpRecorder {
  assertPackageName(pkg);
  const entries: PluginHttpRecordedRoute[] = [];
  const httpKeys = new Set<string>();
  const wsKeys = new Set<string>();
  let sealed = false;

  const assertOpen = (): void => {
    if (sealed) {
      throw new Error(`ctx.http is only available during activate() (package "${pkg}")`);
    }
  };

  const api: PluginHttpApi = {
    route(method, path, handler, opts) {
      assertOpen();
      const normalizedMethod = normalizeMethod(method);
      const normalizedPath = normalizeRoutePath(path);
      assertHandler(handler, 'http handler');
      const maxBodyBytes = normalizeMaxBodyBytes(opts?.maxBodyBytes);
      const key = routeKey(normalizedMethod, normalizedPath);
      if (httpKeys.has(key)) {
        throw new Error(
          `duplicate http route ${normalizedMethod} ${normalizedPath || '/'} in package "${pkg}"`,
        );
      }
      httpKeys.add(key);
      entries.push({
        kind: 'http',
        method: normalizedMethod,
        path: normalizedPath,
        handler,
        ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
      });
    },
    ws(path, handler) {
      assertOpen();
      const normalizedPath = normalizeRoutePath(path);
      assertHandler(handler, 'ws handler');
      if (wsKeys.has(normalizedPath)) {
        throw new Error(`duplicate ws route ${normalizedPath || '/'} in package "${pkg}"`);
      }
      wsKeys.add(normalizedPath);
      entries.push({ kind: 'ws', path: normalizedPath, handler });
    },
  };

  return {
    api,
    entries,
    seal: () => { sealed = true; },
  };
}

interface HttpEntry {
  readonly package: string;
  readonly method: string;
  readonly path: string;
  readonly handler: PluginHttpHandler;
  readonly maxBodyBytes: number;
}

interface WsEntry {
  readonly package: string;
  readonly path: string;
  readonly handler: PluginWsHandler;
}

interface PackageHttpState {
  readonly http: Map<string, HttpEntry>;
  readonly ws: Map<string, WsEntry>;
  wss?: WebSocketServer;
  readonly sockets: Set<WebSocket>;
}

export interface PluginHttpRegistryDeps {
  log: typeof log;
}

export function createPluginHttpRegistry(deps: PluginHttpRegistryDeps): PluginHttpRegistry {
  const log = deps.log;
  const packages = new Map<string, PackageHttpState>();

  function stateFor(pkg: string, create: boolean): PackageHttpState | undefined {
    let state = packages.get(pkg);
    if (!state && create) {
      state = { http: new Map(), ws: new Map(), sockets: new Set() };
      packages.set(pkg, state);
    }
    return state;
  }

  function register(
    pkg: string,
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: PluginHttpRouteOptions,
  ): void {
    assertPackageName(pkg);
    const normalizedMethod = normalizeMethod(method);
    const normalizedPath = normalizeRoutePath(path);
    assertHandler(handler, 'http handler');
    const maxBodyBytes = normalizeMaxBodyBytes(opts?.maxBodyBytes) ?? DEFAULT_PLUGIN_HTTP_MAX_BODY_BYTES;
    const state = stateFor(pkg, true)!;
    const key = routeKey(normalizedMethod, normalizedPath);
    if (state.http.has(key)) {
      throw new Error(
        `duplicate http route ${normalizedMethod} ${normalizedPath || '/'} in package "${pkg}"`,
      );
    }
    state.http.set(key, { package: pkg, method: normalizedMethod, path: normalizedPath, handler, maxBodyBytes });
  }

  function registerWs(pkg: string, path: string, handler: PluginWsHandler): void {
    assertPackageName(pkg);
    const normalizedPath = normalizeRoutePath(path);
    assertHandler(handler, 'ws handler');
    const state = stateFor(pkg, true)!;
    if (state.ws.has(normalizedPath)) {
      throw new Error(`duplicate ws route ${normalizedPath || '/'} in package "${pkg}"`);
    }
    state.ws.set(normalizedPath, { package: pkg, path: normalizedPath, handler });
  }

  function retire(pkg: string): void {
    const state = packages.get(pkg);
    if (!state) return;
    packages.delete(pkg);
    for (const ws of state.sockets) {
      try {
        ws.close(1001, 'plugin retired');
      } catch {
        try { ws.terminate(); } catch { /* already closed */ }
      }
    }
    state.sockets.clear();
    if (state.wss) {
      try { state.wss.close(); } catch { /* already closed */ }
      state.wss = undefined;
    }
  }

  async function dispatch(
    pkg: string,
    req: PluginHttpDispatchRequest,
    res: PluginHttpResponseWriter,
    ctx: PluginWsContext,
  ): Promise<boolean> {
    const path = normalizeRequestPath(req.path);
    if (path === null) return false;
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : '';
    const entry = packages.get(pkg)?.http.get(routeKey(method, path));
    if (!entry) return false;

    const request: PluginHttpRequest = {
      method,
      path,
      query: req.query ?? new URLSearchParams(),
      headers: req.headers ?? {},
      sessionID: ctx.sessionID,
      projectDir: ctx.projectDir,
      body: limitBody(req.body, entry.maxBodyBytes, req.onBodyTooLarge),
    };

    let init: PluginHttpResponseInit | void;
    try {
      init = await entry.handler(request);
    } catch (err) {
      const tooLarge = err instanceof PluginHttpBodyTooLargeError;
      log.warn(
        `[PluginHttp] ${pkg} ${method} ${path || '/'} handler failed` +
          `${tooLarge ? ' (body too large)' : ''}: ${describeError(err)}`,
      );
      writeJson(res, tooLarge ? 413 : 500, {
        error: tooLarge ? 'request body too large' : 'plugin handler failed',
      });
      return true;
    }

    const status = typeof init?.status === 'number' && Number.isInteger(init.status)
      && init.status >= 100 && init.status <= 599
      ? init.status
      : (init?.body === undefined ? 204 : 200);
    const headers: Record<string, string> = { ...(init?.headers ?? {}) };
    if (typeof init?.body === 'string' && !hasHeader(headers, 'content-type')) {
      headers['content-type'] = 'text/plain; charset=utf-8';
    }
    try {
      res.writeHead(status, headers);
    } catch (err) {
      // A malformed handler response must not take down the dispatch chain.
      log.warn(`[PluginHttp] ${pkg} ${method} ${path || '/'} invalid response headers: ${describeError(err)}`);
      try {
        writeJson(res, 500, { error: 'plugin handler returned invalid headers' });
      } catch { /* client already gone */ }
      return true;
    }

    if (init?.body === undefined) {
      res.end();
      log.debug(`[PluginHttp] ${pkg} ${method} ${path || '/'} -> ${status} (0 bytes)`);
      return true;
    }
    try {
      const bytes = await writeResponseBody(res, init.body);
      log.debug(`[PluginHttp] ${pkg} ${method} ${path || '/'} -> ${status} (${bytes} bytes)`);
    } catch (err) {
      // Headers are already on the wire; abort the stream instead of pretending
      // a clean response.
      log.warn(`[PluginHttp] ${pkg} ${method} ${path || '/'} response stream failed: ${describeError(err)}`);
      try { res.end(); } catch { /* client already gone */ }
    }
    return true;
  }

  function upgrade(
    pkg: string,
    path: string,
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    ctx: PluginWsContext,
  ): boolean {
    const state = packages.get(pkg);
    const normalizedPath = normalizeRequestPath(path);
    if (!state || normalizedPath === null) return false;
    const entry = state.ws.get(normalizedPath);
    if (!entry) return false;

    const wss = state.wss ?? new WebSocketServer({ noServer: true });
    state.wss = wss;
    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        state.sockets.add(ws);
        const forget = (): void => { state.sockets.delete(ws); };
        ws.on('close', forget);
        ws.on('error', (err) => {
          log.warn(`[PluginHttp] ${pkg} ws ${normalizedPath || '/'} error: ${describeError(err)}`);
          forget();
        });
        try {
          const result = entry.handler(ws, { sessionID: ctx.sessionID, projectDir: ctx.projectDir }) as unknown;
          if (result && typeof (result as Promise<void>).then === 'function') {
            (result as Promise<void>).then(undefined, (err) => {
              log.warn(`[PluginHttp] ${pkg} ws ${normalizedPath || '/'} handler failed: ${describeError(err)}`);
              try { ws.close(1011, 'plugin ws handler failed'); } catch { /* already closed */ }
            });
          }
        } catch (err) {
          log.warn(`[PluginHttp] ${pkg} ws ${normalizedPath || '/'} handler failed: ${describeError(err)}`);
          try { ws.close(1011, 'plugin ws handler failed'); } catch { /* already closed */ }
        }
      });
    } catch (err) {
      log.warn(`[PluginHttp] ${pkg} ws ${normalizedPath || '/'} upgrade failed: ${describeError(err)}`);
      try { socket.destroy(); } catch { /* already gone */ }
      return true;
    }
    return true;
  }

  function routes(): PluginHttpRouteInfo[] {
    const out: PluginHttpRouteInfo[] = [];
    for (const [pkg, state] of packages) {
      for (const entry of state.http.values()) {
        out.push({ package: pkg, method: entry.method, path: entry.path, ws: false });
      }
      for (const entry of state.ws.values()) {
        out.push({ package: pkg, method: 'WS', path: entry.path, ws: true });
      }
    }
    return out;
  }

  return { register, registerWs, retire, dispatch, upgrade, routes };
}
