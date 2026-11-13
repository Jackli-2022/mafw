/**
 * E11-2 — internal session quota accounting.
 *
 * A Lead session is registered twice: first as an *internal identity*
 * (`internal-session` kv + identity bind), then as a `SdkSessionResource`
 * record (`registerExternal`, which enforces the E4-7 session quotas). When the
 * quota rejects the second step the first must be rolled back — otherwise the
 * session shows up as a phantom internal identity that hides a real session and
 * inflates the quota count forever. The failure must also be *observable*:
 * a `session.registration_failed` event plus a warn, never a silent `.catch`.
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §2
 */
import { QuotaExceededError, QuotaService } from '../../../src/resources/quotas';
import { SdkSessionResource } from '../../../src/runtime/sdk-session';
import {
  registerLeadSessionRecord,
  type LeadRegistrationDeps,
  type LeadRegistrationEvent,
} from '../../../src/core/session/internal-registration';

type Limits = { projects: number; sessions: number; sessionRecordsPerProject: number };

const SESSION_ID = 'ses_lead';
const DIRECTORY = 'C:/proj/a';
const METADATA = { mafw: { role: 'lead' } };

function makeDeps(
  impl: (sessionId: string, directory: string, metadata?: Record<string, unknown>) => Promise<unknown> = async () => ({}),
): {
  deps: LeadRegistrationDeps;
  calls: string[];
  events: LeadRegistrationEvent[];
  warnings: string[];
  registerExternal: jest.Mock;
} {
  const calls: string[] = [];
  const events: LeadRegistrationEvent[] = [];
  const warnings: string[] = [];
  const registerExternal = jest.fn(impl);
  const deps: LeadRegistrationDeps = {
    sdkSession: { registerExternal },
    registerInternal: (sessionId, role, identity) => {
      calls.push(`internal:${sessionId}:${role}:${identity ?? '-'}`);
    },
    unregisterInternal: (sessionId) => {
      calls.push(`unregister:${sessionId}`);
    },
    broadcast: (event) => {
      events.push(event);
    },
    log: {
      warn: (message) => {
        warnings.push(message);
      },
    },
    sessionId: SESSION_ID,
    directory: DIRECTORY,
    metadata: METADATA,
    identity: 'manager',
  };
  return { deps, calls, events, warnings, registerExternal };
}

function quotas(over: Partial<Limits> = {}): QuotaService {
  return new QuotaService({
    limits: (): Limits => ({ projects: 0, sessions: 0, sessionRecordsPerProject: 0, ...over }),
  });
}

describe('registerLeadSessionRecord (E11-2)', () => {
  it('success path: internal identity first, then the session record; no event, no warn', async () => {
    const { deps, calls, events, warnings, registerExternal } = makeDeps();

    const outcome = await registerLeadSessionRecord(deps);

    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual([`internal:${SESSION_ID}:lead:manager`]);
    expect(registerExternal).toHaveBeenCalledTimes(1);
    expect(registerExternal).toHaveBeenCalledWith(SESSION_ID, DIRECTORY, METADATA);
    expect(events).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('quota rejection rolls back the internal identity instead of leaving a phantom', async () => {
    const quotaError = new QuotaExceededError('sessions', 1, 1);
    const { deps, calls, events, warnings } = makeDeps(async () => {
      throw quotaError;
    });

    const outcome = await registerLeadSessionRecord(deps);

    // Register → registerExternal → rollback (order pinned: no rollback before
    // the identity exists, or the kv delete would be a no-op today and a bug
    // tomorrow).
    expect(calls).toEqual([`internal:${SESSION_ID}:lead:manager`, `unregister:${SESSION_ID}`]);
    expect(outcome).toEqual({ ok: false, code: 'quota_exceeded', message: quotaError.message });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(SESSION_ID);
    expect(warnings[0]).toContain(quotaError.message);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'session.registration_failed',
      properties: {
        sessionId: SESSION_ID,
        role: 'lead',
        code: 'quota_exceeded',
        message: quotaError.message,
      },
    });
  });

  it('non-quota failures are reported with code "error" and still roll back', async () => {
    const { deps, calls, events } = makeDeps(async () => {
      throw new Error('disk on fire');
    });

    const outcome = await registerLeadSessionRecord(deps);

    expect(calls).toEqual([`internal:${SESSION_ID}:lead:manager`, `unregister:${SESSION_ID}`]);
    expect(outcome).toEqual({ ok: false, code: 'error', message: 'disk on fire' });
    expect(events[0].properties.code).toBe('error');
  });

  it('rolls back on a REAL QuotaExceededError from SdkSessionResource (quota bucket full)', async () => {
    const sdkSession = new SdkSessionResource(undefined, undefined, { quotas: quotas({ sessions: 1 }) });
    await sdkSession.registerExternal('ses_already_there', DIRECTORY);
    const { deps, calls, events } = makeDeps((id, dir) => sdkSession.registerExternal(id, dir));

    const outcome = await registerLeadSessionRecord(deps);

    expect(outcome).toMatchObject({ ok: false, code: 'quota_exceeded' });
    expect(outcome.message).toContain('quota exceeded for sessions');
    expect(calls).toEqual([`internal:${SESSION_ID}:lead:manager`, `unregister:${SESSION_ID}`]);
    expect(events[0].properties).toMatchObject({ sessionId: SESSION_ID, code: 'quota_exceeded' });
    // No phantom record was written by the rejected registration.
    expect(sdkSession.count()).toBe(1);
    expect(await sdkSession.get(SESSION_ID)).toBeNull();
  });

  it('per-directory quota rejection also rolls back (second lead in the same project)', async () => {
    const sdkSession = new SdkSessionResource(undefined, undefined, {
      quotas: quotas({ sessionRecordsPerProject: 1 }),
    });
    await sdkSession.registerExternal('ses_existing', DIRECTORY);
    const { deps, events } = makeDeps((id, dir) => sdkSession.registerExternal(id, dir));

    const outcome = await registerLeadSessionRecord(deps);

    expect(outcome).toMatchObject({ ok: false, code: 'quota_exceeded' });
    expect(events[0].properties.code).toBe('quota_exceeded');
  });

  it('leaves no unhandled rejection behind (the lead boot path must survive)', async () => {
    const { deps } = makeDeps(async () => {
      throw new QuotaExceededError('sessions', 0, 0);
    });
    const seen: unknown[] = [];
    const onUnhandled = (err: unknown) => seen.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
      await expect(registerLeadSessionRecord(deps)).resolves.toMatchObject({ ok: false });
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(seen).toEqual([]);
  });

  it('honours a custom role for the internal registration and the event payload', async () => {
    const { deps, calls, events } = makeDeps(async () => {
      throw new QuotaExceededError('sessions', 1, 1);
    });
    const outcome = await registerLeadSessionRecord({ ...deps, role: 'tech-lead', identity: undefined });

    expect(calls).toEqual([`internal:${SESSION_ID}:tech-lead:-`, `unregister:${SESSION_ID}`]);
    expect(outcome).toMatchObject({ ok: false });
    expect(events[0].properties.role).toBe('tech-lead');
  });
});
