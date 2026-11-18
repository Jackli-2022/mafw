/**
 * P1: deterministic exact-evidence admission.
 *
 * The boundary FOK gate reads only the raw BM25 top1/mean ratio, which goes
 * flat when several candidates tie (the `5cd9885f5` divergence). Exact,
 * externally verifiable evidence — a full title, a whole-query identifier, or
 * a distinctive contained cue — may admit its target even when the ratio zone
 * is `no-memory`. Ordinary low-confidence candidates stay suppressed, and
 * superseded / retracted / legacy-episodic entries never gain admission.
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachRecallRoutes } from '../../../src/routes/recall';
import { config } from '../../../src/config';
import type { RecallMemory } from '../../../src/recall/recall-context';
import { formatRecallContext } from '../../../src/recall/inject-format';
import { hasRelatedRecallBody } from '../../../src/recall/topic-recall';
import {
  applyExactRecallEvidence,
  findExactRecallEvidence,
} from '../../../src/recall/exact-evidence';

function entry(overrides: Record<string, any> = {}): any {
  return {
    id: 'mem_default',
    type: 'semantic',
    primary_abstraction: 'default abstraction',
    cue_anchors: [],
    memory_value: 'default value',
    energy: 0.8,
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function memory(overrides: Partial<RecallMemory> = {}): RecallMemory {
  return {
    id: 'mem_candidate',
    primary_abstraction: 'candidate',
    memory_value: 'candidate value',
    energy: 0.8,
    score: 0.5,
    ...overrides,
  };
}

describe('findExactRecallEvidence', () => {
  test('admits an active exact identifier even when the FOK zone says no-memory', () => {
    // The frozen divergence probe: three same-strength candidates flatten the
    // ratio, but every one of the target memories carries `5cd9885f5` verbatim.
    const exact = entry({
      id: 'mem_exact_5cd9885f5',
      primary_abstraction: 'live retrieval effect diverges from disk inspection',
      cue_anchors: ['2026-11-18-live-retrieval-effect', '5cd9885f5', 'REST/MCP'],
    });
    const entries = [
      entry({ id: 'mem_flat_1', cue_anchors: ['flat-candidate-one'] }),
      entry({ id: 'mem_flat_2', cue_anchors: ['flat-candidate-two'] }),
      entry({ id: 'mem_flat_3', cue_anchors: ['flat-candidate-three'] }),
      exact,
    ];

    const evidence = findExactRecallEvidence(entries, '5cd9885f5');
    expect(evidence).toHaveLength(1);
    expect(evidence[0].entry.id).toBe(exact.id);
    expect(evidence[0].kind).toBe('identifier');

    const candidates = [
      memory({ id: 'mem_flat_1' }),
      memory({ id: 'mem_flat_2' }),
      memory({ id: 'mem_flat_3' }),
    ];
    const applied = applyExactRecallEvidence(candidates, evidence, 'no-memory');
    expect(applied.status).toBe('inject');
    expect(applied.memories[0].id).toBe(exact.id);
    expect(applied.exactIds).toEqual([exact.id]);
    expect(applied.memories).toHaveLength(3); // bounded topK
  });

  test('admits full normalized title equality', () => {
    const target = entry({
      id: 'mem_title_target',
      primary_abstraction: 'Proactive   TOPIC   Recall',
      cue_anchors: ['unrelated-anchor'],
    });
    const evidence = findExactRecallEvidence(
      [entry({ id: 'mem_other' }), target],
      'proactive topic recall',
    );
    expect(evidence.map(e => e.entry.id)).toEqual([target.id]);
    expect(evidence[0].kind).toBe('title');
    expect(applyExactRecallEvidence([], evidence, 'low-confidence').status).toBe('inject');
  });

  test('admits a distinctive contained cue under the length / DF / coverage rules', () => {
    const query = 'Proactive Topic Recall 主题工具设计';
    const byCue = entry({
      id: 'mem_proactive_topic',
      primary_abstraction: '个人记忆重设计与主题召回首刀',
      cue_anchors: ['mafw_topic_set', 'proactive topic'],
    });
    const evidence = findExactRecallEvidence(
      [byCue, entry({ id: 'mem_unrelated', cue_anchors: ['billing'] })],
      query,
    );
    expect(evidence.map(e => e.entry.id)).toContain(byCue.id);
    const hit = evidence.find(e => e.entry.id === byCue.id)!;
    expect(hit.kind).toBe('cue');
    // "proactive topic" = 14 ASCII chars, DF 1, covers 14/26 query chars.
    expect(hit.specificity).toBeGreaterThan(1);
    expect(hit.specificity).toBeLessThan(2);
  });

  test('rejects generic, short, and merely-overlapping cues', () => {
    const query = 'Proactive Topic Recall 主题工具设计';
    // DF 6: too common to identify a target on its own.
    const generic = Array.from({ length: 6 }, (_, i) =>
      entry({ id: `mem_generic_${i}`, cue_anchors: ['proactive topic'] }),
    );
    const shortCue = entry({ id: 'mem_short_cue', cue_anchors: ['topic'] });
    const partialOverlap = entry({ id: 'mem_partial', cue_anchors: ['proactive recall'] });

    const evidence = findExactRecallEvidence([...generic, shortCue, partialOverlap], query);
    expect(evidence).toEqual([]);

    // DF counts documents, not occurrences: five entries where one repeats the
    // anchor stays at DF 5 (admissible), even though there are six anchor texts.
    const fiveDocuments = [
      ...Array.from({ length: 4 }, (_, i) =>
        entry({ id: `mem_doc_${i}`, cue_anchors: ['proactive topic'] }),
      ),
      entry({ id: 'mem_doc_repeat', cue_anchors: ['proactive topic', 'proactive topic'] }),
    ];
    const fiveDocEvidence = findExactRecallEvidence(fiveDocuments, query);
    expect(fiveDocEvidence).toHaveLength(3);
    expect(fiveDocEvidence.every(e => e.kind === 'cue')).toBe(true);

    const candidates = [memory({ id: 'mem_generic_0' }), memory({ id: 'mem_short_cue' })];
    const applied = applyExactRecallEvidence(candidates, evidence, 'low-confidence');
    expect(applied.status).toBe('low-confidence');
    expect(applied.exactIds).toEqual([]);
    expect(applied.memories.map(m => m.id)).toEqual(['mem_generic_0', 'mem_short_cue']);
  });

  test('excludes superseded, retracted, and unpinned legacy-episodic entries', () => {
    const superseded = entry({
      id: 'mem_superseded',
      cue_anchors: ['5cd9885f5'],
      superseded_by: 'mem_replacement',
    });
    const retracted = entry({
      id: 'mem_retracted',
      cue_anchors: ['5cd9885f5'],
      retracted: true,
    });
    const legacyEpisodic = entry({
      id: 'mem_legacy_episodic',
      type: 'episodic',
      cue_anchors: ['5cd9885f5'],
    });
    const replacement = entry({
      id: 'mem_replacement',
      type: 'semantic',
      cue_anchors: ['5cd9885f5'],
    });
    const pinnedEpisodic = entry({
      id: 'mem_pinned_episodic',
      type: 'episodic',
      pinned: true,
      cue_anchors: ['5cd9885f5'],
    });
    const stickyEpisodic = entry({
      id: 'mem_sticky_episodic',
      type: 'episodic',
      sticky_until: '2099-01-01T00:00:00.000Z',
      cue_anchors: ['5cd9885f5'],
    });

    const ids = findExactRecallEvidence(
      [superseded, retracted, legacyEpisodic, replacement, pinnedEpisodic, stickyEpisodic],
      '5cd9885f5',
      10,
    ).map(e => e.entry.id);

    expect(ids).toEqual(['mem_pinned_episodic', 'mem_replacement', 'mem_sticky_episodic']);
    expect(ids).not.toContain(superseded.id);
    expect(ids).not.toContain(retracted.id);
    expect(ids).not.toContain(legacyEpisodic.id);
  });

  test('rejects a contained cue that covers under half of the query', () => {
    const query = 'Proactive Topic Recall 主题工具设计 with a very long unrelated trailing clause for coverage';
    const longCue = entry({
      id: 'mem_long_cue',
      cue_anchors: ['proactive topic recall'],
    });
    // 20 ASCII chars, DF 1 and contained, but far below 50% of the query.
    expect(findExactRecallEvidence([longCue], query)).toEqual([]);
    // Same cue on the short query clears the coverage rule: only coverage differs.
    expect(
      findExactRecallEvidence([longCue], 'Proactive Topic Recall 主题工具设计').map(e => e.entry.id),
    ).toEqual([longCue.id]);
  });

  test('admits a 6-CJK contained cue but rejects a 5-CJK one', () => {
    const positive = entry({
      id: 'mem_cjk6',
      primary_abstraction: '另一条标题',
      cue_anchors: ['主题召回边界'],
    });
    const negative = entry({
      id: 'mem_cjk5',
      primary_abstraction: '又一条标题',
      cue_anchors: ['主题召回边'],
    });
    const query = '主题召回边界怎么改';
    expect(findExactRecallEvidence([positive, negative], query).map(e => e.entry.id)).toEqual([
      positive.id,
    ]);
  });

  test('picks up a replaced cue_anchors array on the same entry object', () => {
    const target = entry({ id: 'mem_swap', cue_anchors: ['legacy-anchor'] });
    expect(findExactRecallEvidence([target], '5cd9885f5')).toEqual([]);

    // Production writers (kernel dupCandidate / gliner harvest) can assign a
    // fresh anchors array to the same entry object; the cache must follow it.
    target.cue_anchors = ['5cd9885f5'];
    expect(findExactRecallEvidence([target], '5cd9885f5').map(e => e.entry.id)).toEqual([target.id]);

    target.cue_anchors = ['legacy-anchor'];
    expect(findExactRecallEvidence([target], '5cd9885f5')).toEqual([]);
  });

  test('keeps true no-answer queries and ordinary low-confidence candidates suppressed', () => {
    const query = '冰岛十月份消费和旅游预算怎么样';
    const adjacent = entry({
      id: 'mem_iceland_adjacent',
      primary_abstraction: '冰岛旅行',
      cue_anchors: ['旅行', '预算'],
    });
    expect(findExactRecallEvidence([adjacent], query)).toEqual([]);

    const candidates = [
      memory({ id: 'mem_weak_1', primary_abstraction: 'unrelated weak link' }),
      memory({ id: 'mem_weak_2', primary_abstraction: 'another weak link' }),
    ];
    const noAnswer = applyExactRecallEvidence(candidates, [], 'no-memory');
    expect(noAnswer.status).toBe('no-memory');
    expect(noAnswer.memories.map(m => m.id)).toEqual(['mem_weak_1', 'mem_weak_2']);

    // The existing exit policy still withholds non-inject recall bodies.
    expect(hasRelatedRecallBody(
      formatRecallContext(candidates, { status: 'no-memory' }).pointers,
      'no-memory',
    )).toBe(false);
    expect(hasRelatedRecallBody(
      formatRecallContext(candidates, { status: 'low-confidence' }).pointers,
      'low-confidence',
    )).toBe(false);
  });
});

describe('applyExactRecallEvidence', () => {
  test('merges exact matches ahead, deduplicates, and bounds to topK deterministically', () => {
    const exactA = entry({ id: 'mem_a', created_at: '2000-01-01T00:00:00.000Z' });
    const exactB = entry({ id: 'mem_b', created_at: '2030-01-01T00:00:00.000Z' });
    const exactC = entry({ id: 'mem_c', created_at: '2020-01-01T00:00:00.000Z' });
    const exactD = entry({ id: 'mem_d', created_at: '2010-01-01T00:00:00.000Z' });
    const evidence = [
      { entry: exactC, kind: 'cue' as const, specificity: 1.3 },
      { entry: exactA, kind: 'title' as const, specificity: 3 },
      { entry: exactB, kind: 'cue' as const, specificity: 1.3 },
      { entry: exactA, kind: 'cue' as const, specificity: 1.3 }, // duplicate id
      { entry: exactD, kind: 'cue' as const, specificity: 2.5 },
    ];
    const candidates = [
      memory({ id: 'mem_candidate_1', score: 0.9 }),
      memory({ id: 'mem_b', score: 0.8, primary_abstraction: 'already ranked' }),
    ];

    const applied = applyExactRecallEvidence(candidates, evidence, 'no-memory', 3);
    // Specificity desc (3, 2.5, 1.3), then id — never recency (b is newest, c is older).
    expect(applied.memories.map(m => m.id)).toEqual(['mem_a', 'mem_d', 'mem_b']);
    expect(applied.exactIds).toEqual(['mem_a', 'mem_d', 'mem_b']);
    expect(new Set(applied.memories.map(m => m.id)).size).toBe(3);
    // An already-ranked exact entry keeps its existing memory object/score.
    expect(applied.memories.find(m => m.id === 'mem_b')!.primary_abstraction).toBe('already ranked');
    expect(applied.status).toBe('inject');
  });

  test('ties break by id, not by input order or created_at', () => {
    const z = entry({ id: 'mem_z', created_at: '2030-01-01T00:00:00.000Z' });
    const a = entry({ id: 'mem_a', created_at: '2000-01-01T00:00:00.000Z' });
    const applied = applyExactRecallEvidence([], [
      { entry: z, kind: 'cue', specificity: 1.3 },
      { entry: a, kind: 'cue', specificity: 1.3 },
    ], 'low-confidence');
    expect(applied.memories.map(m => m.id)).toEqual(['mem_a', 'mem_z']);
  });

  test('does not reorder or admit anything when the raw FOK zone is already inject', () => {
    const exact = entry({ id: 'mem_exact_only' });
    const candidates = [
      memory({ id: 'mem_bm25_1', primary_abstraction: 'first ranked' }),
      memory({ id: 'mem_bm25_2', primary_abstraction: 'second ranked' }),
    ];
    const applied = applyExactRecallEvidence(
      candidates,
      [{ entry: exact, kind: 'title', specificity: 3 }],
      'inject',
    );
    expect(applied.status).toBe('inject');
    expect(applied.exactIds).toEqual([]);
    expect(applied.memories).toBe(candidates);
    expect(applied.memories.map(m => m.id)).toEqual(['mem_bm25_1', 'mem_bm25_2']);
  });

  test('equal-specificity evidence prefers owners already in the BM25 candidates', () => {
    const owners = [1, 2, 3, 4, 5].map(i => entry({ id: `mem_owner_${i}` }));
    const evidence = [owners[4], owners[0], owners[3], owners[1], owners[2]].map(e => ({
      entry: e,
      kind: 'cue' as const,
      specificity: 1.4,
    }));
    const candidates = [memory({ id: 'mem_owner_5' }), memory({ id: 'mem_owner_2' })];

    const first = applyExactRecallEvidence(candidates, evidence, 'low-confidence', 3);
    // Two existing owners outrank the new owners; id breaks the tie among both
    // groups (owner_2 before owner_5, owner_1 before owner_3/4). No recency.
    expect(first.memories.map(m => m.id)).toEqual(['mem_owner_2', 'mem_owner_5', 'mem_owner_1']);

    const second = applyExactRecallEvidence(candidates, evidence.slice().reverse(), 'low-confidence', 3);
    expect(second.memories.map(m => m.id)).toEqual(first.memories.map(m => m.id));
    expect(second.exactIds).toEqual(first.exactIds);
  });
});

// ---- Route-level contract: only the live path may consume exact evidence ----

function fakeReq(url: string, method = 'GET'): IncomingMessage {
  return {
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on() { return this; },
  } as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string } {
  const out = { res: null as unknown as ServerResponse, status: 0, body: '' };
  out.res = {
    writeHead: (status: number) => { out.status = status; },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return out;
}

function routeHarness(entries: any[], options: { rawScores?: number[] } = {}) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const flatIds = entries.filter(e => e.id.startsWith('mem_flat_')).map(e => e.id);
  const index = {
    getIndex: () => ({ entries }),
    // Default: flat raw distribution -> FOK no-memory, the divergence shape.
    bm25RawScores: () => options.rawScores ?? [1, 1, 1, 1],
    searchScored: () => flatIds.map(id => ({ entry: byId.get(id), score: 1 })),
    search: () => flatIds.map(id => byId.get(id)),
  };
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachRecallRoutes(registry, {
    buildInstructionBlocks: async () => ({ revision: '', memoryGuide: '', userProfile: '', agentPriors: '' }),
    instructionSync: () => null,
    memoryService: () => ({ harmonicIndex: index }) as any,
    recallCalledBySession: () => new Map<string, number>(),
    leadSessionRegistry: () => ({ findBySessionId: () => null }) as any,
    registeredProjects: () => new Map(),
    mafwDir: () => require('os').tmpdir(),
    getGatewayDb: () => ({ kvGet: () => null }) as any,
    getScanService: () => null,
  });
  return {
    handler: (url: string) => {
      const match = registry.match('GET', url as never);
      return (req: IncomingMessage, res: ServerResponse) => match!.def.handler!(req, res, match!.params);
    },
  };
}

describe('recall.context exact-evidence wiring', () => {
  const original = {
    fok: { ...config.search.fok },
    snapshot: { ...config.search.snapshot },
    arbiter: config.search.arbiter,
    boundaryDense: config.search.boundaryDense,
    temporalNeighbors: { ...config.search.temporalNeighbors },
  };

  beforeAll(() => {
    config.search.fok = { ...config.search.fok, enabled: true, low: 1.2, high: 1.35 };
    config.search.snapshot = { ...config.search.snapshot, enabled: false };
    config.search.arbiter = false;
    config.search.boundaryDense = false;
    config.search.temporalNeighbors = { ...config.search.temporalNeighbors, presentation: false };
  });

  afterAll(() => {
    config.search.fok = original.fok;
    config.search.snapshot = original.snapshot;
    config.search.arbiter = original.arbiter;
    config.search.boundaryDense = original.boundaryDense;
    config.search.temporalNeighbors = original.temporalNeighbors;
  });

  test('the 5cd9885f5 divergence shape now emits a related body containing the exact target', async () => {
    const exact = entry({
      id: 'mem_1794931298999_alpfjc',
      primary_abstraction: '线上检索效果与磁盘直查显著分叉',
      cue_anchors: ['2026-11-18-live-retrieval-effect', '5cd9885f5', 'REST/MCP'],
    });
    const entries = [
      entry({ id: 'mem_flat_1', primary_abstraction: 'flat one' }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'flat two' }),
      entry({ id: 'mem_flat_3', primary_abstraction: 'flat three' }),
      exact,
    ];
    const { handler } = routeHarness(entries);
    const res = fakeRes();
    const url = '/api/recall/context?sessionID=s1&query=5cd9885f5';
    await handler(url)(fakeReq(url), res.res);

    expect(res.status).toBe(200);
    const pointers = JSON.parse(res.body).pointers as string;
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).toContain('<recall>');
    expect(pointers).toContain(`#mem-${exact.id.slice(-6)}`);
  });

  test('an already-inject turn keeps BM25 order and never admits an exact-only entry', async () => {
    const exactOnly = entry({
      id: 'mem_exact_inject_target',
      primary_abstraction: 'exact but not ranked',
      cue_anchors: ['5cd9885f5'],
    });
    const entries = [
      entry({ id: 'mem_flat_1', primary_abstraction: 'first ranked' }),
      entry({ id: 'mem_flat_2', primary_abstraction: 'second ranked' }),
      entry({ id: 'mem_flat_3', primary_abstraction: 'third ranked' }),
      exactOnly,
    ];
    // Dominant top-1 -> raw FOK inject; the exact merge must be a no-op.
    const { handler } = routeHarness(entries, { rawScores: [10, 1, 1, 1] });
    const res = fakeRes();
    const url = '/api/recall/context?sessionID=s1&query=5cd9885f5';
    await handler(url)(fakeReq(url), res.res);

    expect(res.status).toBe(200);
    const pointers = JSON.parse(res.body).pointers as string;
    expect(pointers).toContain('相关记忆：见下方');
    expect(pointers).not.toContain(`#mem-${exactOnly.id.slice(-6)}`);
    expect(pointers.indexOf('#mem-flat_1')).toBeGreaterThanOrEqual(0);
    expect(pointers.indexOf('#mem-flat_2')).toBeGreaterThan(pointers.indexOf('#mem-flat_1'));
    expect(pointers.indexOf('#mem-flat_3')).toBeGreaterThan(pointers.indexOf('#mem-flat_2'));
  });

  test('a negative shape still reports no related memory and no body', async () => {
    const entries = [
      entry({ id: 'mem_flat_1', primary_abstraction: '冰岛邻域候选' }),
      entry({ id: 'mem_flat_2', primary_abstraction: '预算邻域候选' }),
      entry({ id: 'mem_flat_3', primary_abstraction: '旅行邻域候选' }),
    ];
    const { handler } = routeHarness(entries);
    const res = fakeRes();
    const url = `/api/recall/context?sessionID=s1&query=${encodeURIComponent('冰岛十月份消费和旅游预算怎么样')}`;
    await handler(url)(fakeReq(url), res.res);

    expect(res.status).toBe(200);
    const pointers = JSON.parse(res.body).pointers as string;
    expect(pointers).toContain('相关记忆：无');
    expect(pointers).not.toContain('<recall');
  });
});
