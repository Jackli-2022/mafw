import * as fs from 'fs';
import * as path from 'path';

export type PluginType = 'runtime' | 'media' | 'usage' | 'ui';
export type PluginStatus = 'enabled' | 'disabled' | 'error' | 'config-disabled';

export interface PluginEntry {
  type: PluginType;
  name: string;
  file: string;
  status: PluginStatus;
  error?: string;
  size: number;
  mtime: string;
}

export interface HubDeps {
  dirs: Record<PluginType, string>;
  /** plugin name -> error message, from each loader's getState() (three gateway-side types only). */
  getErrors?: (type: PluginType) => Record<string, string>;
  /** usage plugins disabled via config usage.disabledPlugins (read-only compatibility). */
  configDisabledUsage?: () => Set<string>;
  /** called after a successful mutation so the caller triggers the type's reload. */
  reload?: (type: PluginType) => void | Promise<void>;
  maxBytes?: number;
}

export class HubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PLUGIN_TYPES: PluginType[] = ['runtime', 'media', 'usage', 'ui'];
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
// accepts both on-disk states: foo.js and foo.js.disabled
const FILENAME_RE = /^[A-Za-z0-9._-]+\.js(\.disabled)?$/;

export function parseType(value: unknown): PluginType {
  if (typeof value === 'string' && (PLUGIN_TYPES as string[]).includes(value)) return value as PluginType;
  throw new HubError(400, `invalid plugin type: ${String(value)}`);
}

function validateFilename(filename: string): string {
  if (typeof filename !== 'string' || !FILENAME_RE.test(filename)) {
    throw new HubError(400, `invalid filename: ${String(filename)}`);
  }
  return filename;
}

function resolveInDir(dir: string, filename: string): string {
  const resolved = path.resolve(dir, filename);
  if (resolved !== dir && !resolved.startsWith(path.resolve(dir) + path.sep)) {
    throw new HubError(400, `path traversal rejected: ${filename}`);
  }
  return resolved;
}

function baseName(file: string): string {
  return file.replace(/\.js(\.disabled)?$/, '');
}

function statEntry(type: PluginType, dir: string, file: string): PluginEntry {
  const full = path.join(dir, file);
  const st = fs.statSync(full);
  return {
    type,
    name: baseName(file),
    file,
    status: file.endsWith('.disabled') ? 'disabled' : 'enabled',
    size: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export function listPlugins(deps: HubDeps): PluginEntry[] {
  const entries: PluginEntry[] = [];
  for (const type of PLUGIN_TYPES) {
    const dir = deps.dirs[type];
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.js.disabled'));
    const byName = new Map<string, PluginEntry>();
    for (const file of files) {
      const entry = statEntry(type, dir, file);
      const existing = byName.get(entry.name);
      if (!existing) {
        byName.set(entry.name, entry);
      } else if (existing.status === 'enabled' && entry.status === 'disabled') {
        if (!existing.error) {
          existing.error = `both ${existing.file} and ${entry.file} present; ${entry.file} is shadowed`;
        }
      } else if (existing.status === 'disabled' && entry.status === 'enabled') {
        byName.set(entry.name, {
          ...entry,
          error: `both ${entry.file} and ${existing.file} present; ${existing.file} is shadowed`,
        });
      }
    }
    const errors = deps.getErrors?.(type) ?? {};
    const configDisabled = type === 'usage' ? deps.configDisabledUsage?.() ?? new Set<string>() : new Set<string>();
    for (const entry of byName.values()) {
      const loaderError = errors[entry.name];
      let status: PluginStatus = entry.status;
      let error = entry.error;
      if (loaderError) {
        status = 'error';
        error = loaderError;
      } else if (type === 'usage' && configDisabled.has(entry.name) && entry.status === 'enabled') {
        status = 'config-disabled';
      }
      entries.push({ ...entry, status, error });
    }
  }
  return entries;
}

function decodeContent(contentBase64: string, maxBytes: number): Buffer {
  if (typeof contentBase64 !== 'string' || contentBase64.length === 0) throw new HubError(400, 'empty content');
  const buf = Buffer.from(contentBase64, 'base64');
  if (buf.length === 0) throw new HubError(400, 'empty content');
  // round-trip check rejects non-base64 garbage
  if (buf.toString('base64') !== contentBase64) throw new HubError(400, 'content is not valid base64');
  if (buf.length > maxBytes) throw new HubError(413, `content exceeds ${maxBytes} bytes`);
  return buf;
}

export async function installPlugin(
  deps: HubDeps,
  input: { type: PluginType; filename: string; contentBase64: string; overwrite?: boolean },
): Promise<PluginEntry> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  if (!filename.endsWith('.js')) throw new HubError(400, `install filename must end with .js: ${filename}`);
  const dir = deps.dirs[type];
  fs.mkdirSync(dir, { recursive: true });
  const target = resolveInDir(dir, filename);
  const dup = path.join(dir, filename);
  const dupDisabled = path.join(dir, filename.replace(/\.js$/, '.js.disabled'));
  if (!input.overwrite && (fs.existsSync(dup) || fs.existsSync(dupDisabled))) {
    throw new HubError(409, `plugin already exists: ${filename}`);
  }
  const buf = decodeContent(input.contentBase64, deps.maxBytes ?? DEFAULT_MAX_BYTES);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, target);
  await deps.reload?.(type);
  return statEntry(type, dir, filename);
}

export async function setPluginEnabled(
  deps: HubDeps,
  input: { type: PluginType; filename: string; enabled: boolean },
): Promise<PluginEntry> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const dir = deps.dirs[type];
  const current = resolveInDir(dir, filename);
  if (!fs.existsSync(current)) throw new HubError(404, `plugin file not found: ${filename}`);
  const nextName = input.enabled ? filename.replace(/\.js\.disabled$/, '.js') : filename.replace(/\.js$/, '.js.disabled');
  const next = resolveInDir(dir, nextName);
  fs.renameSync(current, next);
  await deps.reload?.(type);
  return statEntry(type, dir, nextName);
}

export async function deletePlugin(
  deps: HubDeps,
  input: { type: PluginType; filename: string },
): Promise<{ ok: true }> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const target = resolveInDir(deps.dirs[type], filename);
  if (!fs.existsSync(target)) throw new HubError(404, `plugin file not found: ${filename}`);
  fs.unlinkSync(target);
  await deps.reload?.(type);
  return { ok: true };
}
