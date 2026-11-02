/**
 * Content fingerprint for a plugin package.
 *
 * The fingerprint decides whether a package has to be activated again: an
 * unchanged fingerprint means the host keeps the existing instance, its
 * RegistrationBag, its timers and its revision untouched. It therefore covers
 * the manifest plus every source/declaration file of the package and nothing
 * else — no `node_modules`, no `.git`, no manager scratch space and no
 * logs/temp artefacts, since those change for reasons that must not reload a
 * plugin.
 *
 * Layouts:
 * - directory package: `plugin.json` (manifest) + the whole package subtree
 * - single-file package: the entry file only (siblings are other packages)
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Directory names that never contribute to a fingerprint. */
export const FINGERPRINT_IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  '.plugin-manager',
  'logs',
]);

/** File names that are logs, editor scratch space or OS metadata. */
const IGNORED_FILE_PATTERNS: readonly RegExp[] = [
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

const MANIFEST_NAME = 'plugin.json';
const SALT = 'mafw-plugin-fingerprint-v1';

export interface FingerprintOptions {
  /**
   * Package root for directory packages. The host already knows it from
   * `plugin.json`; passing it avoids any heuristic when `main` points at a
   * nested file. Omit it for single-file packages.
   */
  rootDir?: string;
}

function isIgnoredFileName(name: string): boolean {
  return IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Finds the closest ancestor whose `plugin.json` actually points at this entry
 * file. Requiring the `main` to resolve prevents a stray manifest in a shared
 * parent directory from turning a single-file package into a whole-tree hash.
 */
function findManifestRoot(mainFile: string): string | null {
  let dir = path.dirname(mainFile);
  for (let depth = 0; depth < 4; depth += 1) {
    const manifestPath = path.join(dir, MANIFEST_NAME);
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { main?: unknown };
        const declared = typeof manifest?.main === 'string' ? manifest.main : 'index.js';
        if (path.resolve(dir, declared) === mainFile) return dir;
      } catch {
        // Unreadable manifest: the host reports the real error while scanning.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

interface CollectedFile {
  /** Path relative to the package root, POSIX separators for cross-platform determinism. */
  relPath: string;
  absolute: string;
  /** Symlinks are hashed by target instead of content to avoid escaping the package. */
  linkTarget?: string;
}

function collectFiles(root: string, out: CollectedFile[], prefix = ''): void {
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
      if (FINGERPRINT_IGNORED_DIRS.has(entry.name)) continue;
      collectFiles(root, out, relPath);
      continue;
    }
    if (isIgnoredFileName(entry.name)) continue;
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
    if (!entry.isFile()) continue;
    out.push({ relPath, absolute });
  }
}

function hashFile(hash: ReturnType<typeof createHash>, file: CollectedFile): void {
  hash.update(file.relPath);
  hash.update('\0');
  if (file.linkTarget !== undefined) {
    hash.update(`link:${file.linkTarget}`);
    hash.update('\0');
    return;
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file.absolute);
  } catch (err: any) {
    hash.update(`unreadable:${err?.code ?? 'error'}`);
    hash.update('\0');
    return;
  }
  hash.update(String(bytes.length));
  hash.update('\0');
  hash.update(bytes);
  hash.update('\0');
}

/**
 * Computes the content fingerprint of a package entry file.
 *
 * @throws when the entry file does not exist — the host records that as a
 *   package error instead of guessing a fingerprint.
 */
export function fingerprintPackage(mainFile: string, options: FingerprintOptions = {}): string {
  const main = path.resolve(mainFile);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(main);
  } catch {
    throw new Error(`package main file not found: ${mainFile}`);
  }
  if (!stat.isFile()) throw new Error(`package main file not found: ${mainFile}`);

  const hash = createHash('sha256');
  hash.update(`${SALT}\0`);

  const explicitRoot = options.rootDir ? path.resolve(options.rootDir) : null;
  const root = explicitRoot ?? findManifestRoot(main);

  if (!root) {
    // Single-file package: only its own content is part of the fingerprint.
    hashFile(hash, { relPath: path.basename(main), absolute: main });
    return hash.digest('hex');
  }

  const files: CollectedFile[] = [];
  collectFiles(root, files);
  if (!files.some((file) => path.resolve(file.absolute) === main)) {
    files.push({ relPath: path.basename(main), absolute: main });
    files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  }
  for (const file of files) hashFile(hash, file);
  return hash.digest('hex');
}
