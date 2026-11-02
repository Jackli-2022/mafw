/**
 * Persistent enabled/disabled state for unified plugin packages.
 *
 * The manager owns this file — it never edits `plugin.json` and never renames
 * package directories, so toggling a package cannot change its content
 * fingerprint. A disabled package stays installed; the host simply skips it
 * while scanning. Writes are atomic (temp + rename) and reads fail open to an
 * empty document so a corrupt file cannot stop the gateway from booting.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { log } from '../core/utils/logger';

export const PACKAGE_STATE_FILE = 'plugin-package-state.json';
export const PACKAGE_STATE_VERSION = 1;

export interface PackageStateDocument {
  version: number;
  /** Package names disabled by the manager (sorted, unique). */
  disabled: string[];
}

function emptyDocument(): PackageStateDocument {
  return { version: PACKAGE_STATE_VERSION, disabled: [] };
}

function sanitize(document: unknown): PackageStateDocument {
  if (!document || typeof document !== 'object' || Array.isArray(document)) return emptyDocument();
  const disabled = (document as { disabled?: unknown }).disabled;
  if (!Array.isArray(disabled)) return emptyDocument();
  const names = new Set<string>();
  for (const value of disabled) {
    if (typeof value !== 'string' || value.length === 0) continue;
    // A name is used as a directory segment by the manager: reject anything
    // that could never be addressed as a package, keep the rest.
    if (value === '.' || value === '..' || /[\\/]/.test(value)) continue;
    names.add(value);
  }
  return { version: PACKAGE_STATE_VERSION, disabled: [...names].sort() };
}

export class PackageStateStore {
  private readonly file: string;
  private cache?: PackageStateDocument;

  /** @param dir MAFW data root (`~/.mafw`); the state file lives directly in it. */
  constructor(dir: string) {
    this.file = path.join(dir, PACKAGE_STATE_FILE);
  }

  /** Path of the persisted document (diagnostics/tests). */
  get filePath(): string {
    return this.file;
  }

  /** Current document; malformed files degrade to `{ version: 1, disabled: [] }`. */
  read(): PackageStateDocument {
    if (this.cache) return { version: this.cache.version, disabled: [...this.cache.disabled] };
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
    } catch (err: any) {
      if (err?.code !== 'ENOENT') {
        log.warn(`[PackageState] ignoring unreadable ${this.file}: ${err?.message ?? String(err)}`);
      }
      this.cache = emptyDocument();
      return emptyDocument();
    }
    this.cache = sanitize(parsed);
    return { version: this.cache.version, disabled: [...this.cache.disabled] };
  }

  isDisabled(name: string): boolean {
    return this.read().disabled.includes(name);
  }

  /** Idempotent; persists atomically and only touches the file when it changes. */
  setDisabled(name: string, disabled: boolean): void {
    if (typeof name !== 'string' || name.length === 0) {
      throw new TypeError('package name must be a non-empty string');
    }
    const current = new Set(this.read().disabled);
    const has = current.has(name);
    if (disabled === has) return;
    if (disabled) current.add(name);
    else current.delete(name);
    this.write({ version: PACKAGE_STATE_VERSION, disabled: [...current].sort() });
  }

  private write(document: PackageStateDocument): void {
    const dir = path.dirname(this.file);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
      fs.renameSync(tmp, this.file);
      this.cache = document;
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }
  }
}
