/**
 * Persistent safety state for unified plugin packages.
 *
 * Version 2 adds safe mode, quarantine, integrity baselines and health-window
 * markers on top of the v1 `disabled` list. The manager owns this file — it
 * never edits `plugin.json` and never renames package directories, so toggling
 * a package cannot change its content fingerprint.
 *
 * Reads are fail-closed for safety-critical state: an existing but unreadable
 * document enters safe mode instead of silently re-enabling every package.
 * A missing file is a fresh install, not corruption. Writes stay atomic
 * (temp + rename).
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { log } from '../core/utils/logger';

export const PACKAGE_STATE_FILE = 'plugin-package-state.json';
export const PACKAGE_STATE_VERSION = 2;

export interface PackageQuarantineEntry {
  name: string;
  reason: string;
  at: string;
  version?: string;
  fingerprint?: string;
}

export interface PackageInstalledState {
  version?: string;
  fingerprint: string;
  files: Record<string, string>;
  installedAt: string;
  consecutiveFailures: number;
  lastFailureAt?: string;
  degraded?: { reason: string; at: string; version?: string };
  lastKnownGood?: { version?: string; fingerprint: string; savedAt: string };
  pendingHealthCheck?: { version?: string; fingerprint: string; startedAt: string };
}

export interface PackageStateDocument {
  version: 2;
  /** Package names disabled by the manager (sorted, unique). */
  disabled: string[];
  safeMode: boolean;
  quarantined: PackageQuarantineEntry[];
  installed: Record<string, PackageInstalledState>;
}

interface SanitizeResult {
  document: PackageStateDocument;
  corrupt: boolean;
}

function emptyDocument(): PackageStateDocument {
  return {
    version: PACKAGE_STATE_VERSION,
    disabled: [],
    safeMode: false,
    quarantined: [],
    installed: {},
  };
}

function corruptDocument(): PackageStateDocument {
  return { ...emptyDocument(), safeMode: true };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !/[\\/]/.test(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function sanitizeQuarantine(value: unknown): PackageQuarantineEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: PackageQuarantineEntry[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || !isSafeName(raw.name)) continue;
    const reason = typeof raw.reason === 'string' ? raw.reason : 'quarantined';
    const at = isTimestamp(raw.at) ? raw.at : new Date(0).toISOString();
    if (seen.has(raw.name)) continue;
    seen.add(raw.name);
    entries.push({
      name: raw.name,
      reason,
      at,
      ...(optionalString(raw.version) !== undefined ? { version: optionalString(raw.version) } : {}),
      ...(optionalString(raw.fingerprint) !== undefined
        ? { fingerprint: optionalString(raw.fingerprint) }
        : {}),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function sanitizeFiles(value: unknown): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const files: Record<string, string> = {};
  for (const [file, hash] of Object.entries(value)) {
    if (typeof hash === 'string' && hash.length > 0) files[file] = hash;
  }
  return files;
}

function sanitizeInstalledState(value: unknown): PackageInstalledState | null {
  if (!isPlainObject(value)) return null;
  const fingerprint = typeof value.fingerprint === 'string' ? value.fingerprint : '';
  const installedAt = isTimestamp(value.installedAt)
    ? value.installedAt
    : new Date(0).toISOString();
  const failures = Number(value.consecutiveFailures);
  const consecutiveFailures = Number.isFinite(failures) && failures > 0
    ? Math.floor(failures)
    : 0;
  const state: PackageInstalledState = {
    ...(optionalString(value.version) !== undefined ? { version: optionalString(value.version) } : {}),
    fingerprint,
    files: sanitizeFiles(value.files),
    installedAt,
    consecutiveFailures,
    ...(isTimestamp(value.lastFailureAt) ? { lastFailureAt: value.lastFailureAt } : {}),
  };

  if (isPlainObject(value.degraded) && typeof value.degraded.reason === 'string') {
    state.degraded = {
      reason: value.degraded.reason,
      at: isTimestamp(value.degraded.at) ? value.degraded.at : new Date(0).toISOString(),
      ...(optionalString(value.degraded.version) !== undefined
        ? { version: optionalString(value.degraded.version) }
        : {}),
    };
  }
  if (isPlainObject(value.lastKnownGood) && typeof value.lastKnownGood.fingerprint === 'string') {
    state.lastKnownGood = {
      ...(optionalString(value.lastKnownGood.version) !== undefined
        ? { version: optionalString(value.lastKnownGood.version) }
        : {}),
      fingerprint: value.lastKnownGood.fingerprint,
      savedAt: isTimestamp(value.lastKnownGood.savedAt)
        ? value.lastKnownGood.savedAt
        : new Date(0).toISOString(),
    };
  }
  if (isPlainObject(value.pendingHealthCheck)
    && typeof value.pendingHealthCheck.fingerprint === 'string') {
    state.pendingHealthCheck = {
      ...(optionalString(value.pendingHealthCheck.version) !== undefined
        ? { version: optionalString(value.pendingHealthCheck.version) }
        : {}),
      fingerprint: value.pendingHealthCheck.fingerprint,
      startedAt: isTimestamp(value.pendingHealthCheck.startedAt)
        ? value.pendingHealthCheck.startedAt
        : new Date(0).toISOString(),
    };
  }
  return state;
}

function sanitizeInstalled(value: unknown): Record<string, PackageInstalledState> {
  if (!isPlainObject(value)) return {};
  const installed: Record<string, PackageInstalledState> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!isSafeName(name)) continue;
    const state = sanitizeInstalledState(raw);
    if (state) installed[name] = state;
  }
  return installed;
}

function sanitize(document: unknown): SanitizeResult {
  if (!isPlainObject(document)) {
    return { document: corruptDocument(), corrupt: true };
  }
  const version = document.version;
  if (version !== 1 && version !== 2) {
    return { document: corruptDocument(), corrupt: true };
  }
  const disabled = Array.isArray(document.disabled)
    ? [...new Set(document.disabled.filter(isSafeName))].sort()
    : [];
  return {
    document: {
      version: PACKAGE_STATE_VERSION,
      disabled,
      safeMode: document.safeMode === true,
      quarantined: sanitizeQuarantine(document.quarantined),
      installed: sanitizeInstalled(document.installed),
    },
    corrupt: false,
  };
}

function clone(document: PackageStateDocument): PackageStateDocument {
  return JSON.parse(JSON.stringify(document)) as PackageStateDocument;
}

export class PackageStateStore {
  private readonly file: string;
  private cache?: PackageStateDocument;
  private corrupt = false;

  /** @param dir MAFW data root (`~/.mafw`); the state file lives directly in it. */
  constructor(dir: string) {
    this.file = path.join(dir, PACKAGE_STATE_FILE);
  }

  /** Path of the persisted document (diagnostics/tests). */
  get filePath(): string {
    return this.file;
  }

  /** True when an existing state file was unreadable and safe mode was forced. */
  wasCorrupt(): boolean {
    this.read();
    return this.corrupt;
  }

  /**
   * Current document. Missing file = fresh state; unreadable file = safe mode.
   */
  read(): PackageStateDocument {
    if (this.cache) return clone(this.cache);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        this.cache = emptyDocument();
        return clone(this.cache);
      }
      log.warn(`[PackageState] ${this.file} is unreadable, entering safe mode: ${err?.message ?? String(err)}`);
      this.cache = corruptDocument();
      this.corrupt = true;
      return clone(this.cache);
    }

    const result = sanitize(parsed);
    this.cache = result.document;
    this.corrupt = result.corrupt;
    if (result.corrupt) {
      log.warn(`[PackageState] ${this.file} is invalid, entering safe mode`);
    }
    return clone(this.cache);
  }

  isDisabled(name: string): boolean {
    return this.read().disabled.includes(name);
  }

  /** Idempotent; persists atomically and only touches the file when it changes. */
  setDisabled(name: string, disabled: boolean): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('package name must be a non-empty string');
    }
    const current = this.read();
    const names = new Set(current.disabled);
    const has = names.has(name);
    if (disabled === has) return;
    if (disabled) names.add(name);
    else names.delete(name);
    this.write({ ...current, disabled: [...names].sort() });
  }

  isSafeMode(): boolean {
    return this.read().safeMode;
  }

  setSafeMode(safeMode: boolean): void {
    const current = this.read();
    if (current.safeMode === safeMode) return;
    this.write({ ...current, safeMode });
  }

  listQuarantine(): PackageQuarantineEntry[] {
    return this.read().quarantined;
  }

  getQuarantine(name: string): PackageQuarantineEntry | undefined {
    return this.read().quarantined.find((entry) => entry.name === name);
  }

  setQuarantine(entry: PackageQuarantineEntry): void {
    if (!isSafeName(entry?.name)) throw new TypeError('invalid quarantine package name');
    if (typeof entry.reason !== 'string' || entry.reason.length === 0) {
      throw new TypeError('quarantine reason is required');
    }
    const current = this.read();
    const at = isTimestamp(entry.at) ? entry.at : new Date().toISOString();
    const quarantined = current.quarantined.filter((item) => item.name !== entry.name);
    quarantined.push({
      name: entry.name,
      reason: entry.reason,
      at,
      ...(optionalString(entry.version) !== undefined ? { version: entry.version } : {}),
      ...(optionalString(entry.fingerprint) !== undefined
        ? { fingerprint: entry.fingerprint }
        : {}),
    });
    quarantined.sort((a, b) => a.name.localeCompare(b.name));
    this.write({ ...current, quarantined });
  }

  clearQuarantine(name: string): void {
    const current = this.read();
    const quarantined = current.quarantined.filter((entry) => entry.name !== name);
    if (quarantined.length === current.quarantined.length) return;
    this.write({ ...current, quarantined });
  }

  getInstalled(name: string): PackageInstalledState | undefined {
    return this.read().installed[name];
  }

  setInstalled(name: string, state: PackageInstalledState): void {
    if (!isSafeName(name)) throw new TypeError('invalid package name');
    const current = this.read();
    const sanitized = sanitizeInstalledState(state);
    if (!sanitized) throw new TypeError('invalid installed state');
    this.write({ ...current, installed: { ...current.installed, [name]: sanitized } });
  }

  updateInstalled(name: string, patch: Partial<PackageInstalledState>): void {
    if (!isSafeName(name)) throw new TypeError('invalid package name');
    const current = this.read();
    const existing = current.installed[name] ?? {
      fingerprint: '',
      files: {},
      installedAt: new Date().toISOString(),
      consecutiveFailures: 0,
    };
    const merged = sanitizeInstalledState({ ...existing, ...patch });
    if (!merged) throw new TypeError('invalid installed state');
    this.write({ ...current, installed: { ...current.installed, [name]: merged } });
  }

  removeInstalled(name: string): void {
    const current = this.read();
    if (!current.installed[name]) return;
    const installed = { ...current.installed };
    delete installed[name];
    this.write({ ...current, installed });
  }

  private write(document: PackageStateDocument): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
      fs.renameSync(tmp, this.file);
      this.cache = clone(document);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }
  }
}
