import { ReconsolidatePipeline, selectNewerRelated } from '../../../src/recall/reconsolidate-pipeline';
import { InMemoryReconsolidationQueue } from '../../../src/recall/reconsolidation';

const entry = (id: string, cues: string[], created: string) => ({
  id, type: 'semantic', primary_abstraction: `abs ${id}`, cue_anchors: cues,
  energy: 0.8, salience: 1, created_at: created, filePath: `memory/concepts/semantic/x-${id}.md`,
} as any);

describe('selectNewerRelated', () => {
  const now = Date.parse('2026-10-09T00:00:00Z');
  test('picks newer entries sharing a cue anchor, excludes self and superseded', () => {
    const unit = entry('m1', ['gateway', 'deploy'], '2026-10-01T00:00:00Z');
    const entries = [
      entry('m1', ['gateway'], '2026-10-02T00:00:00Z'),
      entry('m2', ['gateway'], '2026-10-05T00:00:00Z'),
      { ...entry('m3', ['deploy'], '2026-10-06T00:00:00Z'), superseded_by: 'm9' },
      entry('m4', ['unrelated'], '2026-10-07T00:00:00Z'),
      entry('m5', ['gateway'], '2026-09-01T00:00:00Z'),
    ];
    expect(selectNewerRelated(unit, entries, now).map((e: any) => e.id)).toEqual(['m2']);
  });
  test('caps at 5 by recency', () => {
    const unit = entry('m1', ['x'], '2026-09-01T00:00:00Z');
    const entries = Array.from({ length: 8 }, (_, i) =>
      entry(`n${i}`, ['x'], `2026-10-0${i + 1}T00:00:00Z`));
    expect(selectNewerRelated(unit, entries, now).length).toBe(5);
  });
});

describe('ReconsolidatePipeline.runOnce', () => {
  const makePipeline = (opts: { verdict: string; budgetDeny?: boolean; related?: string[] }) => {
    const queue = new InMemoryReconsolidationQueue();
    queue.mark('m1', 'retrieved');
    const prompts: string[] = [];
    const written: any[] = [];
    const unit = {
      id: 'm1', type: 'semantic', primary_abstraction: 'abs m1', cue_anchors: ['gateway'],
      memory_value: '旧事实', energy: 0.8, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    };
    const relatedIds = opts.related ?? ['m2'];
    const pipe = new ReconsolidatePipeline({
      queue,
      index: { getIndex: () => ({ entries: relatedIds.map((id) => entry(id, ['gateway'], '2026-10-05T00:00:00Z')) }) } as any,
      readMemory: async (id) => (id === 'm1' ? unit as any : null),
      readRelated: async (id) => ({ id, memory_value: `新事实 ${id}` } as any),
      worker: { prompt: async (p: string) => { prompts.push(p); return opts.verdict; } } as any,
      writeSuperseding: async (oldId, content) => { written.push({ oldId, content }); return 'new-id'; },
      budget: { allow: () => !opts.budgetDeny },
      maxPerRun: 10,
    });
    return { pipe, prompts, written, queue };
  };

  test('rewrite verdict → supersedes chain write + consume', async () => {
    const { pipe, written, queue } = makePipeline({ verdict: '{"action":"rewrite","content":"新事实 m2 已取代旧事实"}' });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 1, rewritten: 1, skipped: 0 });
    expect(written[0].oldId).toBe('m1');
    expect(queue.isEligible('m1')).toBe(false);
  });

  test('keep verdict → no write, still consumed', async () => {
    const { pipe, written, queue } = makePipeline({ verdict: '{"action":"keep"}' });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 1, rewritten: 0, skipped: 0 });
    expect(written.length).toBe(0);
    expect(queue.isEligible('m1')).toBe(false);
  });

  test('budget deny → zero work, queue untouched', async () => {
    const { pipe, queue } = makePipeline({ verdict: '{}', budgetDeny: true });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 0, rewritten: 0, skipped: 0 });
    expect(queue.isEligible('m1')).toBe(true);
  });

  test('worker garbage JSON → skipped, consumed (no retry storm)', async () => {
    const { pipe, queue } = makePipeline({ verdict: 'not json' });
    const r = await pipe.runOnce();
    expect(r.skipped).toBe(1);
    expect(queue.isEligible('m1')).toBe(false);
  });

  test('no newer related → skip without worker call', async () => {
    const { pipe, prompts } = makePipeline({ verdict: '{}', related: [] });
    const r = await pipe.runOnce();
    expect(r).toEqual({ checked: 0, rewritten: 0, skipped: 1 });
    expect(prompts.length).toBe(0);
  });
});
