/**
 * S4.2: pattern-separation branch — `separate` keeps both entries and injects a
 * distinction anchor + distinct_from marker (no merge, no supersede).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { routeAndWrite } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { EmbeddingProvider } from '../../../src/memory/embedding-provider';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sep-'));
}
function u(id: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: id, cue_anchors: [], memory_value: id,
    energy: 0.8, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  } as HarmonicUnit;
}
const provider: EmbeddingProvider = { name: 'stub', dims: 2, embed: async (t) => t.map(() => [1, 0]) };
function memStore(units: HarmonicUnit[]) {
  const byId = new Map(units.map((x) => [x.id, x]));
  const writes: HarmonicUnit[] = [];
  const superseded: Array<{ id: string; byId: string }> = [];
  return {
    writes, superseded,
    async read(id: string) { return byId.get(id) ?? null; },
    async write(x: HarmonicUnit) { byId.set(x.id, x); writes.push(x); return 'f.md'; },
    async markSuperseded(id: string, by: string) { superseded.push({ id, byId: by }); },
  };
}

test('separate → new unit with distinction anchor + distinct_from, no supersede', async () => {
  const v = new MemoryVectorStore(path.join(tmp(), 'v.json'), 2);
  v.upsert('east', [0.9, 0.44]); // band candidate
  const s = memStore([u('east')]);
  const out = await routeAndWrite(
    { ...u('west'), cue_anchors: ['deploy'] } as any,
    s as any,
    { vectors: v, provider, judge: async () => ({ action: 'separate', targetId: 'east', distinction: 'eu-west-1' }) },
  );
  expect(out.action).toBe('separate');
  expect(s.writes).toHaveLength(1);
  const written = s.writes[0];
  expect(written.cue_anchors).toContain('eu-west-1');
  expect(written.cue_anchors).toContain('deploy');
  expect((written as any).distinct_from).toContain('east');
  expect(s.superseded).toHaveLength(0);
});
