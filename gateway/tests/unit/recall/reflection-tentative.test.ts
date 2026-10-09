import { collectTentative, applyTentativeVerdicts } from '../../../src/recall/reflection';

const entry = (id: string, cues: string[], ageDays: number) => ({
  id, cue_anchors: cues, energy: 0.35, salience: 1,
  created_at: new Date(Date.now() - ageDays * 86400_000).toISOString(),
} as any);

describe('collectTentative', () => {
  test('picks tentative-anchored live entries', () => {
    const now = Date.now();
    const entries = [
      entry('t1', ['tentative'], 2),
      entry('n1', ['normal'], 2),
      { ...entry('t2', ['tentative'], 1), superseded_by: 'x' },
    ];
    expect(collectTentative(entries, now).map((e: any) => e.id)).toEqual(['t1']);
  });
});

describe('applyTentativeVerdicts', () => {
  test('promote strips tentative, bumps energy, stamps verified', async () => {
    const writes: any[] = [];
    const deps = {
      read: async () => ({ id: 't1', cue_anchors: ['tentative', 'gateway'], energy: 0.35, memory_value: 'v', primary_abstraction: 'a', type: 'semantic' }) as any,
      write: async (u: any) => { writes.push(u); },
    };
    await applyTentativeVerdicts([{ id: 't1', verdict: 'promote' }], deps as any, new Date('2026-10-09T00:00:00Z'));
    expect(writes[0].cue_anchors).toContain('verified:2026-10-09');
    expect(writes[0].cue_anchors).not.toContain('tentative');
    expect(writes[0].energy).toBe(0.7);
  });
  test('reject demotes to 0.05 with rejected anchor', async () => {
    const writes: any[] = [];
    const deps = { read: async () => ({ id: 't1', cue_anchors: ['tentative'], energy: 0.35 }) as any, write: async (u: any) => { writes.push(u); } };
    await applyTentativeVerdicts([{ id: 't1', verdict: 'reject' }], deps as any, new Date());
    expect(writes[0].energy).toBe(0.05);
    expect(writes[0].cue_anchors).toContain('rejected');
    expect(writes[0].cue_anchors).not.toContain('tentative');
  });
  test('missing unit → no write', async () => {
    const writes: any[] = [];
    const deps = { read: async () => null, write: async (u: any) => { writes.push(u); } };
    const r = await applyTentativeVerdicts([{ id: 'gone', verdict: 'promote' }], deps as any, new Date());
    expect(writes.length).toBe(0);
    expect(r).toEqual({ promoted: 0, rejected: 0 });
  });
});
