/**
 * S1: 三态路由决策（skip/create/update）— 写时路由纯函数。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { decideRouting } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-route-'));
}

function u(id: string): HarmonicUnit {
  return {
    id,
    type: 'semantic',
    primary_abstraction: id,
    cue_anchors: [],
    memory_value: id,
    energy: 0.8,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as HarmonicUnit;
}

const provider: EmbeddingProvider = {
  name: 'stub',
  dims: 2,
  embed: async (texts) => texts.map(() => [1, 0]),
};

describe('decideRouting', () => {
  test('no candidates → create (no judge call)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('x', [0, 1]);
    let judged = 0;
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged++; return null; } });
    expect(out.action).toBe('create');
    expect(judged).toBe(0);
  });

  test('cos >= dupCosine → skip with targetId (no judge call)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('dup', [1, 0]); // cos = 1.0
    let judged = 0;
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged++; return null; } });
    expect(out).toEqual({ action: 'skip', targetId: 'dup' });
    expect(judged).toBe(0);
  });

  test('candidate band → judge update', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.4359]); // cos ≈ 0.90 (band)
    const out = await decideRouting(u('n1'), {
      vectors: v,
      provider,
      judge: async (_unit, ids) => ({ action: 'update', targetId: ids[0] }),
    });
    expect(out.action).toBe('update');
    expect((out as any).targetId).toBe('old');
  });

  test('judge returns create → create', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.44]); // cos ≈ 0.898 (band)
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => ({ action: 'create' }) });
    expect(out.action).toBe('create');
  });

  test('judge throws → fail-open create', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.44]);
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { throw new Error('x'); } });
    expect(out.action).toBe('create');
  });

  test('judge target outside candidates → fail-open create', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.44]);
    const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => ({ action: 'update', targetId: 'evil' }) });
    expect(out.action).toBe('create');
  });

  test('superseded candidates are excluded', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [1, 0]);
    const deps = { vectors: v, provider, judge: async () => null, isSuperseded: (id: string) => id === 'old' } as any;
    const out = await decideRouting(u('n1'), deps);
    expect(out.action).toBe('create');
  });
});
