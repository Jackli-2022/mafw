/**
 * P2: ConsolidationService — embedding candidate recall + LLM UPDATE/CREATE
 * judge + in-place merge (Memora-style consolidation) + update-ratio stats.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConsolidationService } from '../../src/memory/consolidation-service';
import { MemoryVectorStore } from '../../src/memory/vector-store';
import { EmbeddingProvider } from '../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-consolidation-'));
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
  const superseded: Array<{ id: string; byId: string }> = [];
  const writes: HarmonicUnit[] = [];
  return {
    byId,
    superseded,
    writes,
    async read(id: string) { return byId.get(id) ?? null; },
    async write(u: HarmonicUnit) { byId.set(u.id, u); writes.push(u); return 'file.md'; },
    async markSuperseded(id: string, by: string) { superseded.push({ id, byId: by }); },
  };
}

function vecProvider(map: Record<string, number[]>): EmbeddingProvider {
  return {
    name: 'stub',
    dims: 2,
    embed: async (texts) => texts.map(t => {
      const v = map[t];
      if (!v) throw new Error('no vec ' + t);
      return v;
    }),
  };
}

describe('ConsolidationService', () => {
  test('no vector for the unit → skip', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const svc = new ConsolidationService({ store: stubStore([]) as any, vectors, provider: vecProvider({}) });
    const outcome = await svc.consolidate(unit('u1', 'a', 'v'));
    expect(outcome.action).toBe('skip');
  });

  test('no candidates above minCosine → create', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('other', [0, 1]); // orthogonal
    const svc = new ConsolidationService({ store: stubStore([]) as any, vectors, provider: vecProvider({}) });
    const outcome = await svc.consolidate(unit('u1', 'a', 'v'));
    expect(outcome.action).toBe('create');
  });

  test('LLM judge says update → merge into newer, supersede target, remove stale vector', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);

    const target = unit('old', 'Existing memory', 'existing value');
    const store = stubStore([target]);

    const fetchFn = (async (_url: any, init: any) => ({
      ok: true,
      status: 200,
      json: async () => {
        const body = JSON.parse(init.body);
        expect(body.messages[1].content).toContain('u1');
        return {
          choices: [{ message: { content: '{"action":"update","target_id":"old"}' } }],
        };
      },
    })) as any;

    const svc = new ConsolidationService({
      store: store as any,
      vectors,
      provider: vecProvider({}),
      llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchFn },
    });

    const incoming = unit('u1', 'New memory', 'new value');
    const outcome = await svc.consolidate(incoming);

    expect(outcome.action).toBe('update');
    expect(store.writes).toHaveLength(1);
    const merged = store.writes[0];
    expect(merged.id).toBe('u1');
    expect(merged.memory_value).toContain('new value');
    expect(merged.memory_value).toContain('existing value');
    expect(merged.merged_from).toContain('old');
    expect(store.superseded).toEqual([{ id: 'old', byId: 'u1' }]);
    expect(vectors.get('old')).toBeUndefined();
    expect(svc.getStats().updates).toBe(1);
    expect(svc.getStats().updateRatio).toBe(1);
  });

  test('LLM judge says create → no writes', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);
    const store = stubStore([unit('old', 'Existing', 'val')]);

    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"action":"create"}' } }] }),
    })) as any;

    const svc = new ConsolidationService({
      store: store as any,
      vectors,
      provider: vecProvider({}),
      llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchFn },
    });

    const outcome = await svc.consolidate(unit('u1', 'New', 'val2'));
    expect(outcome.action).toBe('create');
    expect(store.writes).toHaveLength(0);
    expect(store.superseded).toHaveLength(0);
    expect(svc.getStats().creates).toBe(1);
  });

  test('LLM failure → skip (fail-open)', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);
    const fetchFn = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    const svc = new ConsolidationService({
      store: stubStore([unit('old', 'E', 'v')]) as any,
      vectors,
      provider: vecProvider({}),
      llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchFn },
    });
    const outcome = await svc.consolidate(unit('u1', 'N', 'v2'));
    expect(outcome.action).toBe('skip');
  });

  test('no llm configured → skip with reason', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);
    const svc = new ConsolidationService({
      store: stubStore([unit('old', 'E', 'v')]) as any,
      vectors,
      provider: vecProvider({}),
    });
    const outcome = await svc.consolidate(unit('u1', 'N', 'v2'));
    expect(outcome.action).toBe('skip');
    expect((outcome as any).reason).toMatch(/judge/i);
  });

  test('judge target_id outside candidates → skip', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('u1', [1, 0]);
    vectors.upsert('old', [0.99, 0.1]);
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"action":"update","target_id":"evil-id"}' } }] }),
    })) as any;
    const svc = new ConsolidationService({
      store: stubStore([unit('old', 'E', 'v')]) as any,
      vectors,
      provider: vecProvider({}),
      llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchFn },
    });
    const outcome = await svc.consolidate(unit('u1', 'N', 'v2'));
    expect(outcome.action).toBe('skip');
  });

  test('enqueue processes units serially and survives errors', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    const svc = new ConsolidationService({
      store: stubStore([]) as any,
      vectors,
      provider: vecProvider({}),
    });
    // unit without vector → skip path; must not throw
    await expect(svc.enqueue(unit('x1', 'a', 'v'))).resolves.toBeUndefined();
  });

  test('vector missing → embeds on demand (document kind) before recall', async () => {
    const dir = tmpDir();
    const vectors = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
    vectors.upsert('old', [0.99, 0.1]);
    const store = stubStore([unit('old', 'Existing', 'val')]);
    const embeddedKinds: string[] = [];
    const provider: EmbeddingProvider = {
      name: 'stub',
      dims: 2,
      embed: async (texts, kind) => {
        embeddedKinds.push(kind);
        return texts.map(() => [1, 0]);
      },
    };
    const fetchFn = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '{"action":"create"}' } }] }),
    })) as any;

    const svc = new ConsolidationService({
      store: store as any,
      vectors,
      provider,
      llm: { baseUrl: 'http://x', apiKey: 'k', model: 'm', fetchFn },
    });

    const outcome = await svc.consolidate(unit('u1', 'Fresh unit', 'fresh value'));
    expect(outcome.action).toBe('create');
    expect(embeddedKinds).toEqual(['document']);
    expect(vectors.get('u1')).toEqual([1, 0]); // vector persisted for future recall
  });
});
