/**
 * Frozen kernel-v2 diagnostic shape.
 *
 * Diagnostics are data only: never include Host handlers, source, prompts or
 * secrets. Unknown fields are dropped by sanitizeKernelDiagnostic.
 */

export type KernelPlane = 'gateway' | 'desktop-ui' | 'desktop-web' | 'desktop-main';
export type KernelProviderState = 'loaded' | 'active' | 'degraded' | 'failed' | 'disposed';

export interface KernelDiagnostic {
  providerId: string;
  capability: string;
  version: string;
  plane: KernelPlane;
  state: KernelProviderState;
  reason?: string;
  revision: string;
  lastKnownGood?: string;
  at: string;
}

const PLANES = new Set<KernelPlane>(['gateway', 'desktop-ui', 'desktop-web', 'desktop-main']);
const STATES = new Set<KernelProviderState>(['loaded', 'active', 'degraded', 'failed', 'disposed']);

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function createKernelDiagnostic(
  input: Omit<KernelDiagnostic, 'at'> & { at?: string },
): KernelDiagnostic {
  return {
    providerId: input.providerId,
    capability: input.capability,
    version: input.version,
    plane: input.plane,
    state: input.state,
    revision: input.revision,
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.lastKnownGood !== undefined ? { lastKnownGood: input.lastKnownGood } : {}),
    at: input.at ?? new Date().toISOString(),
  };
}

export function sanitizeKernelDiagnostic(value: unknown): KernelDiagnostic | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!nonEmpty(input.providerId)) return null;
  if (!nonEmpty(input.capability)) return null;
  if (!nonEmpty(input.version)) return null;
  if (!nonEmpty(input.revision)) return null;
  if (typeof input.plane !== 'string' || !PLANES.has(input.plane as KernelPlane)) return null;
  if (typeof input.state !== 'string' || !STATES.has(input.state as KernelProviderState)) return null;

  const at =
    typeof input.at === 'string' && !Number.isNaN(Date.parse(input.at))
      ? input.at
      : new Date().toISOString();

  return {
    providerId: input.providerId,
    capability: input.capability,
    version: input.version,
    plane: input.plane as KernelPlane,
    state: input.state as KernelProviderState,
    revision: input.revision,
    ...(optionalString(input.reason) !== undefined ? { reason: optionalString(input.reason) } : {}),
    ...(optionalString(input.lastKnownGood) !== undefined
      ? { lastKnownGood: optionalString(input.lastKnownGood) }
      : {}),
    at,
  };
}
