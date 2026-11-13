/**
 * E11-2 — Lead session registration with quota reconciliation.
 *
 * A project Lead session is recorded twice:
 *
 *   1. as an **internal identity** (`internal-session` kv slot + principal
 *      bind) — this is what hides it from the session rail and what the
 *      identity layer uses for permission decisions;
 *   2. as a `SdkSessionResource` record via `registerExternal`, which enforces
 *      the E4-7 session quotas (`sessions`, `sessionRecordsPerProject`).
 *
 * Step 2 can reject. Before E11-2 both call sites either warned or silently
 * `.catch(() => {})`d, leaving step 1 in place: a *phantom internal identity*
 * for a session that has no record — invisible in the rail, counted by nothing,
 * and impossible to distinguish from a live internal session later.
 *
 * This helper keeps the existing order but makes the failure atomic-ish and
 * observable:
 *
 *   - roll the internal identity back (`unregisterInternal`) on any rejection;
 *   - `log.warn` with the session id and the reason;
 *   - broadcast `session.registration_failed` so the UI/event log can see it;
 *   - resolve `{ ok: false }` instead of throwing — a quota rejection must not
 *     crash the Lead boot path (the caller still has a usable runtime session).
 *
 * Quota *policy* is untouched: internal sessions still consume a session slot.
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §2
 */
import { QuotaExceededError } from '../../resources/quotas';
import {
  clearManagerSlotsForSession,
  type ManagerSlotStore,
} from '../manager/manager-session-runtime';

/** Flattened event shape used by `session.registration_failed`. */
export interface LeadRegistrationEvent {
  type: 'session.registration_failed';
  properties: {
    sessionId: string;
    role: string;
    code: 'quota_exceeded' | 'error';
    message: string;
  };
}

export interface LeadRegistrationFailure {
  ok: false;
  code: 'quota_exceeded' | 'error';
  message: string;
}

export type LeadRegistrationOutcome = { ok: true } | LeadRegistrationFailure;

/** Only the slice of `SdkSessionResource` this helper needs (keeps tests thin). */
export interface LeadRegistrationSessionResource {
  registerExternal(
    id: string,
    directory: string,
    metadata?: Record<string, unknown>,
  ): Promise<unknown>;
}

export interface LeadRegistrationDeps {
  sdkSession: LeadRegistrationSessionResource;
  /** `MafwKernel.registerInternalSession` (kv + identity bind). */
  registerInternal(sessionId: string, role: string, identity?: string): void;
  /** `MafwKernel.unregisterInternalSession` (kv delete + identity unbind). */
  unregisterInternal(sessionId: string): void;
  broadcast(event: LeadRegistrationEvent): void;
  log: { warn(message: string): void };
  sessionId: string;
  directory: string;
  metadata?: Record<string, unknown>;
  /** Principal identity alias (e.g. `manager` for the Lead). */
  identity?: string;
  /** Internal role; defaults to `lead`. */
  role?: string;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Register the internal identity, then the session record; roll the identity
 * back when the record is rejected. Never throws.
 */
export async function registerLeadSessionRecord(
  deps: LeadRegistrationDeps,
): Promise<LeadRegistrationOutcome> {
  const role = deps.role ?? 'lead';

  deps.registerInternal(deps.sessionId, role, deps.identity);

  try {
    await deps.sdkSession.registerExternal(deps.sessionId, deps.directory, deps.metadata);
    return { ok: true };
  } catch (err) {
    const code = err instanceof QuotaExceededError ? 'quota_exceeded' : 'error';
    const message = describeError(err);

    // Roll back before reporting: the identity must never outlive the record.
    try {
      deps.unregisterInternal(deps.sessionId);
    } catch (rollbackErr) {
      // A failed rollback must not hide the original failure — log both and
      // keep going (the event below still reports the registration failure).
      deps.log.warn(
        `[Sessions] ${role} internal rollback failed for ${deps.sessionId}: ${describeError(rollbackErr)}`,
      );
    }

    deps.log.warn(
      `[Sessions] ${role} session registration failed for ${deps.sessionId} (${code}): ${message}`,
    );
    deps.broadcast({
      type: 'session.registration_failed',
      properties: { sessionId: deps.sessionId, role, code, message },
    });

    return { ok: false, code, message };
  }
}

/** The failure shape `rollbackRejectedLeadRegistration` accepts. */
export interface LeadRegistrationRejection {
  code: string;
  message: string;
}

/**
 * E11-2b — undo the manager slot after a rejected Lead registration.
 *
 * `rotateCreateManagerSession` writes the `manager-session` slot *before*
 * registering the Lead (the session id is persisted as soon as it exists so a
 * concurrent `ensure()` cannot create a second Lead). When registration is then
 * rejected by the quota, the slot is left pointing at a runtime session that
 * has no local record — every later `current` / `findBySessionId` read resolves
 * to a session the gateway does not consider registered.
 *
 * This clears that slot and returns the error the caller must throw, so a dead
 * session id never reaches the caller. The runtime session itself is
 * deliberately left alone (rotation failures are a caller-visible error, not a
 * session-deletion path). A store failure propagates: the caller still throws,
 * and still never receives the dead id.
 */
export function rollbackRejectedLeadRegistration(
  store: ManagerSlotStore,
  sessionId: string,
  currentRuntime: string,
  failure: LeadRegistrationRejection,
): Error {
  clearManagerSlotsForSession(store, sessionId, currentRuntime);
  return new Error(`${failure.code}: ${failure.message}`);
}
