/**
 * Filesystem operations for unified plugin packages.
 *
 * The manager owns everything the host deliberately does not know about:
 * copying a package from a local directory into the plugin root, the persisted
 * enabled/disabled flag, deleting an installed package, and translating host
 * staging/pending results into one operation result shape.
 *
 * Safety rules (all paths are resolved and containment-checked):
 * - `installFromPath` accepts an absolute local directory only; the directory
 *   must contain a readable `plugin.json` whose `name` is a single path
 *   segment.
 * - Copies land in a hidden temp directory inside the plugin root and are
 *   renamed into place, so a failed copy can never leave a half package.
 * - `remove` disposes the package first, then deletes only the realpath of the
 *   package entry that is contained in the plugin root.
 *
 * An install/enable of a package that would take over the currently active
 * runtime is staged as pending by the host; this manager never switches
 * runtimes itself.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import type { PluginCheckResult, PluginHost } from './package-host';
import type { PackageStateStore } from './package-state-store';
import type { PackageManifest } from './package-types';

const SAFE_PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_MAX_REQUEST_IDS = 50;

export class PackageManagerError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PackageManagerError';
  }
}

export interface InstallInput {
  /** Absolute path of the local source directory. */
  path: string;
  /** Replace an existing installed package of the same name. Default false. */
  overwrite?: boolean;
  /** Idempotency key: replaying the same key returns the first result. */
  requestId?: string;
}

export interface InstallResult {
  name: string;
  version?: string;
  activeRevision?: string;
  pendingRevision?: string;
  /** True once the package files exist in the plugin root. */
  saved: boolean;
  application: 'applied' | 'pending' | 'failed';
  error?: string;
}

export interface UpdateResult {
  name: string;
  version?: string;
  activeRevision?: string;
  pendingRevision?: string;
  saved: boolean;
  enabled: boolean;
  application: 'applied' | 'pending' | 'failed';
  error?: string;
}

export type CheckResult = PluginCheckResult;
export interface PackageManagerDeps {
  /** Plugin package root (`~/.mafw/plugins`). */
  pluginDir: string;
  host: PluginHost;
  stateStore: PackageStateStore;
  /** Idempotency cache size (default 50). */
  maxRequestIds?: number;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return String(err);
}

function normalizeCase(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** True when `target` is a proper descendant of `root` (both absolute). */
function isContained(root: string, target: string): boolean {
  const rel = path.relative(normalizeCase(root), normalizeCase(target));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function assertContained(root: string, target: string): void {
  if (!isContained(root, target)) {
    throw new PackageManagerError(400, `path escapes the plugin root: ${target}`);
  }
}

function samePath(a: string, b: string): boolean {
  return normalizeCase(path.resolve(a)) === normalizeCase(path.resolve(b));
}

export class PackageManager {
  private readonly pluginDir: string;
  private readonly host: PluginHost;
  private readonly stateStore: PackageStateStore;
  private readonly maxRequestIds: number;
  private readonly requestResults = new Map<string, InstallResult>();
  /** Serializes mutations so two installs cannot interleave staging markers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: PackageManagerDeps) {
    this.pluginDir = path.resolve(deps.pluginDir);
    this.host = deps.host;
    this.stateStore = deps.stateStore;
    this.maxRequestIds = deps.maxRequestIds ?? DEFAULT_MAX_REQUEST_IDS;
  }

  /** Absolute plugin package root (`~/.mafw/plugins` by default). */
  getPluginDir(): string {
    return this.pluginDir;
  }

  /** Manager-owned enabled/disabled state (Hub listing needs it for disabled packages). */
  getStateStore(): PackageStateStore {
    return this.stateStore;
  }

  /**
   * Copies an absolute local directory package into the plugin root and asks
   * the host to activate it. A package that owns the active runtime is staged
   * as pending instead of interrupting it.
   */
  installFromPath(input: InstallInput): Promise<InstallResult> {
    const requestId = typeof input?.requestId === 'string' && input.requestId.length > 0
      ? input.requestId
      : undefined;
    const cached = requestId ? this.requestResults.get(requestId) : undefined;
    if (cached) return Promise.resolve({ ...cached });

    return this.enqueue(async () => {
      const replay = requestId ? this.requestResults.get(requestId) : undefined;
      if (replay) return { ...replay };

      const source = this.resolveSourceDirectory(input?.path);
      const manifest = this.readManifest(source);
      const name = this.validatePackageName(manifest.name);

      this.copyIntoRoot(source, name, input?.overwrite === true);

      // An installed package is enabled: the manager file is the only source
      // of the disabled flag and re-installation is an explicit opt-in.
      this.stateStore.setDisabled(name, false);
      // Do not silently replace the runtime the gateway is using right now;
      // the host turns this into a pending candidate only when it applies.
      this.host.stageNewPackage(name);
      await this.host.reload();

      const result = this.toInstallResult(this.describe(name), manifest.version);
      if (requestId) this.remember(requestId, result);
      return result;
    });
  }

  /** Activates a candidate from any local directory, then disposes it. */
  checkPath(sourcePath: string): Promise<CheckResult> {
    return this.enqueue(async () => {
      const source = this.resolveSourceDirectory(sourcePath);
      // Same manifest rules as install: absolute local directory, safe name,
      // entry file inside the package. Activation failures come back as
      // `ok:false` so the caller can show a diagnostic.
      this.readManifest(source);
      return this.host.checkPackage(source);
    });
  }

  /** Writes the disabled flag and rescans; the package stays on disk. */
  disable(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      this.assertInstalled(safeName);
      this.stateStore.setDisabled(safeName, true);
      await this.host.reload();
      return {
        name: safeName,
        version: this.installedVersion(safeName),
        activeRevision: this.host.getClientSnapshot().revision,
        saved: true,
        enabled: false,
        application: 'applied',
      };
    });
  }

  /** Clears the disabled flag and rescans through the normal staging flow. */
  enable(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      this.assertInstalled(safeName);
      this.stateStore.setDisabled(safeName, false);
      // Re-enabling a runtime package must not silently replace the active
      // runtime either: the host stages it as pending when it applies.
      this.host.stageNewPackage(safeName);
      await this.host.reload();
      const state = this.describe(safeName);
      return {
        ...state,
        version: state.version ?? this.installedVersion(safeName),
        saved: true,
        enabled: !this.stateStore.isDisabled(safeName),
      };
    });
  }

  /** Disposes and deletes one installed package (directory or single file). */
  remove(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      const target = this.assertInstalled(safeName);
      const version = this.installedVersion(safeName);
      // Validate the deletion target before disposing: nothing may be torn
      // down for a path that would then be rejected.
      const root = this.ensureRoot();
      const realTarget = fs.realpathSync(target);
      assertContained(root, realTarget);

      // Dispose before touching the filesystem: the host drops the action and
      // event registrations, timers and (on Windows) the directory watcher.
      await this.host.removePackage(safeName);

      fs.rmSync(realTarget, { recursive: true, force: true });
      this.stateStore.setDisabled(safeName, false);
      await this.host.reload();

      return {
        name: safeName,
        version,
        activeRevision: this.host.getClientSnapshot().revision,
        saved: true,
        enabled: false,
        application: 'applied',
      };
    });
  }

  /**
   * Rescans through the host's staging/commit flow. A changed package that
   * owns the active runtime stays pending; nothing here bypasses that rule.
   */
  reload(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      this.assertInstalled(safeName);
      if (this.stateStore.isDisabled(safeName)) {
        return {
          name: safeName,
          version: this.installedVersion(safeName),
          activeRevision: this.host.getClientSnapshot().revision,
          saved: false,
          enabled: false,
          application: 'applied',
        };
      }
      await this.host.reload();
      const state = this.describe(safeName);
      return {
        ...state,
        version: state.version ?? this.installedVersion(safeName),
        saved: true,
        enabled: true,
      };
    });
  }

  /** Commits a staged candidate; failures keep the previous active revision. */
  applyPending(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      const result = await this.host.applyPending(safeName);
      if (!result.applied) {
        return {
          name: safeName,
          version: this.installedVersion(safeName),
          saved: false,
          enabled: !this.stateStore.isDisabled(safeName),
          application: 'failed',
          error: result.error ?? `no pending revision for "${safeName}"`,
        };
      }
      return {
        name: safeName,
        version: this.installedVersion(safeName),
        activeRevision: result.revision,
        saved: true,
        enabled: true,
        application: 'applied',
      };
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private remember(requestId: string, result: InstallResult): void {
    this.requestResults.set(requestId, { ...result });
    while (this.requestResults.size > this.maxRequestIds) {
      const oldest = this.requestResults.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.requestResults.delete(oldest);
    }
  }

  private validatePackageName(name: unknown): string {
    if (typeof name !== 'string' || !SAFE_PACKAGE_NAME.test(name) || /[. ]$/.test(name)) {
      throw new PackageManagerError(400, `invalid package name: ${String(name)}`);
    }
    return name;
  }

  /** Resolves an absolute local directory through realpath. */
  private resolveSourceDirectory(raw: unknown): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new PackageManagerError(400, 'path is required');
    }
    if (!path.isAbsolute(raw)) {
      throw new PackageManagerError(400, `path must be absolute: ${raw}`);
    }
    if (!fs.existsSync(raw)) {
      throw new PackageManagerError(404, `source directory not found: ${raw}`);
    }
    const real = fs.realpathSync(raw);
    if (!fs.statSync(real).isDirectory()) {
      throw new PackageManagerError(400, `source is not a directory: ${raw}`);
    }
    return real;
  }

  private readManifest(source: string): PackageManifest {
    const manifestPath = path.join(source, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      throw new PackageManagerError(400, `plugin.json not found in ${source}`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new PackageManagerError(400, `invalid plugin.json: ${describeError(err)}`);
    }
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new PackageManagerError(400, 'invalid plugin.json: expected an object');
    }
    const record = manifest as Record<string, unknown>;
    this.validatePackageName(record.name);
    if (record.main !== undefined && (typeof record.main !== 'string' || record.main.length === 0)) {
      throw new PackageManagerError(400, 'invalid plugin.json: "main" must be a non-empty string');
    }
    if (typeof record.main === 'string') {
      // The entry file must live inside the package: a manifest is data, it
      // cannot point the host at an arbitrary local module.
      const resolved = path.resolve(source, record.main);
      if (!isContained(source, resolved)) {
        throw new PackageManagerError(400, 'invalid plugin.json: "main" escapes the package');
      }
    }
    return record as unknown as PackageManifest;
  }

  private ensureRoot(): string {
    fs.mkdirSync(this.pluginDir, { recursive: true });
    return fs.realpathSync(this.pluginDir);
  }

  /**
   * Copies `source` into a hidden temp directory and renames it into place.
   * Existing packages are only replaced when `overwrite` is true; the previous
   * directory is moved aside first so a failed rename can restore it.
   */
  private copyIntoRoot(source: string, name: string, overwrite: boolean): void {
    const root = this.ensureRoot();
    const dest = path.join(root, name);
    assertContained(root, dest);
    // A single-file package with the same name is a different on-disk layout;
    // installing a directory next to it would create two packages with one name.
    const legacyFile = path.join(root, `${name}.js`);
    if (fs.existsSync(legacyFile)) {
      throw new PackageManagerError(
        409,
        `package already installed as a single file: ${name}.js (remove it first)`,
      );
    }
    const destExists = fs.existsSync(dest);
    if (destExists && !overwrite) {
      throw new PackageManagerError(409, `package already installed: ${name}`);
    }
    if (destExists) {
      const realDest = fs.realpathSync(dest);
      assertContained(root, realDest);
      const realSource = fs.realpathSync(source);
      if (samePath(realSource, realDest) || isContained(realDest, realSource)) {
        throw new PackageManagerError(400, 'source must not be the installed package or inside it');
      }
    }

    const temp = path.join(root, `.install-${randomBytes(6).toString('hex')}`);
    try {
      fs.cpSync(source, temp, { recursive: true, dereference: false, force: true });
      if (!fs.existsSync(path.join(temp, 'plugin.json'))) {
        throw new PackageManagerError(400, 'copied package is missing plugin.json');
      }
      if (!destExists) {
        fs.renameSync(temp, dest);
        return;
      }
      const backup = path.join(root, `.backup-${randomBytes(6).toString('hex')}`);
      fs.renameSync(dest, backup);
      try {
        fs.renameSync(temp, dest);
      } catch (err) {
        fs.renameSync(backup, dest);
        throw err;
      }
      fs.rmSync(backup, { recursive: true, force: true });
    } catch (err) {
      if (err instanceof PackageManagerError) throw err;
      throw new PackageManagerError(500, `could not install ${name}: ${describeError(err)}`);
    } finally {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  /** Installed directory or single-file entry, containment already implied. */
  private assertInstalled(name: string): string {
    const root = this.ensureRoot();
    const dir = path.join(root, name);
    if (fs.existsSync(dir)) return dir;
    const file = path.join(root, `${name}.js`);
    if (fs.existsSync(file)) return file;
    throw new PackageManagerError(404, `package not found: ${name}`);
  }

  private installedVersion(name: string): string | undefined {
    try {
      const manifestPath = path.join(this.ensureRoot(), name, 'plugin.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PackageManifest;
      return typeof manifest?.version === 'string' ? manifest.version : undefined;
    } catch {
      return undefined;
    }
  }

  /** Host state → manager result (active revision, pending candidate, error). */
  private describe(name: string): UpdateResult {
    const enabled = !this.stateStore.isDisabled(name);
    const state = this.host.getState().find((entry) => entry.name === name);
    if (!state) {
      return {
        name,
        saved: true,
        enabled,
        application: 'failed',
        error: `package "${name}" was not activated`,
      };
    }
    if (state.status === 'error') {
      return {
        name,
        version: state.version,
        activeRevision: state.revision,
        pendingRevision: state.pendingRevision,
        saved: true,
        enabled,
        application: 'failed',
        error: state.error ?? 'activation failed',
      };
    }
    return {
      name,
      version: state.version,
      activeRevision: state.revision,
      pendingRevision: state.pendingRevision,
      saved: true,
      enabled,
      application: state.pendingRevision ? 'pending' : 'applied',
    };
  }

  private toInstallResult(described: UpdateResult, fallbackVersion?: string): InstallResult {
    const result: InstallResult = {
      name: described.name,
      version: described.version ?? fallbackVersion,
      saved: described.saved,
      application: described.application,
    };
    if (described.activeRevision) result.activeRevision = described.activeRevision;
    if (described.pendingRevision) result.pendingRevision = described.pendingRevision;
    if (described.error) result.error = described.error;
    return result;
  }
}

/** Exposed for tests/diagnostics: classify a manager error status. */
export function isPackageManagerError(err: unknown): err is PackageManagerError {
  return err instanceof PackageManagerError;
}
