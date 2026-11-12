/**
 * Kernel-v2 provider manifest: pure shape validation only.
 *
 * This module deliberately has no registration, activation or filesystem
 * access. It is the contract freeze for Phase 0; the loader and capability
 * registry consume the validated value later.
 */

export type CapabilityPlane = 'gateway' | 'desktop-ui' | 'desktop-web' | 'desktop-main';
export type ProviderKind = 'core' | 'trusted' | 'untrusted';
export type ProviderActivation = 'startup' | 'lazy' | 'on-demand';

export interface CapabilityProviderRef {
  capability: string;
  version: number;
}

export interface CapabilityIntegrity {
  algorithm: 'sha256';
  files: Record<string, string>;
}

export interface CapabilityManifest {
  id: string;
  version: string;
  apiVersion: number;
  kind: ProviderKind;
  provides: CapabilityProviderRef[];
  requires?: string[];
  wants?: string[];
  activation: ProviderActivation;
  permissions?: string[];
  configSchema?: unknown;
  integrity?: CapabilityIntegrity;
  planes: CapabilityPlane[];
}

export interface ManifestValidationOptions {
  /** Only these ids may claim kind="core". */
  firstPartyAllowlist?: ReadonlySet<string>;
}

export type ManifestValidation =
  | { ok: true; value: CapabilityManifest }
  | { ok: false; errors: string[] };

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KINDS = new Set<ProviderKind>(['core', 'trusted', 'untrusted']);
const ACTIVATIONS = new Set<ProviderActivation>(['startup', 'lazy', 'on-demand']);
const PLANES = new Set<CapabilityPlane>(['gateway', 'desktop-ui', 'desktop-web', 'desktop-main']);
const KNOWN_KEYS = new Set([
  'id',
  'version',
  'apiVersion',
  'kind',
  'provides',
  'requires',
  'wants',
  'activation',
  'permissions',
  'configSchema',
  'integrity',
  'planes',
]);

type PlainObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is PlainObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireString(
  value: unknown,
  label: string,
  maxLength: number,
  errors: string[],
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${label} is required`);
    return undefined;
  }
  if (value.length > maxLength) {
    errors.push(`${label} must be at most ${maxLength} characters`);
    return undefined;
  }
  return value;
}

function readStringArray(value: unknown, label: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array of strings`);
    return undefined;
  }
  const out: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== 'string' || item.length === 0) {
      errors.push(`${label}[${index}] must be a non-empty string`);
      return;
    }
    out.push(item);
  });
  return out;
}

function readProvides(value: unknown, errors: string[]): CapabilityProviderRef[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('provides must be a non-empty array');
    return [];
  }
  const seen = new Set<string>();
  const out: CapabilityProviderRef[] = [];
  value.forEach((item, index) => {
    if (!isPlainObject(item)) {
      errors.push(`provides[${index}] must be an object`);
      return;
    }
    const capability = requireString(item.capability, `provides[${index}].capability`, 64, errors);
    if (capability !== undefined && !ID_PATTERN.test(capability)) {
      errors.push(`provides[${index}].capability "${capability}" has an invalid id`);
      return;
    }
    if (capability !== undefined) {
      if (!Number.isInteger(item.version) || (item.version as number) < 1) {
        errors.push(`provides[${index}].version must be a positive integer`);
        return;
      }
      if (seen.has(capability)) {
        errors.push(`duplicate provides capability: ${capability}`);
        return;
      }
      seen.add(capability);
      out.push({ capability, version: item.version as number });
    }
  });
  return out;
}

function readIntegrity(value: unknown, errors: string[]): CapabilityIntegrity | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) {
    errors.push('integrity must be an object');
    return undefined;
  }
  if (value.algorithm !== 'sha256') {
    errors.push('integrity.algorithm must be sha256');
  }
  if (!isPlainObject(value.files)) {
    errors.push('integrity.files must be an object');
    return undefined;
  }
  const files: Record<string, string> = {};
  for (const [file, digest] of Object.entries(value.files)) {
    if (typeof digest !== 'string' || digest.length === 0) {
      errors.push(`integrity.files["${file}"] must be a non-empty string`);
      continue;
    }
    files[file] = digest;
  }
  return { algorithm: 'sha256', files };
}

function readPlanes(value: unknown, errors: string[]): CapabilityPlane[] {
  if (value === undefined) return ['gateway'];
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('planes must be a non-empty array');
    return ['gateway'];
  }
  const out: CapabilityPlane[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    if (typeof item !== 'string' || !PLANES.has(item as CapabilityPlane)) {
      errors.push(`planes[${index}] must be gateway, desktop-ui, desktop-web or desktop-main`);
      return;
    }
    if (seen.has(item)) {
      errors.push(`duplicate plane: ${item}`);
      return;
    }
    seen.add(item);
    out.push(item as CapabilityPlane);
  });
  return out;
}

export function validateCapabilityManifest(
  input: unknown,
  options: ManifestValidationOptions = {},
): ManifestValidation {
  const errors: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['manifest must be an object'] };
  }

  for (const key of Object.keys(input)) {
    if (!KNOWN_KEYS.has(key)) errors.push(`unknown field "${key}"`);
  }

  const id = requireString(input.id, 'id', 64, errors);
  if (id !== undefined && !ID_PATTERN.test(id)) {
    errors.push(`id "${id}" must match ${ID_PATTERN}`);
  }
  const version = requireString(input.version, 'version', 64, errors);
  if (!Number.isInteger(input.apiVersion) || (input.apiVersion as number) < 1) {
    errors.push('apiVersion must be a positive integer');
  }

  if (typeof input.kind !== 'string' || !KINDS.has(input.kind as ProviderKind)) {
    errors.push('kind must be core, trusted or untrusted');
  } else if (input.kind === 'core') {
    const allowed = options.firstPartyAllowlist?.has(id ?? '') ?? false;
    if (!allowed) errors.push('kind "core" requires a first-party allowlist entry');
  }

  let activation: ProviderActivation = 'startup';
  if (input.activation !== undefined) {
    if (typeof input.activation !== 'string' || !ACTIVATIONS.has(input.activation as ProviderActivation)) {
      errors.push('activation must be startup, lazy or on-demand');
    } else {
      activation = input.activation as ProviderActivation;
    }
  }

  const provides = readProvides(input.provides, errors);
  const requires = readStringArray(input.requires, 'requires', errors);
  const wants = readStringArray(input.wants, 'wants', errors);
  const permissions = readStringArray(input.permissions, 'permissions', errors);
  const integrity = readIntegrity(input.integrity, errors);
  const planes = readPlanes(input.planes, errors);

  if (errors.length > 0) return { ok: false, errors };

  const value: CapabilityManifest = {
    id: id as string,
    version: version as string,
    apiVersion: input.apiVersion as number,
    kind: input.kind as ProviderKind,
    provides,
    activation,
    planes,
  };
  if (requires !== undefined) value.requires = requires;
  if (wants !== undefined) value.wants = wants;
  if (permissions !== undefined) value.permissions = permissions;
  if (input.configSchema !== undefined) value.configSchema = input.configSchema;
  if (integrity !== undefined) value.integrity = integrity;
  return { ok: true, value };
}
