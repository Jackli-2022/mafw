/**
 * Host-side services behind `ctx.files` and `ctx.terminal`.
 *
 * Scope contract: the package context is package-scoped, but file and terminal
 * access must follow the **ticket-bound project directory** of the request, not
 * the gateway launch directory (`ctx.projectDir`). Every file call therefore
 * takes `projectDir` as its first argument and `ctx.terminal.create` takes it as
 * an option; nothing here defaults to a context-wide root.
 *
 * Boundaries:
 *  - `ctx.files` is read-only in v1, realpath-contained under the passed root,
 *    and rejects `..`, absolute paths, dotfiles and symlink escapes;
 *  - `ctx.terminal` is a thin wrapper over `TerminalService` (same PTYs as the
 *    desktop terminal): it issues its own ticket for bridging, only touches
 *    sessions it created, and closes them when its activation bag disposes;
 *  - both are Host APIs used by plugin routes — they are never exposed to the
 *    plugin page directly.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WebSocket } from 'ws';
import { log as defaultLog } from '../core/utils/logger';
import type { TerminalService, TerminalSocket } from '../terminal/terminal-service';
import type { RegistrationBag } from './registration-bag';

/** Default cap for `ctx.files.read` (8 MiB). */
export const DEFAULT_PLUGIN_READ_MAX_BYTES = 8 * 1024 * 1024;

export type PluginFileKind = 'file' | 'dir';

export interface PluginFileEntry {
  name: string;
  kind: PluginFileKind;
  /** Present for files only (bytes). */
  size?: number;
  /** Last modification time, epoch milliseconds. */
  mtime?: number;
}

export interface PluginFileStat {
  kind: PluginFileKind;
  /** Bytes; `0` for directories. */
  size: number;
  /** Last modification time, epoch milliseconds. */
  mtime: number;
}

/**
 * Read-only project-scoped file access.
 *
 * Every call is scoped by `projectDir` (the ticket-bound request directory) and
 * re-checks containment: a package can never read outside the project it is
 * currently serving — including through symlinks.
 */
export interface PluginFilesApi {
  /** Lists one directory of the project (dirs first, dot entries hidden). */
  list(projectDir: string, rel: string): Promise<PluginFileEntry[]>;
  stat(projectDir: string, rel: string): Promise<PluginFileStat>;
  /** Reads a whole file; rejects when it is larger than `maxBytes`. */
  read(projectDir: string, rel: string, opts?: { maxBytes?: number }): Promise<Buffer>;
}

export interface PluginFilesApiOptions {
  /** Overrides `DEFAULT_PLUGIN_READ_MAX_BYTES` (tests / host tuning). */
  maxReadBytes?: number;
}

export interface PluginTerminalCreateOpts {
  /** Ticket-bound project directory the PTY belongs to. */
  projectDir: string;
  cols?: number;
  rows?: number;
}

/**
 * PTY access for plugin routes.
 *
 * `create` needs the ticket-bound `projectDir`; `bridge`/`resize`/`kill` stay
 * id-based because the id already carries its project directory. Only sessions
 * created by this package instance are controllable; everything else is
 * rejected (or, for `kill`, ignored) so one package can never attach to another
 * package's — or the desktop's — terminal.
 */
export interface PluginTerminalApi {
  create(opts: PluginTerminalCreateOpts): Promise<{ id: string }>;
  /** Bridges an upgraded plugin websocket to the PTY (host issues its ticket). */
  bridge(id: string, ws: WebSocket): Promise<void>;
  resize(id: string, cols: number, rows: number): void;
  /** Closes the PTY; idempotent and a no-op for sessions this package does not own. */
  kill(id: string): void;
}

/** Internal handle: the activation owns one instance and disposes it with its bag. */
export interface PluginTerminalApiInstance extends PluginTerminalApi {
  /** Closes every PTY this instance created (idempotent, awaits the removals). */
  dispose(): Promise<void>;
}

export interface PluginTerminalDeps {
  /**
   * Lazy service lookup: runtime hot-switches must be observable and a host
   * without terminal plumbing supplies `undefined` (calls throw a neutral error
   * instead of silently accepting work that can never run).
   */
  service: () => TerminalService | undefined;
  /** Package name (ownership registry + diagnostics). */
  pkg: string;
  /**
   * Activation bag: the first PTY created here attaches this instance's
   * disposer, so reload/disable/remove close the PTYs without registering
   * anything for a package that never opens a terminal.
   *
   * This bag is the only owner of the handle — there is no package-wide sweep,
   * because a re-activating reload disposes the *replaced* revision's bag after
   * the successor has already activated (and possibly created PTYs).
   */
  bag?: RegistrationBag;
  log?: Pick<typeof defaultLog, 'warn'>;
}

const TERMINAL_UNAVAILABLE =
  'ctx.terminal is not available: this host did not provide a terminal service';
const TERMINAL_NOT_OWNED = 'terminal session is not owned by this package';

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

/** `projectDir` must be an absolute directory that exists (fail closed). */
async function resolveProjectRoot(projectDir: unknown): Promise<string> {
  if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
    throw new TypeError('projectDir is required');
  }
  if (!path.isAbsolute(projectDir)) {
    throw new TypeError(`projectDir must be an absolute path (got "${projectDir}")`);
  }
  let real: string;
  try {
    real = await fs.promises.realpath(projectDir);
  } catch {
    throw new Error(`project directory not found: ${projectDir}`);
  }
  const stats = await fs.promises.stat(real);
  if (!stats.isDirectory()) {
    throw new Error(`project directory is not a directory: ${projectDir}`);
  }
  return real;
}

/**
 * Resolves `rel` under `root` and proves containment twice: lexically (before
 * touching the disk) and through `realpath` (so a symlink cannot escape).
 */
async function resolveInsideRoot(root: string, rel: unknown): Promise<string> {
  if (typeof rel !== 'string') {
    throw new TypeError(`path must be a string (got ${typeof rel})`);
  }
  if (rel.includes('\0')) throw new Error('path contains a NUL byte');
  if (path.isAbsolute(rel)) throw new Error(`absolute paths are not allowed: ${rel}`);

  const segments = rel.split(/[\\/]+/).filter((segment) => segment.length > 0 && segment !== '.');
  for (const segment of segments) {
    if (segment === '..') throw new Error(`path traversal is not allowed: ${rel}`);
    if (segment.startsWith('.')) throw new Error(`dotfiles are not readable: ${rel}`);
  }

  const candidate = segments.length === 0 ? root : path.join(root, ...segments);
  if (!isInside(root, candidate)) throw new Error(`path escapes the project root: ${rel}`);

  let real: string;
  try {
    real = await fs.promises.realpath(candidate);
  } catch {
    throw new Error(`path not found: ${rel || '.'}`);
  }
  if (!isInside(root, real)) throw new Error(`path escapes the project root: ${rel}`);
  return real;
}

function kindOf(stats: fs.Stats, rel: string): PluginFileKind {
  if (stats.isDirectory()) return 'dir';
  if (stats.isFile()) return 'file';
  throw new Error(`unsupported file type: ${rel}`);
}

function normalizeMaxBytes(value: unknown): number {
  if (value === undefined) return DEFAULT_PLUGIN_READ_MAX_BYTES;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError('maxBytes must be a positive integer');
  }
  return value;
}

function isDotName(name: string): boolean {
  return name.startsWith('.');
}

export function createPluginFilesApi(opts: PluginFilesApiOptions = {}): PluginFilesApi {
  const defaultMaxBytes = normalizeMaxBytes(opts.maxReadBytes);

  return {
    async list(projectDir, rel) {
      const root = await resolveProjectRoot(projectDir);
      const target = await resolveInsideRoot(root, rel);
      const stats = await fs.promises.stat(target);
      if (!stats.isDirectory()) throw new Error(`not a directory: ${rel || '.'}`);

      const entries = await fs.promises.readdir(target, { withFileTypes: true });
      const out: PluginFileEntry[] = [];
      for (const entry of entries) {
        if (isDotName(entry.name)) continue;
        const entryPath = path.join(target, entry.name);
        let real: string;
        try {
          real = await fs.promises.realpath(entryPath);
        } catch {
          continue; // broken link: nothing readable to report
        }
        // A link that leaves the project is not part of the project listing.
        if (!isInside(root, real)) continue;
        let entryStats: fs.Stats;
        try {
          entryStats = await fs.promises.stat(real);
        } catch {
          continue;
        }
        const kind = entryStats.isDirectory() ? 'dir' : entryStats.isFile() ? 'file' : null;
        if (!kind) continue;
        out.push({
          name: entry.name,
          kind,
          ...(kind === 'file' ? { size: entryStats.size } : {}),
          mtime: Math.round(entryStats.mtimeMs),
        });
      }
      out.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return out;
    },

    async stat(projectDir, rel) {
      const root = await resolveProjectRoot(projectDir);
      const target = await resolveInsideRoot(root, rel);
      const stats = await fs.promises.stat(target);
      const kind = kindOf(stats, rel);
      return { kind, size: kind === 'dir' ? 0 : stats.size, mtime: Math.round(stats.mtimeMs) };
    },

    async read(projectDir, rel, readOpts) {
      const maxBytes = normalizeMaxBytes(readOpts?.maxBytes ?? defaultMaxBytes);
      const root = await resolveProjectRoot(projectDir);
      const target = await resolveInsideRoot(root, rel);
      const stats = await fs.promises.stat(target);
      if (!stats.isFile()) throw new Error(`not a file: ${rel}`);
      if (stats.size > maxBytes) {
        throw new Error(`file exceeds ${maxBytes} bytes: ${rel}`);
      }
      if (stats.size === 0) return Buffer.alloc(0);
      const handle = await fs.promises.open(target, 'r');
      try {
        const buffer = Buffer.alloc(stats.size);
        const { bytesRead } = await handle.read(buffer, 0, stats.size, 0);
        return buffer.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
  };
}

function requireProjectDir(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('projectDir is required');
  }
  if (!path.isAbsolute(value)) {
    throw new TypeError(`projectDir must be an absolute path (got "${value}")`);
  }
  return value;
}

/**
 * Creates one activation's terminal handle.
 *
 * Ownership is strictly **instance-scoped**: `dispose()` closes only the PTYs
 * this handle created, and the activation's RegistrationBag owns the disposer.
 * There is deliberately no package-wide sweep — during a re-activating reload
 * the successor candidate is activated *before* the replaced revision's bag is
 * disposed, so a sweep keyed by package name would kill the new revision's
 * PTYs. A later `create()` after `dispose()` re-arms the same handle.
 */
export function createPluginTerminalApi(deps: PluginTerminalDeps): PluginTerminalApiInstance {
  const logger = deps.log ?? defaultLog;
  const owned = new Map<string, string>();
  let bagBound = false;

  const serviceOrNull = (): TerminalService | null => deps.service() ?? null;
  const serviceOrThrow = (): TerminalService => {
    const service = serviceOrNull();
    if (!service) throw new Error(TERMINAL_UNAVAILABLE);
    return service;
  };
  const removeQuietly = (service: TerminalService | null, id: string, projectDir: string): Promise<void> => {
    if (!service) return Promise.resolve();
    return service.remove(id, projectDir).catch((err) => {
      logger.warn(`[PluginTerminal] ${deps.pkg} failed to close ${id}: ${describeError(err)}`);
    });
  };
  const ownedProjectOf = (id: unknown): string => {
    const projectDir = typeof id === 'string' ? owned.get(id) : undefined;
    if (!projectDir) throw new Error(`${TERMINAL_NOT_OWNED}: ${String(id)}`);
    return projectDir;
  };

  const api: PluginTerminalApiInstance = {
    async create(createOpts) {
      const service = serviceOrThrow();
      const projectDir = requireProjectDir(createOpts?.projectDir);
      const created = await service.create({
        directory: projectDir,
        ...(createOpts?.cols === undefined ? {} : { cols: createOpts.cols }),
        ...(createOpts?.rows === undefined ? {} : { rows: createOpts.rows }),
      });
      owned.set(created.id, projectDir);
      if (!bagBound && deps.bag) {
        bagBound = true;
        // Late registration after teardown disposes immediately (registration
        // bag semantics), so a create() racing a retire cannot orphan a PTY.
        // The bag belongs to *this* activation: replacing the revision disposes
        // this handle only, leaving a successor revision's PTYs untouched.
        deps.bag.add('plugin-terminal', () => api.dispose());
      }
      return { id: created.id };
    },

    async bridge(id, ws) {
      const service = serviceOrThrow();
      const projectDir = ownedProjectOf(id);
      // The Host owns the PTY, so it mints its own short-lived ticket instead of
      // asking the page for one: plugin pages never see the terminal ticket API.
      const { ticket } = service.issueTicket({ id, directory: projectDir });
      await service.bridge({ socket: ws as unknown as TerminalSocket, id, ticket });
    },

    resize(id, cols, rows) {
      const service = serviceOrThrow();
      const projectDir = ownedProjectOf(id);
      if (!Number.isInteger(cols) || cols <= 0 || !Number.isInteger(rows) || rows <= 0) {
        throw new Error('terminal size must be positive integers');
      }
      // Resize is fire-and-forget (same semantics as the frame path): a failed
      // resize must not tear down a live session.
      void service.resize(id, cols, rows, projectDir).catch((err) => {
        logger.warn(`[PluginTerminal] ${deps.pkg} resize failed for ${id}: ${describeError(err)}`);
      });
    },

    kill(id) {
      const projectDir = typeof id === 'string' ? owned.get(id) : undefined;
      if (!projectDir) return; // idempotent close: never reaches another owner's PTY
      owned.delete(id);
      void removeQuietly(serviceOrNull(), id, projectDir);
    },

    async dispose() {
      const service = serviceOrNull();
      const removals: Array<Promise<void>> = [];
      for (const [id, projectDir] of owned) {
        owned.delete(id);
        removals.push(removeQuietly(service, id, projectDir));
      }
      await Promise.all(removals);
    },
  };
  return api;
}
