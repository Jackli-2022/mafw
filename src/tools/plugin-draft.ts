/**
 * Project-local Creator drafts (`<project>/.mafw/plugin-drafts/<draft>/`).
 *
 * The filesystem is the draft store: no draft id, no gateway kv entry and no
 * session binding. Two rules keep the model from reaching outside the project:
 *
 * - a draft is one plain directory name (no separators, no absolute paths, no
 *   `..`), resolved under the fixed root and re-checked through realpath so a
 *   symlink cannot smuggle another tree in;
 * - the manifest's `name` must equal that directory name, so the approval
 *   prompt and the installation payload always describe the same package.
 *
 * `fingerprintDraft` is the change detector used around approval: content is
 * hashed over sorted relative paths, so edits made while the user is deciding
 * are visible as a different value.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** Root directory of all project drafts (relative to the session project). */
export const DRAFT_ROOT_SEGMENT = path.join('.mafw', 'plugin-drafts');

/** A draft directory is a single safe path segment (`.logs` is excluded too). */
const DRAFT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Fingerprint ceilings: reject pathological drafts instead of stalling. */
export const DRAFT_MAX_FILES = 5000;
export const DRAFT_MAX_BYTES = 50 * 1024 * 1024;

/** Directories that are host caches, never draft source. */
const IGNORED_DIRS = new Set(['.git', 'node_modules']);

/** Editor/OS scratch files that must not perturb the fingerprint. */
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export interface DraftFingerprintLimits {
  maxFiles?: number;
  maxBytes?: number;
}

export interface DraftManifest {
  name: string;
  version?: string;
  main?: string;
}

export function draftRoot(projectDir: string): string {
  return path.resolve(projectDir, DRAFT_ROOT_SEGMENT);
}

function normalizeForCompare(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

/** True when `target` is a proper descendant of `root` (both absolute). */
function isContained(root: string, target: string): boolean {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(target));
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isTempFile(name: string): boolean {
  return name.endsWith('.tmp') || name.endsWith('.swp') || name.endsWith('.swo') || name.endsWith('~');
}

/**
 * Resolves one draft directory to its real path.
 *
 * Throws `invalid draft` for anything that could name another directory
 * (separators, absolute paths, `..`, bad characters, symlink escapes) and
 * `draft not found` when the directory does not exist yet.
 */
export function resolveDraftDirectory(projectDir: string, draft: string): string {
  if (typeof projectDir !== 'string' || projectDir.trim().length === 0) {
    throw new Error('session directory unavailable: cannot resolve the project draft root');
  }
  if (typeof draft !== 'string' || !DRAFT_NAME.test(draft)) {
    throw new Error('invalid draft: expected one directory name under .mafw/plugin-drafts');
  }

  const root = draftRoot(projectDir);
  const candidate = path.resolve(root, draft);
  if (!isContained(root, candidate)) {
    throw new Error('invalid draft: expected one directory name under .mafw/plugin-drafts');
  }

  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    throw new Error(`draft not found: ${draft} (expected under ${root})`);
  }
  try {
    realCandidate = fs.realpathSync(candidate);
  } catch {
    throw new Error(`draft not found: ${draft} (expected under ${root})`);
  }
  // A symlink (junction on Windows) resolves to its target: the draft must
  // still be inside the project's own draft root.
  if (!isContained(realRoot, realCandidate)) {
    throw new Error('invalid draft: resolves outside .mafw/plugin-drafts');
  }
  if (!fs.statSync(realCandidate).isDirectory()) {
    throw new Error(`draft is not a directory: ${draft}`);
  }
  return realCandidate;
}

/** Reads `plugin.json` and enforces the directory-name equality rule. */
export function readDraftManifest(directory: string, draft: string): DraftManifest {
  const manifestPath = path.join(directory, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`plugin.json not found in draft "${draft}"`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch (err: any) {
    throw new Error(`invalid plugin.json in draft "${draft}": ${err?.message ?? String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid plugin.json in draft "${draft}": expected an object`);
  }

  const record = parsed as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== 'string' || !DRAFT_NAME.test(name)) {
    throw new Error(`invalid plugin.json in draft "${draft}": "name" must be one safe directory name`);
  }
  if (name !== draft) {
    throw new Error('plugin.json name must equal draft directory');
  }
  if (record.main !== undefined && (typeof record.main !== 'string' || record.main.length === 0)) {
    throw new Error(`invalid plugin.json in draft "${draft}": "main" must be a non-empty string`);
  }

  return {
    name,
    ...(typeof record.version === 'string' ? { version: record.version } : {}),
    ...(typeof record.main === 'string' ? { main: record.main } : {}),
  };
}

interface DraftFile {
  /** Path relative to the draft directory, `/`-separated and sorted. */
  rel: string;
  abs: string;
  size: number;
}

function collectDraftFiles(
  root: string,
  directory: string,
  out: DraftFile[],
  limits: { maxFiles: number; maxBytes: number },
  totals: { bytes: number },
): void {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  for (const entry of entries) {
    const abs = path.join(directory, entry.name);
    const rel = path.relative(root, abs).split(path.sep).join('/');

    if (entry.isSymbolicLink()) {
      // A draft is generated source; symlinks are unsupported so no read can
      // silently follow a link out of the draft (or around a cycle).
      throw new Error(`draft contains an unsupported symlink: ${rel}`);
    }
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      collectDraftFiles(root, abs, out, limits, totals);
      continue;
    }
    if (!entry.isFile()) continue; // sockets/fifos are not draft source
    if (IGNORED_FILES.has(entry.name) || isTempFile(entry.name)) continue;

    const size = fs.statSync(abs).size;
    totals.bytes += size;
    if (totals.bytes > limits.maxBytes) {
      throw new Error(`draft is too large to fingerprint (> ${limits.maxBytes} bytes)`);
    }
    out.push({ rel, abs, size });
    if (out.length > limits.maxFiles) {
      throw new Error(`draft has too many files to fingerprint (> ${limits.maxFiles})`);
    }
  }
}

/**
 * SHA-256 over sorted relative paths + contents, excluding host caches.
 *
 * The value is stable across machines and creation order; only draft content
 * (paths, sizes, bytes) contributes.
 */
export async function fingerprintDraft(
  directory: string,
  limits: DraftFingerprintLimits = {},
): Promise<string> {
  const maxFiles = limits.maxFiles ?? DRAFT_MAX_FILES;
  const maxBytes = limits.maxBytes ?? DRAFT_MAX_BYTES;
  const root = fs.realpathSync(directory);

  const files: DraftFile[] = [];
  collectDraftFiles(root, root, files, { maxFiles, maxBytes }, { bytes: 0 });

  const hash = createHash('sha256');
  for (const file of files) {
    // NUL separators plus the declared size keep the digest unambiguous even
    // for files whose bytes contain the separator.
    hash.update(`${file.rel}\u0000${file.size}\u0000`);
    hash.update(fs.readFileSync(file.abs));
    hash.update('\u0000');
  }
  return hash.digest('hex');
}
