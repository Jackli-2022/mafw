import { StaleVerifyPipeline, STALE_VERIFY_SYSTEM } from '../../src/recall/stale-verify';

const DAY_MS = 24 * 60 * 60 * 1000;

function entry(over: Partial<any>): any {
  return {
    id: 'mem_x',
    type: 'procedural',
    primary_abstraction: 'some lesson',
    cue_anchors: [],
    tier: 'procedural',
    energy: 0.8,
    salience: 1,
    created_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
    ...over,
  };
}

function makePipeline(entries: any[], opts: Partial<any> = {}) {
  const prompts: string[] = [];
  const systems: string[] = [];
  const stamps: string[] = [];
  const index: any = {
    getIndex: () => ({ entries }),
    stampReview: (id: string) => stamps.push(id),
  };
  const readMemory = async (id: string) => ({ id, memory_value: `content of ${id}` });
  const worker: any = {
    prompt: async (message: string, system?: string) => {
      prompts.push(message);
      systems.push(system ?? '');
      return opts.reply ?? '[STALE-REVIEW: checked=2 superseded=1]';
    },
  };
  const pipeline = new StaleVerifyPipeline({
    index,
    readMemory,
    worker,
    now: Date.now(),
    ...opts.pipelineOpts,
  });
  return { pipeline, prompts, systems, stamps };
}

describe('StaleVerifyPipeline candidate selection', () => {
  it('selects only procedural and semantic entries', () => {
    const { pipeline } = makePipeline([
      entry({ id: 'p1', type: 'procedural' }),
      entry({ id: 's1', type: 'semantic' }),
      entry({ id: 'e1', type: 'episodic' }),
      entry({ id: 'g1', type: 'global' }),
    ]);
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['p1', 's1']));
    expect(ids).not.toContain('e1');
    expect(ids).not.toContain('g1');
  });

  it('excludes superseded entries', () => {
    const { pipeline } = makePipeline([
      entry({ id: 'live' }),
      entry({ id: 'dead', superseded_by: 'mem_newer' }),
    ]);
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids).toContain('live');
    expect(ids).not.toContain('dead');
  });

  it('excludes entries younger than minAgeDays', () => {
    const { pipeline } = makePipeline(
      [
        entry({ id: 'old', created_at: new Date(Date.now() - 30 * DAY_MS).toISOString() }),
        entry({ id: 'fresh', created_at: new Date(Date.now() - 2 * DAY_MS).toISOString() }),
      ],
      { pipelineOpts: { minAgeDays: 14 } },
    );
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids).toContain('old');
    expect(ids).not.toContain('fresh');
  });

  it('ranks by energy × salience and caps at topK', () => {
    const entries = [
      entry({ id: 'low', energy: 0.2, salience: 1 }),
      entry({ id: 'high', energy: 0.9, salience: 2 }),
      entry({ id: 'mid', energy: 0.5, salience: 1 }),
    ];
    const { pipeline } = makePipeline(entries, { pipelineOpts: { topK: 2 } });
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids).toEqual(['high', 'mid']);
  });

  it('A1: excludes entries reviewed within minReviewIntervalDays', () => {
    const { pipeline } = makePipeline([
      entry({ id: 'never', energy: 0.8 }),
      entry({ id: 'recent', energy: 0.8, last_reviewed: new Date(Date.now() - 3 * DAY_MS).toISOString() }),
      entry({ id: 'longago', energy: 0.8, last_reviewed: new Date(Date.now() - 40 * DAY_MS).toISOString() }),
    ]);
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids).toContain('never');
    expect(ids).toContain('longago');
    expect(ids).not.toContain('recent');
  });

  it('A1: never-reviewed entries sort before reviewed ones at equal energy×salience', () => {
    const { pipeline } = makePipeline([
      entry({ id: 'seen', energy: 0.8, review_count: 5 }),
      entry({ id: 'unseen', energy: 0.8 }),
    ]);
    const ids = pipeline.selectCandidates().map((e: any) => e.id);
    expect(ids[0]).toBe('unseen');
  });
});

describe('STALE_VERIFY_SYSTEM prompt', () => {
  it('instructs read-only verification and supersede-on-contradiction', () => {
    expect(STALE_VERIFY_SYSTEM).toMatch(/verify/i);
    expect(STALE_VERIFY_SYSTEM).toMatch(/read\/grep\/glob/);
    expect(STALE_VERIFY_SYSTEM).toContain('mafw_supersede_memory');
    expect(STALE_VERIFY_SYSTEM).toContain('supersedes');
    expect(STALE_VERIFY_SYSTEM).toContain('[STALE-REVIEW:');
  });
});

describe('StaleVerifyPipeline.runOnce', () => {
  it('does nothing when there are no candidates', async () => {
    const { pipeline, prompts } = makePipeline([entry({ id: 'e1', type: 'episodic' })]);
    const res = await pipeline.runOnce();
    expect(prompts).toHaveLength(0);
    expect(res).toEqual({ candidates: 0, checked: 0, superseded: 0, failed: false });
  });

  it('sends candidate ids and contents to the worker and parses the result marker', async () => {
    const { pipeline, prompts } = makePipeline([
      entry({ id: 'mem_a' }),
      entry({ id: 'mem_b' }),
    ]);
    const res = await pipeline.runOnce();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('mem_a');
    expect(prompts[0]).toContain('content of mem_a');
    expect(prompts[0]).toContain('mem_b');
    expect(res).toEqual({ candidates: 2, checked: 2, superseded: 1, failed: false });
  });

  it('tolerates a missing result marker', async () => {
    const { pipeline } = makePipeline([entry({ id: 'mem_a' })], { reply: 'done, no marker' });
    const res = await pipeline.runOnce();
    expect(res.failed).toBe(false);
    expect(res.candidates).toBe(1);
    expect(res.checked).toBe(0);
    expect(res.superseded).toBe(0);
  });

  it('reports failure instead of throwing when the worker fails', async () => {
    const entries = [entry({ id: 'mem_a' })];
    const index: any = { getIndex: () => ({ entries }) };
    const pipeline = new StaleVerifyPipeline({
      index,
      readMemory: async (id: string) => ({ id, memory_value: 'x' }),
      worker: { prompt: async () => { throw new Error('worker down'); } },
      now: Date.now(),
    });
    const res = await pipeline.runOnce();
    expect(res.failed).toBe(true);
    expect(res.candidates).toBe(1);
  });

  it('A1: stamps reviewed candidates after a successful pass', async () => {
    const { pipeline, stamps } = makePipeline([
      entry({ id: 'mem_a' }),
      entry({ id: 'mem_b' }),
    ]);
    await pipeline.runOnce();
    expect(stamps.sort()).toEqual(['mem_a', 'mem_b']);
  });

  it('A1: does not stamp when the worker fails', async () => {
    const { pipeline, stamps } = makePipeline([entry({ id: 'mem_a' })], {
      reply: undefined,
      pipelineOpts: {},
    });
    // worker that throws
    (pipeline as any).opts.worker = { prompt: async () => { throw new Error('down'); } };
    await pipeline.runOnce();
    expect(stamps).toHaveLength(0);
  });
});
