/**
 * Filesystem half of plugin Web surfaces.
 *
 * The declarative half (ids, entry syntax, icon whitelist) lives in
 * `@mafw/plugin-contract`, which is deliberately filesystem-free. This module
 * owns the path-level checks: a declared entry must resolve to a regular file
 * below the package's own `web/` directory, after resolving links, so a symlink
 * or junction cannot smuggle a file in from outside. A package whose entry is
 * missing fails activation as a whole (fail-closed) instead of publishing a
 * surface that would 404 when opened.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PluginWebSurfaceDescriptor } from '@mafw/plugin-contract';

/** Entry used when a surface omits `entry` (mirrors the contract default). */
export const DEFAULT_WEB_SURFACE_ENTRY = 'index.html';

/**
 * MIME whitelist for served assets. Anything else is a 404 at the route layer:
 * an unknown extension must not be served as `text/plain` (a `.bin`/source dump
 * would then render as text inside the sandboxed surface).
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function realpathOrNull(value: string): string | null {
  try {
    return fs.realpathSync(value);
  } catch {
    return null;
  }
}

/** `candidate` is a realpath strictly below the realpath-ed root directory. */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return false;
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return candidate.startsWith(prefix);
}

/**
 * Splits a declared entry into segments that are safe to join.
 *
 * Returns `null` for anything that could leave `web/` or name a hidden file:
 * absolute/drive paths, empty segments, `.`/`..` and dotfiles. The contract
 * already normalizes entries, so this is the defense-in-depth half for direct
 * callers (asset serving, tests).
 */
function safeEntrySegments(entry: string): string[] | null {
  if (entry.length === 0) return null;
  if (entry.includes('\0') || entry.includes('#') || entry.includes('?') || entry.includes(':')) {
    return null;
  }
  if (entry.startsWith('/') || entry.startsWith('\\') || path.win32.isAbsolute(entry)) return null;
  const segments = entry.split(/[\\/]/);
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.startsWith('.')) return null;
  }
  return segments;
}

/**
 * Resolves `entry` to the absolute real path of a regular file under
 * `<packageDir>/web`, or `null` when it is missing, escapes the directory,
 * names a dotfile or is not a regular file.
 */
export function resolvePluginWebEntry(packageDir: string, entry: string): string | null {
  try {
    if (!packageDir) return null;
    const segments = safeEntrySegments(entry);
    if (!segments) return null;

    const root = realpathOrNull(path.resolve(packageDir, 'web'));
    if (!root) return null;
    const resolved = realpathOrNull(path.resolve(root, ...segments));
    if (!resolved || !isInside(root, resolved)) return null;
    if (!fs.statSync(resolved).isFile()) return null;
    return resolved;
  } catch {
    return null;
  }
}

/**
 * Validates every declared surface entry against the package's `web/` tree.
 *
 * @returns Human-readable errors naming the surface id and entry; an empty
 *   array means every entry resolves.
 */
export function validatePluginWebSurfaces(
  packageDir: string,
  surfaces: readonly PluginWebSurfaceDescriptor[],
): string[] {
  const errors: string[] = [];
  for (const surface of surfaces) {
    const entry = surface.entry ?? DEFAULT_WEB_SURFACE_ENTRY;
    if (resolvePluginWebEntry(packageDir, entry)) continue;
    errors.push(
      `web surface "${surface.id}" entry "${entry}" does not resolve to a readable file under ` +
        path.join(packageDir, 'web'),
    );
  }
  return errors;
}

/**
 * `Content-Type` for a served asset, or `null` when the extension is not on the
 * whitelist (the asset route answers 404 in that case).
 */
export function pluginWebAssetContentType(filePath: string): string | null {
  const clean = filePath.replace(/[?#].*$/, '');
  const extension = path.extname(clean).toLowerCase();
  return CONTENT_TYPES[extension] ?? null;
}
