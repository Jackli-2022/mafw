import { ConsolidationService, JudgedPair } from '../../../src/memory/consolidation-service';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';

function makeUnit(id: string, value: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: 'abs ' + id, cue_anchors: ['a'],
    memory_value: value, energy: 0.8, created_at: '2026-09-29T00:00:00Z', updated_at: '2026-09-29T00:00:00Z',
  } as HarmonicUnit;
}

function makeHarness(opts: {
  p?: number | null;                // laya client 返回（undefined = 不配 laya）
  tauHigh?: number;
  tauLow?: number;
  llmVerdict?: string;              // LLM 判官 JSON 回复（undefined = 不配 LLM）
}) {
  const newUnit = makeUnit('new-1', '新事实');
  const pairs: JudgedPair[] = [];
  const written: any[] = [];
  const superseded: string[] = [];
  const store = {
    async read(id: string) {
      if (id === 'new-1') return newUnit;
      return makeUnit(id, `旧事实 ${id}`);
    },
    async write(u: any) { written.push(u); return u.id; },
    async markSuperseded(id: string) { superseded.push(id); },
  };
  const vectors = {
    get: () => [1, 0],
    searchByCosine: () => [{ id: 'old-1', cosine: 0.9 }],
    upsert: () => {}, remove: () => {}, flush: () => {},
  } as unknown as MemoryVectorStore;
  const provider = { embed: async () => [[1, 0]] } as unknown as EmbeddingProvider;
  const svc = new ConsolidationService({
    store: store as any, vectors, provider,
    llm: opts.llmVerdict !== undefined ? {
      baseUrl: 'http://judge.test', apiKey: 'k', model: 'm',
      fetchFn: (async () => new Response(
        JSON.stringify({ choices: [{ message: { content: opts.llmVerdict! } }] }), { status: 200 },
      )) as any,
    } : undefined,
    laya: opts.p !== undefined ? {
      client: { askConflict: async () => (opts.p ?? null) as any },
      tauHigh: opts.tauHigh ?? 0.85,
      tauLow: opts.tauLow,
    } : undefined,
    onPair: (pr) => pairs.push(pr),
  });
  return { svc, pairs, written, superseded, newUnit };
}

describe('redundant-sink guard (G2)', () => {
  it('skips units carrying a redundant: anchor (sunk by write-phase routing)', async () => {
    const svc = new ConsolidationService({
      store: { read: async () => null, write: async () => '', markSuperseded: () => {} } as any,
      vectors: {} as unknown as MemoryVectorStore,
      provider: {} as unknown as EmbeddingProvider,
    });
    const unit = makeUnit('sunk-1', 'sunk fact');
    unit.cue_anchors = ['x', 'redundant:mem_covering'];
    const out = await svc.consolidate(unit);
    expect(out).toEqual({ action: 'skip', reason: 'redundant-sink' });
  });
});

describe('laya one-sided cascade', () => {
  it('adopts UPDATE when p >= tauHigh (no LLM call)', async () => {
    const h = makeHarness({ p: 0.95 });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update');
    if (out.action === 'update') expect(out.targetId).toBe('old-1');
    expect(h.pairs[0].decidedBy).toBe('laya');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.95 }]);
    expect(h.written[0].merged_from).toContain('old-1');
    expect(h.superseded).toContain('old-1');
    const s = h.svc.getStats();
    expect(s.layaAdopted).toBe(1);
    expect(s.updates).toBe(1);
    expect(s.judged).toBe(0); // LLM 从未被调用
  });

  it('adopts UPDATE with laya alone (no LLM configured)', async () => {
    const h = makeHarness({ p: 0.95 }); // llmVerdict undefined → 无 LLM
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update');
  });

  it('escalates to LLM on middle band, scores attached to pair', async () => {
    const h = makeHarness({ p: 0.5, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.5 }]);
    const s = h.svc.getStats();
    expect(s.layaEscalated).toBe(1);
    expect(s.judged).toBe(1);
  });

  it('escalates when client returns null (sidecar down), no scores', async () => {
    const h = makeHarness({ p: null, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toBeUndefined();
  });

  it('no laya deps → legacy behavior (regression guard)', async () => {
    const h = makeHarness({ llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.pairs[0].layaScores).toBeUndefined();
    expect(h.svc.getStats().judged).toBe(1);
  });
});

describe('laya three-way gate (tauLow)', () => {
  it('CREATEs directly when ALL candidate scores <= tauLow (no LLM call)', async () => {
    const h = makeHarness({ p: 0.05, tauLow: 0.1, llmVerdict: '{"action":"update","targetId":"old-1"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('laya-low');
    expect(h.pairs[0].layaScores).toEqual([{ id: 'old-1', p: 0.05 }]);
    const s = h.svc.getStats() as any;
    expect(s.layaCreated).toBe(1);
    expect(s.creates).toBe(1);
    expect(s.judged).toBe(0);
  });

  it('tauLow = 0 (default) keeps legacy escalation', async () => {
    const h = makeHarness({ p: 0.05, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
    expect(h.svc.getStats().judged).toBe(1);
  });

  it('middle band (tauLow < p < tauHigh) still escalates to LLM', async () => {
    const h = makeHarness({ p: 0.5, tauLow: 0.1, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
  });

  it('client null (sidecar down) never auto-CREATEs', async () => {
    const h = makeHarness({ p: null, tauLow: 0.1, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('create');
    expect(h.pairs[0].decidedBy).toBe('llm');
  });

  it('tauHigh still wins over tauLow when both would match', async () => {
    const h = makeHarness({ p: 0.95, tauHigh: 0.85, tauLow: 0.99, llmVerdict: '{"action":"create"}' });
    const out = await h.svc.consolidate(h.newUnit);
    expect(out.action).toBe('update');
    expect(h.pairs[0].decidedBy).toBe('laya');
  });
});
