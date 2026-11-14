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
import type { PluginKind, NormalizedPackageManifest } from './package-manifest';
import { parsePackageManifest } from './package-manifest';
import { computePackageIntegrity, verifyDeclaredIntegrity } from './package-integrity';
import type { PluginAuditStore } from './plugin-audit-store';
import type { PackageLastGoodStore } from './package-last-good';
import type { PluginSafety } from './plugin-safety';

const SAFE_PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DEFAULT_MAX_REQUEST_IDS = 50;

export class PackageManagerError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
    this.name = 'PackageManagerError';
  }
}

export interface InstallConsent {
  trust: PluginKind;
  permissions: string[];
}

export interface InstallInput {
  /** Absolute path of the local source directory. */
  path: string;
  /** Replace an existing installed package of the same name. Default false. */
  overwrite?: boolean;
  /** Idempotency key: replaying the same key returns the first result. */
  requestId?: string;
  /** Required for apiVersion 2 packages; v1 packages may omit it. */
  accept?: InstallConsent;
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
  kind?: PluginKind;
  apiVersion?: 1 | 2;
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
  /**
   * `applyPending` only: the committed package owns the active runtime, so the
   * caller must switch/re-instantiate the runtime for the new revision to be
   * used. Route layer turns this into a real switch (or a manual signal).
   */
  runtimeSwitchRequired?: boolean;
  /**
   * `applyPending` only, with `runtimeSwitchRequired`: the runtime
   * contribution's declared name (loader key), which may differ from the
   * package name.
   */
  runtimeName?: string;
}

export type CheckResult = PluginCheckResult;
export interface PackageManagerDeps {
  /** Plugin package root (`~/.mafw/plugins`). */
  pluginDir: string;
  host: PluginHost;
  stateStore: PackageStateStore;
  /** Idempotency cache size (default 50). */
  maxRequestIds?: number;
  /** Untrusted packages require a working worker host. Default false. */
  workerAvailable?: boolean;
  /** Phase 6 trust audit (optional in headless hosts). */
  audit?: PluginAuditStore;
  /** Phase 6C rollback snapshots (optional in headless hosts). */
  lastGood?: PackageLastGoodStore;
  /** Phase 6C health window (optional in headless hosts). */
  safety?: PluginSafety;
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
  private readonly workerAvailable: boolean;
  private readonly audit?: PluginAuditStore;
  private readonly lastGood?: PackageLastGoodStore;
  private readonly safety?: PluginSafety;
  private readonly requestResults = new Map<string, InstallResult>();
  /** Serializes mutations so two installs cannot interleave staging markers. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(deps: PackageManagerDeps) {
    this.pluginDir = path.resolve(deps.pluginDir);
    this.host = deps.host;
    this.stateStore = deps.stateStore;
    this.maxRequestIds = deps.maxRequestIds ?? DEFAULT_MAX_REQUEST_IDS;
    this.workerAvailable = deps.workerAvailable === true;
    this.audit = deps.audit;
    this.lastGood = deps.lastGood;
    this.safety = deps.safety;
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

      this.assertConsent(manifest, input?.accept);
      if (manifest.kind === 'untrusted' && !this.workerAvailable) {
        throw new PackageManagerError(
          409,
          'untrusted packages require a worker host',
          'untrusted_requires_worker',
        );
      }
      if (manifest.integrity) {
        const check = verifyDeclaredIntegrity(source, manifest.integrity);
        if (!check.ok) {
          throw new PackageManagerError(
            422,
            `integrity mismatch: ${check.errors.join('; ')}`,
            'integrity_mismatch',
          );
        }
      }

      if (input?.overwrite === true && this.lastGood) {
        const installed = this.stateStore.getInstalled(name);
        this.lastGood.snapshot(name, {
          ...(this.installedVersion(name) !== undefined
            ? { version: this.installedVersion(name) }
            : {}),
          fingerprint: installed?.fingerprint ?? '',
        });
      }

      this.copyIntoRoot(source, name, input?.overwrite === true);
      // Windows overwrite installs rename a new directory over the package
      // path; the directory watcher from the previous object is dead even though
      // the path string is unchanged. Rebuild the watchers so hot reload keeps
      // working. Harmless for a fresh install (there is no watcher yet).
      this.host.resetWatchers();

      const installedDir = path.join(this.ensureRoot(), name);
      try {
        const snapshot = computePackageIntegrity(installedDir, path.join(installedDir, manifest.main));
        this.stateStore.setInstalled(name, {
          ...(manifest.version !== undefined ? { version: manifest.version } : {}),
          fingerprint: snapshot.fingerprint,
          files: snapshot.files,
          installedAt: new Date().toISOString(),
          consecutiveFailures: 0,
        });
      } catch (err) {
        try { fs.rmSync(installedDir, { recursive: true, force: true }); } catch { /* best effort */ }
        throw new PackageManagerError(
          500,
          `could not record integrity for ${name}: ${describeError(err)}`,
          'integrity_failed',
        );
      }

      // An installed package is enabled: the manager file is the only source
      // of the disabled flag and re-installation is an explicit opt-in.
      this.stateStore.setDisabled(name, false);
      // Do not silently replace the runtime the gateway is using right now;
      // the host turns this into a pending candidate only when it applies.
      this.host.stageNewPackage(name);
      await this.host.reload();

      const result: InstallResult = {
        ...this.toInstallResult(this.describe(name), manifest.version),
        kind: manifest.kind,
        apiVersion: manifest.apiVersion,
      };
      this.audit?.append({
        action: 'install',
        package: name,
        ...(manifest.version !== undefined ? { version: manifest.version } : {}),
        ...(this.stateStore.getInstalled(name)?.fingerprint
          ? { fingerprint: this.stateStore.getInstalled(name)!.fingerprint }
          : {}),
        result: 'ok',
        detail: {
          apiVersion: manifest.apiVersion,
          kind: manifest.kind,
          permissions: manifest.permissions,
        },
      });
      if (result.application === 'applied') {
        const installed = this.stateStore.getInstalled(name);
        if (installed) {
          this.safety?.beginHealthCheck(name, {
            ...(installed.version !== undefined ? { version: installed.version } : {}),
            fingerprint: installed.fingerprint,
          });
        }
      }
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
      this.audit?.append({ action: 'disable', package: safeName, result: 'ok' });
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
      this.audit?.append({ action: 'enable', package: safeName, result: 'ok' });
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
      this.stateStore.removeInstalled(safeName);
      this.lastGood?.remove(safeName);
      await this.host.reload();
      this.audit?.append({ action: 'remove', package: safeName, result: 'ok' });

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
      this.audit?.append({ action: 'reload', package: safeName, result: 'ok' });
      const state = this.describe(safeName);
      return {
        ...state,
        version: state.version ?? this.installedVersion(safeName),
        saved: true,
        enabled: true,
      };
    });
  }

  /** Restores the last-known-good snapshot and reloads the package. */
  rollback(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      if (!this.lastGood || !this.lastGood.restore(safeName)) {
        throw new PackageManagerError(404, `no last-known-good snapshot for ${safeName}`, 'last_good_missing');
      }
      await this.host.reload();
      this.audit?.append({ action: 'rollback', package: safeName, result: 'ok' });
      const state = this.describe(safeName);
      return {
        ...state,
        version: state.version ?? this.installedVersion(safeName),
        saved: true,
        enabled: !this.stateStore.isDisabled(safeName),
      };
    });
  }

  /** Commits a staged candidate; failures keep the previous active revision. */
  applyPending(name: string): Promise<UpdateResult> {
    return this.enqueue(async () => {
      const safeName = this.validatePackageName(name);
      const result = await this.host.applyPending(safeName);
      if (result.applied) {
        this.audit?.append({ action: 'apply', package: safeName, result: 'ok' });
        const installed = this.stateStore.getInstalled(safeName);
        if (installed) {
          this.safety?.beginHealthCheck(safeName, {
            ...(installed.version !== undefined ? { version: installed.version } : {}),
            fingerprint: installed.fingerprint,
          });
        }
      }
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
        ...(result.runtimeSwitchRequired ? { runtimeSwitchRequired: true } : {}),
        ...(result.runtimeName ? { runtimeName: result.runtimeName } : {}),
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

  private readManifest(source: string): NormalizedPackageManifest {
    const manifestPath = path.join(source, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      throw new PackageManagerError(400, `plugin.json not found in ${source}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    } catch (err) {
      throw new PackageManagerError(400, `invalid plugin.json: ${describeError(err)}`);
    }
    const result = parsePackageManifest(parsed);
    if (!result.ok || !result.manifest) {
      throw new PackageManagerError(
        400,
        `invalid plugin.json: ${result.errors.join('; ')}`,
        'invalid_manifest',
      );
    }
    return result.manifest;
  }

  /** v2 installs require explicit trust + permission consent; v1 stays compatible. */
  private assertConsent(
    manifest: NormalizedPackageManifest,
    accept: InstallConsent | undefined,
  ): void {
    if (manifest.apiVersion === 1) return;
    const declared = [...manifest.permissions].sort();
    if (!accept) {
      throw new PackageManagerError(
        400,
        `permission consent required: ${declared.join(', ') || '(none)'}`,
        'permission_consent_required',
      );
    }
    const accepted = [...new Set(accept.permissions)].sort();
    if (accept.trust !== manifest.kind || accepted.join('\0') !== declared.join('\0')) {
      throw new PackageManagerError(
        400,
        `permission consent required: ${declared.join(', ') || '(none)'}`,
        'permission_consent_required',
      );
    }
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
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: unknown };
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
