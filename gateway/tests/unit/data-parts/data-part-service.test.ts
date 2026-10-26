import {
  DataPartService,
  DataPartError,
  type DataPartServiceDeps,
} from '../../../src/core/data-parts/data-part-service';
import type { SessionDataPartRow } from '../../../src/memory/gateway-db';

const T = (n: number) => ({ created: 1_000 + n });

function messages() {
  return {
    data: [
      { id: 'a2', role: 'assistant', time: T(4), content: [] },
      { id: 'u2', role: 'user', time: T(3), content: [{ type: 'text', text: 'hi' }] },
      { id: 'a1', role: 'assistant', time: T(2), content: [] },
      { id: 'u1', role: 'user', time: T(1), content: [{ type: 'text', text: 'hello' }] },
    ],
  };
}

function harness(opts: { noAssistant?: boolean } = {}) {
  const rows = new Map<string, SessionDataPartRow>();
  const calls = { broadcasts: [] as any[], pruned: [] as number[] };
  let t = 0;
  const deps: DataPartServiceDeps = {
    db: {
      upsertSessionDataPart: (r) => { rows.set(`${r.session_id}|${r.id}`, r); },
      getSessionDataPart: (sid, id) => rows.get(`${sid}|${id}`),
      deleteSessionDataPart: (sid, id) => { rows.delete(`${sid}|${id}`); },
      pruneSessionDataParts: (sid, keep) => { calls.pruned.push(keep); return 0; },
    },
    runtime: () => ({
      session: {
        messages: async () => ({
          data: opts.noAssistant
            ? [{ id: 'u1', role: 'user', time: T(1), content: [] }]
            : messages().data,
        }),
      },
    }),
    broadcast: (e) => { calls.broadcasts.push(e); },
    now: () => `2026-10-26T00:00:0${t++}Z`,
  };
  return { service: new DataPartService(deps), rows, calls };
}

describe('DataPartService.create', () => {
  it('persists an assistant-bound part, prunes and broadcasts part.updated', async () => {
    const h = harness();
    const part = await h.service.create({ sessionID: 's1', name: 'swarm', data: { done: 1 } });
    expect(part).toMatchObject({
      id: expect.stringMatching(/^data_/),
      type: 'data-swarm',
      data: { done: 1 },
      sessionID: 's1',
      messageID: 'a2',
    });
    expect(part.transient).toBeUndefined();
    expect([...h.rows.values()]).toHaveLength(1);
    expect(h.calls.pruned).toEqual([200]);
    expect(h.calls.broadcasts).toEqual([{
      type: 'part.updated',
      properties: { part },
      sessionID: 's1',
    }]);
  });

  it('normalizes a stable id so re-injection updates in place', async () => {
    const h = harness();
    const a = await h.service.create({ sessionID: 's1', name: 'swarm', id: 'job-1', data: { v: 1 } });
    const b = await h.service.create({ sessionID: 's1', name: 'swarm', id: 'job-1', data: { v: 2 } });
    expect(b.id).toBe(a.id);
    expect([...h.rows.values()]).toHaveLength(1);
    expect(JSON.parse([...h.rows.values()][0].data_json)).toEqual({ v: 2 });
  });

  it('transient parts are not persisted and delete an existing persistent row', async () => {
    const h = harness();
    const a = await h.service.create({ sessionID: 's1', name: 'swarm', id: 'job-1', data: { v: 1 } });
    const b = await h.service.create({ sessionID: 's1', name: 'swarm', id: 'job-1', data: { v: 2 }, transient: true });
    expect(b.transient).toBe(true);
    expect(a.id).toBe(b.id);
    expect(h.rows.size).toBe(0);
    expect(h.calls.pruned).toHaveLength(1); // 只有持久那次修剪
  });

  it('rejects invalid names, oversized data and unbound messages', async () => {
    const h = harness();
    await expect(h.service.create({ sessionID: 's1', name: 'Bad Name', data: {} }))
      .rejects.toMatchObject({ status: 400 });
    await expect(h.service.create({ sessionID: 's1', name: 'x', data: { big: 'y'.repeat(70_000) } }))
      .rejects.toMatchObject({ status: 400 });
    await expect(h.service.create({ sessionID: 's1', name: 'x', data: {}, messageID: 'u1' }))
      .rejects.toMatchObject({ status: 400 });
    await expect(h.service.create({ sessionID: 's1', name: 'x', data: {}, messageID: 'missing' }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('requires an assistant message to attach to', async () => {
    const h = harness({ noAssistant: true });
    await expect(h.service.create({ sessionID: 's1', name: 'x', data: {} }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('refuses moving an existing id to another message', async () => {
    const h = harness();
    await h.service.create({ sessionID: 's1', name: 'x', id: 'job', data: {}, messageID: 'a2' });
    await expect(
      h.service.create({ sessionID: 's1', name: 'x', id: 'job', data: {}, messageID: 'a1' }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('uses explicit assistant messageID when provided', async () => {
    const h = harness();
    const part = await h.service.create({ sessionID: 's1', name: 'x', data: {}, messageID: 'a1' });
    expect(part.messageID).toBe('a1');
  });

  it('DataPartError carries status for route mapping', async () => {
    const h = harness();
    const err = await h.service.create({ sessionID: 's1', name: 'BAD', data: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(DataPartError);
  });
});
