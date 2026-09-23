/**
 * S1.6: ConsolidationService stats persistence seam (onStats) + skipped counter.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConsolidationService } from '../../src/memory/consolidation-service';
import { MemoryVectorStore } from '../../src/memory/vector-store';
import { EmbeddingProvider } from '../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-consol-stats-'));
}
function unit(id: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: id, cue_anchors: [], memory_value: id,
    energy: 0.8, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as HarmonicUnit;
}
function stubStore(units: HarmonicUnit[]) {
  const byId = new Map(units.map((u) => [u.id, u]));
  return {
    async read(id: string) { return byId.get(id) ?? null; },
    async write(u: HarmonicUnit) { byId.set(u.id, u); return 'f.md'; },
    async markSuperseded() { /* noop */ },
  };
}
const provider: EmbeddingProvider = { name: 'stub', dims: 2, embed: async (t) => t.map(() => [1, 0]) };

test('onStats fires on judge with a skipped counter', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('old', [0.9, 0.44]); // band candidate
  const seen: any[] = [];
  const svc = new ConsolidationService({
    store: stubStore([unit('old')]) as any,
    vectors: v,
    provider,
    completion: () => ({ complete: async () => ({ text: '{"action":"create"}' }) }),
    model: { providerID: 'gateway', modelID: 'glm' },
    onStats: (s) => seen.push(s),
  } as any);

  await svc.consolidate(unit('u1'));
  expect(seen.length).toBeGreaterThan(0);
  const last = seen[seen.length - 1];
  expect(last).toHaveProperty('skipped');
  expect(last.judged).toBeGreaterThanOrEqual(1);
});

test('onStats fires on skip paths too', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  const seen: any[] = [];
  const failing: EmbeddingProvider = { name: 'fail', dims: 2, embed: async () => { throw new Error('no embed'); } };
  const svc = new ConsolidationService({
    store: stubStore([]) as any, vectors: v, provider: failing, onStats: (s) => seen.push(s),
  } as any);
  await svc.consolidate(unit('u1')); // embed fails → skip
  expect(seen.length).toBe(1);
  expect(seen[0].skipped).toBe(1);
});
