/**
 * S1: 三态路由决策（skip/create/update）— 写时路由纯函数。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { decideRouting, routeAndWrite, setRouteWriteDeps, getRouteWriteDeps, isNearIdentical } from '../../../src/memory/route-write';
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

  test('cos >= dupCosine AND near-identical text → skip (no judge call)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('dup', [1, 0]); // cos = 1.0
    let judged = 0;
    const out = await decideRouting(u('n1'), {
      vectors: v,
      provider,
      judge: async () => { judged++; return null; },
      readEntry: () => ({ primary_abstraction: 'n1' }), // same abstraction as u('n1')
    });
    expect(out).toEqual({ action: 'skip', targetId: 'dup' });
    expect(judged).toBe(0);
  });

  test('cos >= dupCosine but DIFFERENT text → judge (value change not dropped)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('dup', [1, 0]);
    let judged = 0;
    const out = await decideRouting(u('n1'), {
      vectors: v,
      provider,
      judge: async () => { judged++; return { action: 'update', targetId: 'dup' }; },
      readEntry: () => ({ primary_abstraction: 'replicas upper bound is five' }),
    });
    expect(judged).toBe(1);
    expect(out.action).toBe('update');
  });

  test('cos >= dupCosine without readEntry → judge (safe default)', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('dup', [1, 0]);
    let judged = 0;
    const out = await decideRouting(u('n1'), {
      vectors: v,
      provider,
      judge: async () => { judged++; return null; },
    });
    expect(judged).toBe(1);
    expect(out.action).toBe('create');
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

  describe('laya redundant gate', () => {
    const bandVec: [number, number] = [0.9, 0.44]; // cos ≈ 0.898 → 中间带
    const layaDeps = (pRedundant: number | null, judged: { n: number }) => ({
      laya: {
        client: { askPair: async () => (pRedundant === null ? null : { pConflict: 0.1, pRedundant }) },
        tauRedundantHigh: 0.9,
      },
      readUnit: async () => ({ memory_value: '已知内容' }),
      judge: async () => { judged.n++; return { action: 'create' as const }; },
    });

    test('pRedundant >= tau → redundant outcome, judge NOT called', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const judged = { n: 0 };
      const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.95, judged) });
      expect(out).toEqual({ action: 'redundant', targetId: 'old', pRedundant: 0.95 });
      expect(judged.n).toBe(0);
    });

    test('pRedundant < tau → judge called as before', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const judged = { n: 0 };
      const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.5, judged) });
      expect(out.action).toBe('create');
      expect(judged.n).toBe(1);
    });

    test('askPair null → fail-open to judge', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const judged = { n: 0 };
      const out = await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(null, judged) });
      expect(out.action).toBe('create');
      expect(judged.n).toBe(1);
    });

    test('no laya dep → behavior byte-identical to before', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const judged = { n: 0 };
      const out = await decideRouting(u('n1'), { vectors: v, provider, judge: async () => { judged.n++; return { action: 'create' as const }; } });
      expect(out.action).toBe('create');
      expect(judged.n).toBe(1);
    });

    test('onRoute receives audit row with redundantScores', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const rows: any[] = [];
      const judged = { n: 0 };
      await decideRouting(u('n1'), { vectors: v, provider, ...layaDeps(0.95, judged), onRoute: (r) => rows.push(r) });
      expect(rows).toHaveLength(1);
      expect(rows[0].decidedBy).toBe('laya-redundant');
      expect(rows[0].verdict).toBe('redundant');
      expect(rows[0].redundantScores).toEqual([{ id: 'old', p: 0.95 }]);
      expect(rows[0].candidates[0].id).toBe('old');
    });

    test('onRoute throwing does not break routing (fail-open)', async () => {
      const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
      v.upsert('old', bandVec);
      const judged = { n: 0 };
      const out = await decideRouting(u('n1'), {
        vectors: v, provider, ...layaDeps(0.95, judged),
        onRoute: () => { throw new Error('audit down'); },
      });
      expect(out.action).toBe('redundant');
    });
  });
});

describe('routeAndWrite', () => {
  function memStore(units: HarmonicUnit[]) {
    const byId = new Map(units.map((x) => [x.id, x]));
    const writes: HarmonicUnit[] = [];
    const superseded: Array<{ id: string; byId: string }> = [];
    return {
      byId,
      writes,
      superseded,
      async read(id: string) { return byId.get(id) ?? null; },
      async write(x: HarmonicUnit) { byId.set(x.id, x); writes.push(x); return 'f.md'; },
      async markSuperseded(id: string, by: string) { superseded.push({ id, byId: by }); },
    };
  }

  test('create → writes unit, returns own id', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    const s = memStore([]);
    const out = await routeAndWrite(u('n1'), s as any, { vectors: v, provider, judge: async () => null });
    expect(out).toEqual({ action: 'create', id: 'n1' });
    expect(s.writes.map((w) => w.id)).toEqual(['n1']);
  });

  test('skip → no write, returns existing id', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('dup', [1, 0]);
    const s = memStore([u('dup')]);
    const out = await routeAndWrite(u('n1'), s as any, {
      vectors: v,
      provider,
      judge: async () => null,
      readEntry: () => ({ primary_abstraction: 'n1' }),
    });
    expect(out).toEqual({ action: 'skip', id: 'dup', targetId: 'dup' });
    expect(s.writes).toHaveLength(0);
  });

  test('update → merges into newer, supersedes target', async () => {
    const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
    v.upsert('old', [0.9, 0.44]);
    const s = memStore([u('old')]);
    const out = await routeAndWrite(u('n1'), s as any, {
      vectors: v,
      provider,
      judge: async (_x, ids) => ({ action: 'update', targetId: ids[0] }),
    });
    expect(out).toEqual({ action: 'update', id: 'n1', targetId: 'old' });
    expect(s.writes.map((w) => w.id)).toEqual(['n1']);
    expect(s.superseded).toEqual([{ id: 'old', byId: 'n1' }]);
    expect(s.writes[0].merged_from).toContain('old');
  });
});

describe('route deps singleton', () => {
  test('set/get/null', () => {
    setRouteWriteDeps({ vectors: null as any, provider: null as any, judge: async () => null });
    expect(getRouteWriteDeps()).not.toBeNull();
    setRouteWriteDeps(null);
    expect(getRouteWriteDeps()).toBeNull();
  });
});

describe('isNearIdentical', () => {
  test('exact re-statement (case/whitespace insensitive) → true', () => {
    expect(isNearIdentical('副本数上限是 3 个', '副本数上限是 3 个')).toBe(true);
    expect(isNearIdentical('Deploy to US-EAST-1', 'deploy to  us-east-1')).toBe(true);
  });
  test('value change → false (must not be dropped)', () => {
    expect(isNearIdentical('副本数上限是 3 个', '副本数上限是 5 个')).toBe(false);
  });
  test('empty → false', () => {
    expect(isNearIdentical('', '')).toBe(false);
    expect(isNearIdentical(undefined, undefined)).toBe(false);
  });
});
