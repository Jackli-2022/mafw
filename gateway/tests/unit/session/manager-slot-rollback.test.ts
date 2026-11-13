/**
 * E11-2b — manager slot rollback on a rejected Lead registration.
 *
 * `rotateCreateManagerSession` writes the `manager-session` slot *before*
 * registering the Lead. `registerLeadRecord` may resolve `{ ok: false }` when
 * the E4-7 session quota rejects the record, which used to leave the slot
 * pointing at a runtime session that has no local record — every later
 * `findBySessionId` / `current` read then resolves to an unregistered session.
 *
 * The fix is two parts:
 *   - `clearManagerSlotsForSession` drops (and persists) every `manager-session`
 *     row that points at the rejected session for this runtime;
 *   - `rollbackRejectedLeadRegistration` runs that cleanup and returns the error
 *     the caller must throw, so a dead session id never reaches the caller.
 *
 * Spec: docs/superpowers/specs/2026-11-13-gateway-e11-identity-hardening-design.md §2
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  clearManagerSlotsForSession,
  writeManagerSlot,
  readManagerSlot,
  type ManagerSlotStore,
} from '../../../src/core/manager/manager-session-runtime';
import { rollbackRejectedLeadRegistration } from '../../../src/core/session/internal-registration';

const RUNTIME = 'opencode';
const OTHER_RUNTIME = 'pi';
const SESSION_ID = 'ses_rejected';

interface FakeStore {
  store: ManagerSlotStore;
  /** Persisted rows after the writes (what the next reader would see). */
  rows: Map<string, unknown>;
  writes: Array<{ key: string; value: unknown }>;
}

function makeStore(rows: Record<string, unknown>): FakeStore {
  const map = new Map<string, unknown>(Object.entries(rows));
  const writes: Array<{ key: string; value: unknown }> = [];
  const store: ManagerSlotStore = {
    kvAll: <T,>(scope: string): Array<{ key: string; value: T }> => {
      expect(scope).toBe('manager-session');
      return [...map.entries()].map(([key, value]) => ({ key, value: value as T }));
    },
    kvSet: (scope: string, key: string, value: unknown): void => {
      expect(scope).toBe('manager-session');
      map.set(key, value);
      writes.push({ key, value });
    },
  };
  return { store, rows: map, writes };
}

describe('clearManagerSlotsForSession (E11-2b)', () => {
  it('clears and persists the slot that points at the rejected session', () => {
    const { store, rows, writes } = makeStore({
      'C:/proj/a': writeManagerSlot(undefined, RUNTIME, { sessionId: SESSION_ID }),
      'C:/proj/b': writeManagerSlot(undefined, RUNTIME, { sessionId: 'ses_other' }),
    });

    const cleared = clearManagerSlotsForSession(store, SESSION_ID, RUNTIME);

    expect(cleared).toEqual(['C:/proj/a']);
    expect(writes).toHaveLength(1);
    expect(writes[0].key).toBe('C:/proj/a');
    // Cleared ⇒ unreadable for this runtime (no slot, not a dangling pointer).
    expect(readManagerSlot(rows.get('C:/proj/a'), RUNTIME)).toBeNull();
    // The unrelated project keeps its Lead.
    expect(readManagerSlot(rows.get('C:/proj/b'), RUNTIME)).toEqual({ sessionId: 'ses_other' });
  });

  it('preserves other runtimes and the unattributed legacy slot', () => {
    const { store, rows } = makeStore({
      'C:/proj/a': {
        byRuntime: { [RUNTIME]: { sessionId: SESSION_ID }, [OTHER_RUNTIME]: { sessionId: 'pi_lead' } },
        unattributed: { sessionId: 'ses_legacy' },
      },
    });

    clearManagerSlotsForSession(store, SESSION_ID, RUNTIME);

    const value = rows.get('C:/proj/a') as any;
    expect(value.byRuntime[RUNTIME]).toBeUndefined();
    expect(value.byRuntime[OTHER_RUNTIME]).toEqual({ sessionId: 'pi_lead' });
    expect(value.unattributed).toEqual({ sessionId: 'ses_legacy' });
  });

  it('writes nothing when no row points at the session', () => {
    const { store, writes } = makeStore({
      'C:/proj/a': writeManagerSlot(undefined, RUNTIME, { sessionId: 'ses_other' }),
      'C:/proj/b': writeManagerSlot(undefined, OTHER_RUNTIME, { sessionId: SESSION_ID }),
    });

    expect(clearManagerSlotsForSession(store, SESSION_ID, RUNTIME)).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('is idempotent', () => {
    const { store, writes } = makeStore({
      'C:/proj/a': writeManagerSlot(undefined, RUNTIME, { sessionId: SESSION_ID }),
    });

    expect(clearManagerSlotsForSession(store, SESSION_ID, RUNTIME)).toEqual(['C:/proj/a']);
    expect(clearManagerSlotsForSession(store, SESSION_ID, RUNTIME)).toEqual([]);
    expect(writes).toHaveLength(1);
  });
});

describe('rollbackRejectedLeadRegistration (E11-2b)', () => {
  it('clears the slot and returns an error that names the failure code', () => {
    const { store, rows } = makeStore({
      'C:/proj/a': writeManagerSlot(undefined, RUNTIME, { sessionId: SESSION_ID }),
    });

    const error = rollbackRejectedLeadRegistration(store, SESSION_ID, RUNTIME, {
      code: 'quota_exceeded',
      message: 'quota exceeded for sessions (1/1)',
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('quota_exceeded: quota exceeded for sessions (1/1)');
    expect(readManagerSlot(rows.get('C:/proj/a'), RUNTIME)).toBeNull();
  });

  it('surfaces generic registration failures the same way', () => {
    const { store } = makeStore({});
    const error = rollbackRejectedLeadRegistration(store, SESSION_ID, RUNTIME, {
      code: 'error',
      message: 'disk on fire',
    });
    expect(error.message).toBe('error: disk on fire');
  });

  it('does not swallow a cleanup failure (the caller still never gets a dead id)', () => {
    const store: ManagerSlotStore = {
      kvAll: () => [{ key: 'C:/proj/a', value: writeManagerSlot(undefined, RUNTIME, { sessionId: SESSION_ID }) }],
      kvSet: () => {
        throw new Error('db is read-only');
      },
    };

    expect(() =>
      rollbackRejectedLeadRegistration(store, SESSION_ID, RUNTIME, {
        code: 'quota_exceeded',
        message: 'nope',
      }),
    ).toThrow('db is read-only');
  });
});

/**
 * Kernel wiring guard: the helpers above are only worth anything if
 * `rotateCreateManagerSession` actually consults the registration outcome.
 * A booted kernel costs seconds per test and needs a live runtime, so the
 * wiring is pinned at the source level (same trade-off as E11-1's route wiring).
 */
describe('kernel wiring (E11-2b)', () => {
  const kernelSource = fs.readFileSync(
    path.resolve(__dirname, '../../../src/kernel.ts'),
    'utf-8',
  );

  function methodBody(name: string): string {
    const start = kernelSource.indexOf(`private async ${name}(`);
    expect(start).toBeGreaterThan(-1);
    // Methods in this class are tens of lines; 2000 chars covers the largest
    // one under test here and keeps the slice from swallowing the rest of the
    // file (both methods under test sit in the class tail).
    return kernelSource.slice(start, start + 2000);
  }

  it('registerLeadRecord returns the helper outcome', () => {
    const body = methodBody('registerLeadRecord');
    expect(body).toContain('Promise<LeadRegistrationOutcome>');
    expect(body).toContain('return registerLeadSessionRecord(');
  });

  it('rotateCreateManagerSession rolls the slot back and throws on rejection', () => {
    const body = methodBody('rotateCreateManagerSession');
    const outcome = body.indexOf('registerLeadRecord(sessionId, canonical)');
    expect(outcome).toBeGreaterThan(-1);

    const after = body.slice(outcome);
    expect(after).toContain('rollbackRejectedLeadRegistration');
    expect(after).toContain('throw');
    // The dead id must never be returned: the throw precedes `return sessionId`.
    expect(after.indexOf('throw')).toBeLessThan(after.lastIndexOf('return sessionId'));
  });
});
