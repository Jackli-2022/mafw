/**
 * Unified plugin package manifest v2.
 *
 * Parsing is pure: no filesystem access, no activation, no state. The manager,
 * host and doctor share this module so legacy (apiVersion 1) and trust-aware
 * (apiVersion 2) packages are normalized exactly once.
 */

import {
  validatePluginManifestContributes,
  type PluginManifestContributes,
} from '@mafw/plugin-contract';

export const SUPPORTED_PLUGIN_API_VERSIONS = [1, 2] as const;
export type PluginApiVersion = (typeof SUPPORTED_PLUGIN_API_VERSIONS)[number];
export type PluginKind = 'trusted' | 'untrusted';

/**
 * Legacy singleton contribution planes (`contributes.gateway.<plane>`).
 *
 * An untrusted worker only supports actions/events, so it can never honour one
 * of these declarations: they are refused at manifest time, not at activation.
 * Exported so the host's legacy assembly binds against the same list.
 */
export const LEGACY_GATEWAY_PLANES = ['runtime', 'media', 'tts', 'usage'] as const;

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
  /** Static plane declarations from `plugin.json`; absent when not declared. */
  contributes?: PluginManifestContributes;
  host?: string;
  integrity?: PluginIntegrity;
  deprecated?: string;
  /** Manifest standard the package was written against; absent for legacy. */
  standardVersion?: number;
  legacy: boolean;
}

export interface PackageManifestParseResult {
  ok: boolean;
  manifest?: NormalizedPackageManifest;
  errors: string[];
  warnings: string[];
}

/**
 * The package-name rule as **one** source string, shared verbatim with the
 * published JSON Schema (`manifest-schema.ts`) so the two can never drift.
 *
 * Reads as: start with a letter or digit, then any of `.`, `_`, `-`, letters
 * and digits, and never end with `.` or ` `. The trailing rule is folded into
 * the last character class (instead of a second `/[. ]$/` test) so a JSON
 * Schema `pattern` can express the whole rule with this exact string.
 */
export const PACKAGE_NAME_PATTERN_SOURCE =
  '^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$';
const NAME_PATTERN = new RegExp(PACKAGE_NAME_PATTERN_SOURCE);

/**
 * Tokens a manifest may declare verbatim. Exported because the published JSON
 * Schema builds its `permissions` pattern from this list: a token added here is
 * accepted by the schema in the same commit, never one release later.
 */
export const BASE_PERMISSION_TOKENS = [
  'actions',
  'events',
  'config.read',
  'config.write',
  'terminal',
  'http',
  'tools',
  'observers',
  'ui.web',
] as const;
const BASE_PERMISSIONS = new Set<string>(BASE_PERMISSION_TOKENS);

/** Prefixes whose remainder is package-defined (`files.read:<path>`). */
export const SCOPED_PERMISSION_PREFIXES = ['files.read:', 'files.write:', 'net.fetch:'] as const;
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
  } else if (!NAME_PATTERN.test(name)) {
    // `PACKAGE_NAME_PATTERN_SOURCE` already rejects a trailing "." or " ".
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

  // `contributes` declares plane ownership statically. An invalid block is
  // fatal at apiVersion 2 (its whole purpose is to bound registration) but only
  // a warning for legacy packages, which must keep activating.
  let contributes: PluginManifestContributes | undefined;
  if (raw.contributes !== undefined) {
    const validated = validatePluginManifestContributes(raw.contributes);
    if (validated.ok) contributes = validated.value;
    else if (apiVersion === 1) warnings.push(`legacy-contributes: ${validated.error}`);
    else errors.push(`contributes: ${validated.error}`);
  }

  // A legacy plane declaration is checked after normalization, so the error
  // names the plane the author actually wrote. Untrusted workers only support
  // actions/events; declaring one of these is unfixable at activation, so it
  // fails the manifest instead of surfacing later as a missing registration.
  if (kind === 'untrusted' && contributes?.gateway !== undefined) {
    for (const plane of LEGACY_GATEWAY_PLANES) {
      if (contributes.gateway[plane] !== undefined) {
        errors.push(`untrusted packages cannot declare contributes.gateway.${plane}`);
      }
    }
  }

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

  // The manifest standard the package was authored against. Optional and
  // deliberately the only structural rule: forward compatibility is expressed
  // by refusing a bogus value, never by refusing an unknown future version.
  let standardVersion: number | undefined;
  if (raw.standardVersion !== undefined) {
    if (
      typeof raw.standardVersion !== 'number'
      || !Number.isInteger(raw.standardVersion)
      || raw.standardVersion < 1
    ) {
      errors.push('standardVersion must be a positive integer');
    } else {
      standardVersion = raw.standardVersion;
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
      ...(contributes !== undefined ? { contributes } : {}),
      ...(host !== undefined ? { host } : {}),
      ...(integrity !== undefined ? { integrity } : {}),
      ...(deprecated !== undefined ? { deprecated } : {}),
      ...(standardVersion !== undefined ? { standardVersion } : {}),
      legacy: apiVersion === 1,
    },
    errors,
    warnings,
  };
}
