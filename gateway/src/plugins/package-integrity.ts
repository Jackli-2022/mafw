/**
 * Package integrity snapshots.
 *
 * The fingerprint answers "should this package be re-activated?"; the file map
 * answers "did the bytes change under us?". Both use the same file collection
 * and ignore rules so a harmless log/temp file can never trigger quarantine.
 */
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { fingerprintPackage, packageFileHashes } from './package-fingerprint';

export interface PackageIntegritySnapshot {
  fingerprint: string;
  files: Record<string, string>;
}

interface CollectedFile {
  relPath: string;
  absolute: string;
  linkTarget?: string;
}

const IGNORED_DIRS = new Set(['node_modules', '.git', '.plugin-manager', 'logs']);
const IGNORED_FILE_PATTERNS = [
  /\.log$/i,
  /\.log\.\d+$/i,
  /\.tmp$/i,
  /\.temp$/i,
  /\.swp$/i,
  /\.swx$/i,
  /~$/,
  /^\.DS_Store$/i,
  /^Thumbs\.db$/i,
];

function isIgnoredFile(name: string): boolean {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

function collect(root: string, out: CollectedFile[], prefix = ''): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(path.join(root, prefix), { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collect(root, out, relPath);
      continue;
    }
    if (isIgnoredFile(entry.name)) continue;
    const absolute = path.join(root, relPath);
    if (entry.isSymbolicLink()) {
      let linkTarget = '';
      try {
        linkTarget = fs.readlinkSync(absolute);
      } catch {
        linkTarget = '!unreadable-link';
      }
      out.push({ relPath, absolute, linkTarget });
      continue;
    }
    if (entry.isFile()) out.push({ relPath, absolute });
  }
}

function hashContent(file: CollectedFile): string {
  const hash = createHash('sha256');
  if (file.linkTarget !== undefined) {
    hash.update(`link:${file.linkTarget}`);
    return `sha256-${hash.digest('hex')}`;
  }
  try {
    hash.update(fs.readFileSync(file.absolute));
  } catch (err: any) {
    hash.update(`unreadable:${err?.code ?? 'error'}`);
  }
  return `sha256-${hash.digest('hex')}`;
}

export function computePackageIntegrity(
  pkgDir: string,
  mainFile: string,
): PackageIntegritySnapshot {
  return {
    fingerprint: fingerprintPackage(mainFile, { rootDir: pkgDir }),
    files: packageFileHashes(mainFile, { rootDir: pkgDir }),
  };
}

export function verifyDeclaredIntegrity(
  pkgDir: string,
  integrity: { algorithm: 'sha256'; files: Record<string, string> },
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  let stat: fs.Stats;
  try {
    stat = fs.statSync(pkgDir);
  } catch {
    return { ok: false, errors: [`package directory not found: ${pkgDir}`] };
  }

  const actual: Record<string, string> = {};
  if (stat.isFile()) {
    const file = { relPath: path.basename(pkgDir), absolute: pkgDir };
    actual[file.relPath] = hashContent(file);
  } else {
    const files: CollectedFile[] = [];
    collect(pkgDir, files);
    for (const file of files) actual[file.relPath] = hashContent(file);
  }

  for (const [file, declared] of Object.entries(integrity.files)) {
    const hash = actual[file];
    if (hash === undefined) errors.push(`missing: ${file}`);
    else if (hash !== declared) errors.push(`mismatch: ${file}`);
  }
  for (const file of Object.keys(actual)) {
    if (!(file in integrity.files)) errors.push(`unexpected: ${file}`);
  }

  return { ok: errors.length === 0, errors };
}

export function integrityMatches(
  snapshot: PackageIntegritySnapshot,
  installed: { fingerprint: string; files: Record<string, string> },
): boolean {
  if (snapshot.fingerprint !== installed.fingerprint) return false;
  const actual = Object.entries(snapshot.files);
  if (actual.length !== Object.keys(installed.files).length) return false;
  return actual.every(([file, hash]) => installed.files[file] === hash);
}
