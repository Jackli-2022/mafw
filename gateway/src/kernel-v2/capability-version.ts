/**
 * Capability interface versioning. One major per capability family by default;
 * coexistence requires an explicit provider set.
 */

export interface CapabilityVersion {
  major: number;
  minor: number;
}

const PATTERN = /^([1-9]\d*)(?:\.(\d+))?$/;

export function parseCapabilityVersion(value: string): CapabilityVersion | null {
  if (typeof value !== 'string') return null;
  const match = PATTERN.exec(value);
  if (!match) return null;
  return { major: Number(match[1]), minor: match[2] === undefined ? 0 : Number(match[2]) };
}

export function isCapabilityCompatible(
  host: CapabilityVersion,
  provider: CapabilityVersion,
): boolean {
  return host.major === provider.major;
}

export function allowsCapabilityCoexistence(
  host: CapabilityVersion,
  provider: CapabilityVersion,
  explicit: boolean,
): boolean {
  if (!explicit) return false;
  return host.major !== provider.major || host.minor !== provider.minor;
}
