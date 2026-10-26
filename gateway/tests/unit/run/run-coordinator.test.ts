/**
 * T2-2 Task 5: RunCoordinator 编排（全 mock；真实 RunStateService + 内存 db）。
 */
import { RunCoordinator, type RunCoordinatorDeps } from '../../../src/core/run/run-coordinator';
import { RunStateService, RunStateError } from '../../../src/core/run/run-state-service';
import type { RunStateRow } from '../../../src/memory/gateway-db';

const T = (n: number) => ({ created: 1_000 + n });
const text = (s: string) => ({ type: 'text', text: s });
const messages = [
  { info: { id: 'u1', role: 'user', time: T(1) }, parts: [text('long task')] },
  { info: { id: 'a1', role: 'assistant', time: T(2) }, parts: [text('step 1 done')] },
];

function harness(opts: {
  capabilities?: any;
  abortThrows?: boolean;
  promptThrows?: boolean;
  messagesSeq?: any[][];
} = {}) {
  const rows = new Map<string, RunStateRow>();
  let seq = 0;
  const service = new RunStateService({
    db: {
      insertRunState: (r) => { rows.set(r.id, r); },
      getRunState: (id) => rows.get(id),
      getActiveRunState: (sid) =>
        [...rows.values()]
          .filter((r) => r.session_id === sid && (r.status === 'suspended' || r.status === 'resumed'))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0],
      listActiveRunStates: () => [...rows.values()].filter((r) => r.status === 'suspended' || r.status === 'resumed'),
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
      pruneRunStates: () => 0,
      deleteRunStates: (sid) => { for (const [id, r] of rows) if (r.session_id === sid) rows.delete(id); },
    },
    broadcast: () => {},
    now: () => '2026-10-26T01:00:00Z',
    newId: () => `run_${++seq}`,
  });

  let busy = true;
  let seqIdx = 0;
  const log: string[] = [];
  const calls = { abort: 0, prompts: [] as string[], flush: 0, settleWaits: 0 };

  const deps: RunCoordinatorDeps = {
    runtime: () => ({
      capabilities: opts.capabilities ?? { runStateApi: true },
      session: {
        abort: async () => {
          calls.abort++;
          // 断言闸门先于 abort
          log.push(coord.isSuspended('s1') ? 'abort(gated)' : 'abort(ungated)');
          if (opts.abortThrows) throw new Error('session is not running');
          busy = false;
        },
        messages: async () => {
          if (opts.messagesSeq) {
            return { data: opts.messagesSeq[Math.min(seqIdx++, opts.messagesSeq.length - 1)] };
          }
          return { data: messages };
        },
        promptAsync: async (o: any) => {
          log.push('prompt');
          calls.prompts.push(o.parts?.[0]?.text ?? '');
          if (opts.promptThrows) throw new Error('send failed');
        },
        get: async () => ({ id: 's1', directory: '/tmp/p' }),
      },
    }),
    service,
    isBusy: () => busy,
    queueSize: () => 2,
    flushQueue: () => { calls.flush++; log.push('flush'); },
    now: () => Date.now(),
    wait: async () => { calls.settleWaits++; },
    log: (m) => log.push(m),
  };

  const coord = new RunCoordinator(deps);
  return { coord, service, rows, calls, log, setBusy: (v: boolean) => { busy = v; } };
}

describe('suspend', () => {
  it('gates the queue before abort, settles, rebuilds the brief, persists', async () => {
    const h = harness();
    const run = await h.coord.suspend('s1', 'lunch');

    expect(h.log).toContain('abort(gated)');
    expect(run.status).toBe('suspended');
    expect(run.reason).toBe('lunch');
    expect(run.brief.lastUserText).toBe('long task');
    expect(run.brief.queuedCount).toBe(2);
  });

  it('503 without runStateApi / abort', async () => {
    const h = harness({ capabilities: {} });
    await expect(h.coord.suspend('s1')).rejects.toMatchObject({ status: 503 });
  });

  it('409 when a run is already active', async () => {
    const h = harness();
    await h.coord.suspend('s1');
    await expect(h.coord.suspend('s1')).rejects.toMatchObject({ status: 409 });
  });

  it('409 + gate cleared when abort reports the session is idle', async () => {
    const h = harness({ abortThrows: true });
    await expect(h.coord.suspend('s1')).rejects.toMatchObject({ status: 409 });
    expect(h.coord.isSuspended('s1')).toBe(false);
  });

  it('does not abort when there is no user anchor to resume from', async () => {
    const h = harness({ messagesSeq: [[{ info: { id: 'a1', role: 'assistant', time: T(1) }, parts: [text('x')] }]] });
    await expect(h.coord.suspend('s1')).rejects.toMatchObject({ status: 409 });
    expect(h.calls.abort).toBe(0);
  });
});

describe('resume', () => {
  it('marks resumed BEFORE sending, clears the gate, and fires the prompt', async () => {
    const h = harness();
    const run = await h.coord.suspend('s1');
    h.log.length = 0;
    const res = await h.coord.resume('s1');

    expect(res.run.status).toBe('resumed');
    expect(res.prompted).toBe(true);
    expect(h.log.indexOf('prompt')).toBeGreaterThan(-1);
    expect(h.calls.prompts[0]).toContain('[MAFW 续跑]');
    expect(h.calls.prompts[0]).toContain('long task');
    expect(h.coord.isSuspended('s1')).toBe(false);
  });

  it('409 before the abort terminal settles', async () => {
    const h = harness({ abortThrows: false });
    // 手动构造：直接落一个未 settle 的 run
    const run = h.service.suspend({
      sessionID: 's1', projectDir: '/tmp/p',
      brief: { lastUserText: 'x', lastAssistantTail: '', anchorMessageID: 'u1', queuedCount: 0 },
    });
    await expect(h.coord.resume('s1')).rejects.toMatchObject({ status: 409 });
  });

  it('409 when busy; 404 when no run', async () => {
    const h = harness();
    await h.coord.suspend('s1');
    h.setBusy(true);
    await expect(h.coord.resume('s1')).rejects.toMatchObject({ status: 409 });

    const h2 = harness();
    h2.setBusy(false);
    await expect(h2.coord.resume('s1')).rejects.toMatchObject({ status: 404 });
  });

  it('send failure reopens to suspended and re-arms the gate', async () => {
    const h = harness({ promptThrows: true });
    await h.coord.suspend('s1');
    await h.coord.resume('s1');
    await new Promise((r) => setImmediate(r));
    expect(h.service.active('s1')!.status).toBe('suspended');
    expect(h.coord.isSuspended('s1')).toBe(true);
  });
});

describe('discard / terminal / reconcile', () => {
  it('discard cancels, clears the gate and flushes the queue', async () => {
    const h = harness();
    const run = await h.coord.suspend('s1');
    const d = await h.coord.discard('s1');
    expect(d.id).toBe(run.id);
    expect(d.status).toBe('cancelled');
    expect(h.coord.isSuspended('s1')).toBe(false);
    expect(h.calls.flush).toBe(1);
  });

  it('onTerminal finishes a resumed run only after turn.started', async () => {
    const h = harness();
    await h.coord.suspend('s1');
    h.coord.onTerminal('s1', 'aborted'); // abort 终态：只 settle
    expect(h.service.active('s1')!.status).toBe('suspended');

    await h.coord.resume('s1');
    // resume 发送后、回合尚未开始的延迟终态不得结束 run
    h.coord.onTerminal('s1', 'aborted');
    expect(h.service.active('s1')!.status).toBe('resumed');

    h.coord.onTurnStarted('s1');
    h.coord.onTerminal('s1', 'completed');
    expect(h.service.active('s1')).toBeNull();
  });

  it('reconcile re-arms suspended runs and cancels resumed zombies', () => {
    const h = harness();
    h.service.suspend({
      sessionID: 's1', projectDir: '/tmp/p',
      brief: { lastUserText: 'x', lastAssistantTail: '', anchorMessageID: 'u1', queuedCount: 0 },
    });
    h.service.suspend({
      sessionID: 's2', projectDir: '/tmp/p',
      brief: { lastUserText: 'y', lastAssistantTail: '', anchorMessageID: 'u2', queuedCount: 0 },
    });
    const s2 = h.service.active('s2')!;
    h.service.resume(s2.id);

    h.coord.reconcile();

    expect(h.coord.isSuspended('s1')).toBe(true);
    expect(h.coord.isSuspended('s2')).toBe(false);
    expect(h.service.active('s2')).toBeNull();
    const s2row = [...h.rows.values()].find((r) => r.session_id === 's2')!;
    expect(s2row.status).toBe('cancelled');
  });

  it('deleteForSession clears the run rows and in-memory sets', async () => {
    const h = harness();
    await h.coord.suspend('s1');
    h.coord.deleteForSession('s1');
    expect(h.service.active('s1')).toBeNull();
    expect(h.coord.isSuspended('s1')).toBe(false);
  });
});
