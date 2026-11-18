/**
 * Canonical runtime lifecycle.
 *
 * A runtime may own its execution state, but the contract must be able to
 * represent "no evidence" explicitly. Adapters map native state into this
 * shape; the gateway never interprets native fields. Missing or malformed
 * input normalizes to `unknown`, never to `active`.
 */

export type RuntimeLifecyclePhase = 'active' | 'waiting' | 'settled' | 'unknown';

export type RuntimeLifecycleOutcome = 'completed' | 'failed' | 'cancelled' | 'aborted';

export type RuntimeLifecycleWait = 'children' | 'background' | 'input' | 'approval';

export type RuntimeLifecycleAuthority = 'runtime' | 'adapter' | 'watchdog';

export interface RuntimeLifecycle {
  phase: RuntimeLifecyclePhase;
  /** When the adapter/runtime observed this state. */
  observedAt: number;
  /** Last native activity (message/part/updated) used for stale decisions. */
  lastActivityAt?: number;
  /** Required when phase is `settled`. */
  outcome?: RuntimeLifecycleOutcome;
  terminalAt?: number;
  /** Present when phase is `waiting`. */
  waitingOn?: RuntimeLifecycleWait[];
  /** Present when a runtime exposes a lease/claim with an expiry. */
  leaseExpiresAt?: number;
  /** Monotonic per session; older revisions are ignored by consumers. */
  revision: number;
  /** Runtime process generation; snapshots replace state when this changes. */
  epoch: string;
  authority: RuntimeLifecycleAuthority;
  /** Required when phase is `unknown`, for diagnostics. */
  reason?: string;
}

export interface RuntimeLifecycleFallback {
  observedAt: number;
  epoch: string;
}

const PHASES = new Set<RuntimeLifecyclePhase>(['active', 'waiting', 'settled', 'unknown']);
const OUTCOMES = new Set<RuntimeLifecycleOutcome>(['completed', 'failed', 'cancelled', 'aborted']);
const WAITS = new Set<RuntimeLifecycleWait>(['children', 'background', 'input', 'approval']);
const AUTHORITIES = new Set<RuntimeLifecycleAuthority>(['runtime', 'adapter', 'watchdog']);

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}

export function unknownLifecycle(input: {
  observedAt: number;
  epoch: string;
  reason: string;
  lastActivityAt?: number;
  authority?: RuntimeLifecycleAuthority;
  revision?: number;
}): RuntimeLifecycle {
  return {
    phase: 'unknown',
    observedAt: input.observedAt,
    lastActivityAt: input.lastActivityAt,
    revision: input.revision ?? 1,
    epoch: input.epoch,
    authority: input.authority ?? 'adapter',
    reason: input.reason,
  };
}

/**
 * Convert a possibly-legacy adapter payload into a canonical lifecycle.
 * Invalid input is not promoted to `active`; it becomes `unknown` with a
 * reason so the UI and reaper can act honestly.
 */
export function normalizeLifecycle(raw: unknown, fallback: RuntimeLifecycleFallback): RuntimeLifecycle {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return unknownLifecycle({ ...fallback, reason: 'missing-lifecycle' });
  }
  const value = raw as Partial<RuntimeLifecycle>;
  const phase = value.phase as RuntimeLifecyclePhase | undefined;
  if (!phase || !PHASES.has(phase)) {
    return unknownLifecycle({ ...fallback, reason: 'invalid-phase' });
  }
  const observedAt = finite(value.observedAt) ?? fallback.observedAt;
  const epoch = nonEmpty(value.epoch) ?? fallback.epoch;
  const revision = positiveInteger(value.revision) ?? 1;
  const authority = value.authority && AUTHORITIES.has(value.authority) ? value.authority : 'adapter';
  const lastActivityAt = finite(value.lastActivityAt);
  const leaseExpiresAt = finite(value.leaseExpiresAt);

  if (phase === 'unknown') {
    return {
      phase,
      observedAt,
      ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
      ...(leaseExpiresAt !== undefined ? { leaseExpiresAt } : {}),
      revision,
      epoch,
      authority,
      reason: nonEmpty(value.reason) ?? 'unspecified',
    };
  }

  if (phase === 'settled') {
    const outcome = value.outcome;
    if (!outcome || !OUTCOMES.has(outcome)) {
      return unknownLifecycle({
        observedAt,
        epoch,
        reason: 'settled-without-outcome',
        ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
        authority,
        revision,
      });
    }
    const terminalAt = finite(value.terminalAt);
    return {
      phase,
      observedAt,
      ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
      outcome,
      ...(terminalAt !== undefined ? { terminalAt } : {}),
      ...(leaseExpiresAt !== undefined ? { leaseExpiresAt } : {}),
      revision,
      epoch,
      authority,
    };
  }

  if (phase === 'waiting') {
    const waitingOn = Array.isArray(value.waitingOn)
      ? [...new Set(value.waitingOn.filter((item): item is RuntimeLifecycleWait => WAITS.has(item as RuntimeLifecycleWait)))]
      : [];
    return {
      phase,
      observedAt,
      ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
      ...(waitingOn.length > 0 ? { waitingOn } : {}),
      ...(leaseExpiresAt !== undefined ? { leaseExpiresAt } : {}),
      revision,
      epoch,
      authority,
    };
  }

  return {
    phase: 'active',
    observedAt,
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
    ...(leaseExpiresAt !== undefined ? { leaseExpiresAt } : {}),
    revision,
    epoch,
    authority,
  };
}

export function isActiveLifecycle(lifecycle: Pick<RuntimeLifecycle, 'phase'>): boolean {
  return lifecycle.phase === 'active';
}

export function isTerminalLifecycle(lifecycle: Pick<RuntimeLifecycle, 'phase'>): boolean {
  return lifecycle.phase === 'settled';
}
