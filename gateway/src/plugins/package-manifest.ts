/**
 * Unified plugin package manifest v2.
 *
 * Parsing is pure: no filesystem access, no activation, no state. The manager,
 * host and doctor share this module so legacy (apiVersion 1) and trust-aware
 * (apiVersion 2) packages are normalized exactly once.
 */

export const SUPPORTED_PLUGIN_API_VERSIONS = [1, 2] as const;
export type PluginApiVersion = (typeof SUPPORTED_PLUGIN_API_VERSIONS)[number];
export type PluginKind = 'trusted' | 'untrusted';

export interface PluginIntegrity {
  algorithm: 'sha256';
  files: Record<string, string>;
}

export interface NormalizedPackageManifest {
  name: string;
  version?: string;
  main: string;
  apiVersion: PluginApiVersion;
  kind: PluginKind;
  permissions: string[];
  host?: string;
  integrity?: PluginIntegrity;
  deprecated?: string;
  legacy: boolean;
}

export interface PackageManifestParseResult {
  ok: boolean;
  manifest?: NormalizedPackageManifest;
  errors: string[];
  warnings: string[];
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const BASE_PERMISSIONS = new Set([
  'actions',
  'events',
  'config.read',
  'config.write',
  'terminal',
  'http',
  'tools',
  'observers',
  'ui.web',
]);
const SCOPED_PERMISSION_PREFIXES = ['files.read:', 'files.write:', 'net.fetch:'];
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;
const COMPARATOR = /^(>=|<=|>|<|=)?\s*(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/;

export function isKnownPermissionToken(token: string): boolean {
  if (BASE_PERMISSIONS.has(token)) return true;
  return SCOPED_PERMISSION_PREFIXES.some(
    (prefix) => token.startsWith(prefix) && token.length > prefix.length,
  );
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(value: string): ParsedVersion | null {
  const match = SEMVER.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareVersion(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

interface Comparator {
  operator: '>=' | '<=' | '>' | '<' | '=';
  version: ParsedVersion;
}

function parseHostRange(range: string): Comparator[] | null {
  const trimmed = range.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === '*') return [];
  const tokens = trimmed.split(/\s+/);
  const comparators: Comparator[] = [];
  for (const token of tokens) {
    const match = COMPARATOR.exec(token);
    if (!match) return null;
    const version = parseVersion(match[2]);
    if (!version) return null;
    comparators.push({ operator: (match[1] as Comparator['operator']) ?? '=', version });
  }
  return comparators;
}

function satisfies(version: ParsedVersion, comparators: Comparator[]): boolean {
  return comparators.every(({ operator, version: target }) => {
    const diff = compareVersion(version, target);
    switch (operator) {
      case '>=': return diff >= 0;
      case '<=': return diff <= 0;
      case '>': return diff > 0;
      case '<': return diff < 0;
      case '=': return diff === 0;
    }
  });
}

export function isHostRangeCompatible(range: string | undefined, hostVersion: string): boolean {
  if (range === undefined || range.trim() === '*' || range.trim() === '') return true;
  const comparatorList = parseHostRange(range);
  const host = parseVersion(hostVersion);
  if (!comparatorList || !host) return false;
  return satisfies(host, comparatorList);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeMain(main: string): boolean {
  if (main.length === 0 || main.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(main) || main.startsWith('/') || main.startsWith('\\')) return false;
  return !main.split(/[\\/]+/).includes('..');
}

function readPermissions(
  value: unknown,
  apiVersion: PluginApiVersion,
  errors: string[],
  warnings: string[],
): string[] {
  if (value === undefined) {
    if (apiVersion === 2) warnings.push('legacy-permissions');
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push('permissions must be an array of strings');
    return [];
  }
  const permissions: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      errors.push(`permissions[${index}] must be a non-empty string`);
      return;
    }
    if (!isKnownPermissionToken(item)) {
      errors.push(`unknown permission: ${item}`);
      return;
    }
    permissions.push(item);
  });
  return permissions;
}

function readIntegrity(value: unknown, errors: string[]): PluginIntegrity | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('integrity must be an object');
    return undefined;
  }
  if (value.algorithm !== 'sha256') {
    errors.push('integrity.algorithm must be "sha256"');
    return undefined;
  }
  if (!isPlainObject(value.files)) {
    errors.push('integrity.files must be an object');
    return undefined;
  }
  const files: Record<string, string> = {};
  for (const [path, hash] of Object.entries(value.files)) {
    if (typeof hash !== 'string' || hash.length === 0) {
      errors.push(`integrity.files["${path}"] must be a non-empty string`);
      continue;
    }
    files[path] = hash;
  }
  return { algorithm: 'sha256', files };
}

export function parsePackageManifest(raw: unknown): PackageManifestParseResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(raw)) {
    return { ok: false, errors: ['plugin.json must be an object'], warnings };
  }

  const name = typeof raw.name === 'string' ? raw.name : '';
  if (!name) {
    errors.push('name is required');
  } else if (!NAME_PATTERN.test(name) || /[. ]$/.test(name)) {
    errors.push(`invalid package name: ${name}`);
  }

  const version = raw.version === undefined ? undefined : raw.version;
  if (version !== undefined && (typeof version !== 'string' || version.length === 0)) {
    errors.push('version must be a non-empty string');
  }

  const main = raw.main === undefined ? 'index.js' : raw.main;
  if (typeof main !== 'string' || !isSafeMain(main)) {
    errors.push('main must be a relative path inside the package');
  }

  let apiVersion: PluginApiVersion = 1;
  if (raw.apiVersion !== undefined) {
    if (raw.apiVersion === 1 || raw.apiVersion === 2) {
      apiVersion = raw.apiVersion;
    } else if (typeof raw.apiVersion === 'number' && Number.isInteger(raw.apiVersion)) {
      errors.push(`unsupported apiVersion: ${raw.apiVersion}`);
    } else {
      errors.push(`invalid apiVersion: ${String(raw.apiVersion)}`);
    }
  }

  let kind: PluginKind = 'trusted';
  if (raw.kind !== undefined) {
    if (raw.kind === 'trusted' || raw.kind === 'untrusted') {
      kind = raw.kind;
    } else {
      errors.push(`invalid kind: ${String(raw.kind)}`);
    }
  }
  if (kind === 'untrusted' && apiVersion !== 2) {
    errors.push('untrusted requires apiVersion 2');
  }

  const permissions = readPermissions(raw.permissions, apiVersion, errors, warnings);

  let host: string | undefined;
  if (raw.host !== undefined) {
    if (typeof raw.host !== 'string') {
      errors.push('host must be a string');
    } else if (!parseHostRange(raw.host)) {
      errors.push(`invalid host range: ${raw.host}`);
    } else {
      host = raw.host;
    }
  }

  const integrity = readIntegrity(raw.integrity, errors);

  let deprecated: string | undefined;
  if (raw.deprecated !== undefined) {
    if (typeof raw.deprecated !== 'string' || raw.deprecated.length === 0) {
      errors.push('deprecated must be a non-empty string');
    } else {
      deprecated = raw.deprecated;
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    manifest: {
      name,
      ...(typeof version === 'string' ? { version } : {}),
      main: main as string,
      apiVersion,
      kind,
      permissions,
      ...(host !== undefined ? { host } : {}),
      ...(integrity !== undefined ? { integrity } : {}),
      ...(deprecated !== undefined ? { deprecated } : {}),
      legacy: apiVersion === 1,
    },
    errors,
    warnings,
  };
}
