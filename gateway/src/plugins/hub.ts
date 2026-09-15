import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { log } from '../core/utils/logger';

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
  builtin?: boolean;
  overridden?: boolean;
  pluginType?: string;
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
  /** builtin inventory entries in display order; hub stamps builtin/overridden/config-disabled. */
  builtinEntries?: () => PluginEntry[];
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
  const userEntries = collectUserEntries(deps);
  const builtins = (deps.builtinEntries?.() ?? []).map((e) => ({ ...e, builtin: true }));
  const userKeys = new Set(userEntries.map((e) => `${e.type}/${e.name}`));
  const configDisabled = deps.configDisabledUsage?.() ?? new Set<string>();
  for (const b of builtins) {
    if (userKeys.has(`${b.type}/${b.name}`)) b.overridden = true;
    if (b.type === 'usage' && configDisabled.has(b.name) && b.status === 'enabled') b.status = 'config-disabled';
  }
  return [...builtins, ...userEntries];
}

function collectUserEntries(deps: HubDeps): PluginEntry[] {
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

export function cleanupExamples(deps: HubDeps): { removed: string[]; failed: string[] } {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const dir of Object.values(deps.dirs)) {
    const target = path.join(dir, 'example.js.disabled');
    try {
      if (fs.existsSync(target)) { fs.unlinkSync(target); removed.push(target); }
    } catch { failed.push(target); }
  }
  return { removed, failed };
}

export interface InstallInput {
  type?: PluginType;
  filename: string;
  bytes: Buffer;
  overwrite?: boolean;
}

export async function installPlugin(
  deps: HubDeps,
  input: InstallInput,
): Promise<PluginEntry> {
  const filename = validateFilename(input.filename);
  if (!filename.endsWith('.js')) throw new HubError(400, `install filename must end with .js: ${filename}`);
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new HubError(400, 'empty content');
  if (input.bytes.length > maxBytes) throw new HubError(413, `content exceeds ${maxBytes} bytes`);
  const explicitType = input.type ? parseType(input.type) : undefined;
  const { matches, mod } = inspectPlugin(filename, input.bytes);
  validateName(mod, filename);
  let type: PluginType;
  if (matches.length === 0) throw new HubError(400, 'unrecognized plugin interface: export createRuntime / createPrompt / fetch / tools');
  if (explicitType) {
    if (!matches.includes(explicitType)) {
      const listing = matches.map((m) => `${m} (${MATCH_IFACE[m]})`).join('/');
      throw new HubError(400, `plugin interface mismatch: selected ${explicitType}, exports ${listing}`);
    }
    type = explicitType;
  } else {
    if (matches.length > 1) throw new HubError(400, `ambiguous plugin interface: ${matches.join('/')}`);
    type = matches[0];
  }
  const dir = deps.dirs[type];
  fs.mkdirSync(dir, { recursive: true });
  const target = resolveInDir(dir, filename);
  const dup = path.join(dir, filename);
  const dupDisabled = path.join(dir, filename.replace(/\.js$/, '.js.disabled'));
  if (!input.overwrite && (fs.existsSync(dup) || fs.existsSync(dupDisabled))) {
    throw new HubError(409, `plugin already exists: ${filename}`);
  }
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, input.bytes);
  fs.renameSync(tmp, target);
  await deps.reload?.(type);
  return statEntry(type, dir, filename);
}

const MATCH_IFACE: Record<PluginType, string> = {
  runtime: 'createRuntime',
  media: 'createPrompt',
  usage: 'fetch',
  ui: 'tools',
};

function computeMatches(mod: Record<string, unknown> | undefined): PluginType[] {
  const matches: PluginType[] = [];
  if (typeof mod?.createRuntime === 'function') matches.push('runtime');
  if (typeof mod?.createPrompt === 'function' || typeof mod?.fixPayload === 'function'
      || typeof mod?.engine === 'string' || Array.isArray(mod?.modalities)) matches.push('media');
  if (typeof mod?.fetch === 'function'
      && (mod.type === undefined || mod.type === 'api' || mod.type === 'token-plan' || mod.type === 'local')) matches.push('usage');
  if (mod?.tools && typeof mod.tools === 'object' && Object.keys(mod.tools as object).length > 0) matches.push('ui');
  return matches;
}

function inspectPlugin(filename: string, bytes: Buffer): { matches: PluginType[]; mod: Record<string, unknown> } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hub-sniff-'));
  const tmpFile = path.join(tmpDir, filename);
  try {
    fs.writeFileSync(tmpFile, bytes);
    try { delete require.cache[require.resolve(tmpFile)]; } catch { /* first load */ }
    let mod: Record<string, unknown>;
    try {
      mod = require(tmpFile) as Record<string, unknown>;
    } catch (err: any) {
      throw new HubError(400, `plugin failed to load: ${err.message}`);
    }
    return { matches: computeMatches(mod), mod };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function validateName(mod: Record<string, unknown> | undefined, filename: string): void {
  const name = mod?.name;
  if (typeof name !== 'string' || name.length === 0) throw new HubError(400, 'missing plugin name');
  const stem = baseName(filename);
  if (name !== stem) {
    throw new HubError(400, `plugin name mismatch: exports '${name}', filename '${filename}' (must match)`);
  }
}

export async function setPluginEnabled(
  deps: HubDeps,
  input: { type: PluginType; filename: string; enabled: boolean },
): Promise<PluginEntry> {
  const type = parseType(input.type);
  const filename = validateFilename(input.filename);
  const dir = deps.dirs[type];
  // Accept either on-disk state: a stale client snapshot (double-toggled
  // switch, unrefreshed list) sends the opposite-state filename, which must
  // resolve idempotently instead of 404ing ("激活 not found").
  const primary = resolveInDir(dir, filename);
  const variant = /\.js\.disabled$/.test(filename)
    ? filename.replace(/\.js\.disabled$/, '.js')
    : filename.replace(/\.js$/, '.js.disabled');
  const variantPath = resolveInDir(dir, variant);
  const current = fs.existsSync(primary) ? primary : fs.existsSync(variantPath) ? variantPath : null;
  if (!current) throw new HubError(404, `plugin file not found: ${filename}`);
  const currentName = path.basename(current);
  const nextName = input.enabled
    ? currentName.replace(/\.js\.disabled$/, '.js')
    : currentName.replace(/\.js$/, '.js.disabled');
  const next = resolveInDir(dir, nextName);
  if (next !== current) fs.renameSync(current, next);
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
