/**
 * B1 prerequisite: judged-pair logging — every LLM-judge invocation emits the
 * (new unit, candidates+cosines, verdict) triple so the zero-update audit
 * (Plan B Task 2) has data. No candidates → no judge → no pair.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConsolidationService, JudgedPair } from '../../../src/memory/consolidation-service';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-consolidation-pairs-'));
}

function unit(id: string, abstraction: string, value: string): HarmonicUnit {
  return {
    id,
    type: 'semantic',
    primary_abstraction: abstraction,
    cue_anchors: [],
    memory_value: value,
    energy: 0.8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as HarmonicUnit;
}

function stubStore(units: HarmonicUnit[]) {
  const byId = new Map(units.map(u => [u.id, u]));
  return {
    byId,
    async read(id: string) { return byId.get(id) ?? null; },
    async write(u: HarmonicUnit) { byId.set(u.id, u); return 'file.md'; },
    async markSuperseded() { /* noop */ },
  };
}

const vecProvider: EmbeddingProvider = {
  name: 'stub',
  dims: 2,
  embed: async (texts) => texts.map(() => [1, 0]),
};

describe('ConsolidationService judged-pair logging', () => {
  test('emits a JudgedPair for every judged call with candidates and cosines', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]); // cosine ≈ 0.995 with u1

    const pairs: JudgedPair[] = [];
    const fetchFn = (async (_url: any, _init: any) => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"action":"create"}' } }],
      }),
    })) as any;

    const svc = new ConsolidationService({
      store: stubStore([unit('old', 'Existing memory', 'existing value')]) as any,
      vectors,
      provider: vecProvider,
      llm: { baseUrl: 'http://stub', apiKey: 'k', model: 'm', fetchFn },
      onPair: (p) => pairs.push(p),
    });

    await svc.consolidate(unit('u1', 'New memory about deploy', 'new value'));

    expect(pairs).toHaveLength(1);
    expect(pairs[0].newId).toBe('u1');
    expect(pairs[0].newAbstraction).toBe('New memory about deploy');
    expect(pairs[0].candidates).toHaveLength(1);
    expect(pairs[0].candidates[0].id).toBe('old');
    expect(pairs[0].candidates[0].cosine).toBeGreaterThan(0.8);
    expect(pairs[0].verdict).toBe('create');
    expect(pairs[0].ts).toBeGreaterThan(0);
  });

  test('judge-error emits a pair with verdict skip', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);

    const pairs: JudgedPair[] = [];
    const fetchFn = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;

    const svc = new ConsolidationService({
      store: stubStore([unit('old', 'Existing', 'v')]) as any,
      vectors,
      provider: vecProvider,
      llm: { baseUrl: 'http://stub', apiKey: 'k', model: 'm', fetchFn },
      onPair: (p) => pairs.push(p),
    });

    await svc.consolidate(unit('u1', 'New', 'v'));
    expect(pairs).toHaveLength(1);
    expect(pairs[0].verdict).toBe('skip');
  });

  test('no candidates above minCosine → no pair emitted', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('other', [0, 1]); // orthogonal, below threshold

    const pairs: JudgedPair[] = [];
    const svc = new ConsolidationService({
      store: stubStore([]) as any,
      vectors,
      provider: vecProvider,
      onPair: (p) => pairs.push(p),
    });

    const outcome = await svc.consolidate(unit('u1', 'a', 'v'));
    expect(outcome.action).toBe('create');
    expect(pairs).toHaveLength(0);
  });

  test('audit H4: superseded candidates are filtered out before the judge', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('dead', [0.99, 0.1]); // high cosine but superseded

    const store = stubStore([]);
    (store.byId as Map<string, HarmonicUnit>).set('dead', {
      ...unit('dead', 'Old memory', 'v'),
      superseded_by: 'mem_newer',
    });

    const pairs: JudgedPair[] = [];
    const svc = new ConsolidationService({
      store: store as any,
      vectors,
      provider: vecProvider,
      onPair: (p) => pairs.push(p),
    });

    const outcome = await svc.consolidate(unit('u1', 'a', 'v'));
    // The only candidate is dead → no judge call at all → plain create, no pair.
    expect(outcome.action).toBe('create');
    expect(pairs).toHaveLength(0);
    expect(svc.getStats().judged).toBe(0);
  });

  test('audit H4: orphan vectors (unit unreadable) are filtered out too', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('orphan', [0.99, 0.1]); // vector exists, no unit file

    const pairs: JudgedPair[] = [];
    const svc = new ConsolidationService({
      store: stubStore([]) as any,
      vectors,
      provider: vecProvider,
      onPair: (p) => pairs.push(p),
    });

    const outcome = await svc.consolidate(unit('u1', 'a', 'v'));
    expect(outcome.action).toBe('create');
    expect(pairs).toHaveLength(0);
    expect(svc.getStats().judged).toBe(0);
  });
});
