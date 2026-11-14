/**
 * Disk last-known-good snapshots for unified plugin packages.
 *
 * One previous healthy version is retained under `<pluginRoot>/.last-good/`.
 * The snapshot is taken before an overwrite install and promoted after the
 * health window passes; it never contains package config or user data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

export const LAST_GOOD_DIR = '.last-good';

export interface LastGoodMeta {
  version?: string;
  fingerprint: string;
  savedAt: string;
}

const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

function isSafeName(name: string): boolean {
  return typeof name === 'string'
    && name.length > 0
    && name !== '.'
    && name !== '..'
    && !/[\\/]/.test(name);
}

function directorySize(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += directorySize(absolute);
      else if (entry.isFile()) total += fs.statSync(absolute).size;
    } catch {
      // A file that vanished mid-walk contributes nothing.
    }
  }
  return total;
}

export class PackageLastGoodStore {
  private readonly root: string;
  private readonly maxBytes: number;

  constructor(pluginDir: string, opts: { maxBytes?: number } = {}) {
    this.root = path.resolve(pluginDir);
    this.maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  private snapshotDir(name: string): string {
    return path.join(this.root, LAST_GOOD_DIR, name);
  }

  private metaFile(name: string): string {
    return path.join(this.root, LAST_GOOD_DIR, `${name}.json`);
  }

  read(name: string): LastGoodMeta | null {
    if (!isSafeName(name)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.metaFile(name), 'utf-8')) as LastGoodMeta;
      if (typeof parsed?.fingerprint !== 'string') return null;
      return {
        ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
        fingerprint: parsed.fingerprint,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
      };
    } catch {
      return null;
    }
  }

  snapshot(name: string, meta: Omit<LastGoodMeta, 'savedAt'>): boolean {
    if (!isSafeName(name)) return false;
    const current = path.join(this.root, name);
    if (!fs.existsSync(current)) return false;
    try {
      if (fs.statSync(current).isDirectory() && directorySize(current) > this.maxBytes) {
        return false;
      }
    } catch {
      return false;
    }

    const target = this.snapshotDir(name);
    const temp = path.join(this.root, LAST_GOOD_DIR, `.tmp-${randomBytes(6).toString('hex')}`);
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(current, temp, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(temp, target);
      const document: LastGoodMeta = { ...meta, savedAt: new Date().toISOString() };
      const metaTemp = `${this.metaFile(name)}.${randomBytes(6).toString('hex')}.tmp`;
      fs.writeFileSync(metaTemp, `${JSON.stringify(document, null, 2)}\n`, 'utf-8');
      fs.renameSync(metaTemp, this.metaFile(name));
      return true;
    } catch {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
      return false;
    }
  }

  restore(name: string): boolean {
    if (!isSafeName(name)) return false;
    const snapshot = this.snapshotDir(name);
    if (!fs.existsSync(snapshot)) return false;
    const current = path.join(this.root, name);
    const temp = path.join(this.root, `.restore-${randomBytes(6).toString('hex')}`);
    try {
      fs.cpSync(snapshot, temp, { recursive: true, force: true });
      fs.rmSync(current, { recursive: true, force: true });
      fs.renameSync(temp, current);
      return true;
    } catch {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* best effort */ }
      return false;
    }
  }

  remove(name: string): void {
    if (!isSafeName(name)) return;
    try { fs.rmSync(this.snapshotDir(name), { recursive: true, force: true }); } catch { /* best effort */ }
    try { fs.rmSync(this.metaFile(name), { force: true }); } catch { /* best effort */ }
  }
}
