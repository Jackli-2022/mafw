/**
 * T2-2 Task 3: RunStateService 持久状态机（deps 全注入）。
 */
import {
  RunStateService,
  RunStateError,
  type RunStateServiceDeps,
} from '../../../src/core/run/run-state-service';
import type { RunStateRow } from '../../../src/memory/gateway-db';

const brief = {
  lastUserText: 'do it',
  lastAssistantTail: 'half done',
  anchorMessageID: 'u1',
  queuedCount: 2,
};

function harness() {
  const rows = new Map<string, RunStateRow>();
  const calls = { broadcasts: [] as any[], pruned: [] as Array<{ sid: string; keep: number }> };
  let seq = 0;
  let clock = 0;
  const deps: RunStateServiceDeps = {
    db: {
      insertRunState: (r) => { rows.set(r.id, r); },
      getRunState: (id) => rows.get(id),
      getActiveRunState: (sid) =>
        [...rows.values()]
          .filter((r) => r.session_id === sid && (r.status === 'suspended' || r.status === 'resumed'))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0],
      listActiveRunStates: () =>
        [...rows.values()].filter((r) => r.status === 'suspended' || r.status === 'resumed'),
      updateRunState: (id, patch) => {
        const cur = rows.get(id);
        if (!cur) return;
        rows.set(id, {
          ...cur,
          status: patch.status ?? cur.status,
          reason: patch.reason !== undefined ? patch.reason : cur.reason,
          resumed_at: patch.resumed_at !== undefined ? patch.resumed_at : cur.resumed_at,
          finished_at: patch.finished_at !== undefined ? patch.finished_at : cur.finished_at,
        });
      },
      pruneRunStates: (sid, keep) => { calls.pruned.push({ sid, keep }); return 0; },
      deleteRunStates: (sid) => {
        for (const [id, r] of rows) if (r.session_id === sid) rows.delete(id);
      },
    },
    broadcast: (e) => { calls.broadcasts.push(e); },
    now: () => `2026-10-26T01:00:0${clock++}Z`,
    newId: () => `run_${++seq}`,
  };
  return { service: new RunStateService(deps), rows, calls, deps };
}

const input = { sessionID: 's1', projectDir: '/tmp/p', brief, reason: 'lunch' };

describe('RunStateService.suspend', () => {
  it('inserts a suspended run, prunes and broadcasts', () => {
    const h = harness();
    const run = h.service.suspend(input);

    expect(run).toMatchObject({
      id: 'run_1', sessionID: 's1', projectDir: '/tmp/p', status: 'suspended',
      reason: 'lunch', brief,
    });
    expect(run.resumedAt).toBeUndefined();
    expect(run.finishedAt).toBeUndefined();
    expect(h.calls.pruned).toEqual([{ sid: 's1', keep: 20 }]);
    expect(h.calls.broadcasts).toHaveLength(1);
    const evt = h.calls.broadcasts[0];
    expect(evt.type).toBe('run.updated');
    expect(evt.sessionID).toBe('s1');
    expect(evt.properties.run.status).toBe('suspended');
  });

  it('409 when a run is already active', () => {
    const h = harness();
    h.service.suspend(input);
    expect(() => h.service.suspend(input)).toThrow(RunStateError);
    expect(() => h.service.suspend(input)).toThrow(/already active/);
  });
});

describe('RunStateService transitions', () => {
  it('resume: suspended -> resumed with resumedAt + broadcast', () => {
    const h = harness();
    const run = h.service.suspend(input);
    const resumed = h.service.resume(run.id);
    expect(resumed.status).toBe('resumed');
    expect(resumed.resumedAt).toBeTruthy();
    expect(h.calls.broadcasts).toHaveLength(2);
  });

  it('resume rejects non-suspended runs (409) and unknown ids (404)', () => {
    const h = harness();
    expect(() => h.service.resume('nope')).toThrow(RunStateError);
    const run = h.service.suspend(input);
    h.service.resume(run.id);
    expect(() => h.service.resume(run.id)).toThrow(/not suspended/);
  });

  it('reopen: resumed -> suspended clears resumedAt (send failure rollback)', () => {
    const h = harness();
    const run = h.service.suspend(input);
    h.service.resume(run.id);
    const reopened = h.service.reopen(run.id, 'send failed');
    expect(reopened.status).toBe('suspended');
    expect(reopened.resumedAt).toBeUndefined();
  });

  it('finish only applies to resumed runs and maps the outcome', () => {
    const h = harness();
    const run = h.service.suspend(input);
    expect(h.service.finish('s1', 'completed')).toBeNull(); // suspended untouched

    h.service.resume(run.id);
    const done = h.service.finish('s1', 'completed')!;
    expect(done.status).toBe('completed');
    expect(done.finishedAt).toBeTruthy();
    expect(h.service.active('s1')).toBeNull();
  });

  it('discard cancels suspended or resumed runs', () => {
    const h = harness();
    const a = h.service.suspend(input);
    const d1 = h.service.discard(a.id);
    expect(d1.status).toBe('cancelled');

    const b = h.service.suspend({ ...input });
    h.service.resume(b.id);
    const d2 = h.service.discard(b.id);
    expect(d2.status).toBe('cancelled');
    expect(d2.finishedAt).toBeTruthy();
  });

  it('active/listActive/deleteForSession', () => {
    const h = harness();
    const run = h.service.suspend(input);
    expect(h.service.active('s1')!.id).toBe(run.id);
    expect(h.service.listActive().map((r) => r.id)).toEqual([run.id]);
    h.service.deleteForSession('s1');
    expect(h.service.active('s1')).toBeNull();
  });
});
