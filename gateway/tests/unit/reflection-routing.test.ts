/**
 * S1: reflection write-time routing — an insight that is an embedding-level
 * duplicate (but not a MinHash duplicate) is deduped instead of appended.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ReflectionPipeline } from '../../src/recall/reflection';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { ReflectCursor } from '../../src/recall/reflect-cursor';
import { GatewayDatabase } from '../../src/memory/gateway-db';
import { setRouteWriteDeps } from '../../src/memory/route-write';
import { MemoryVectorStore } from '../../src/memory/vector-store';

afterEach(() => setRouteWriteDeps(null));

test('reflection dedups an embedding-duplicate insight (routing path)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-refl-route-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const now = new Date().toISOString();
  index.addEntry({
    id: 'exist', type: 'semantic', primary_abstraction: 'deploy region',
    cue_anchors: ['deploy'], tier: 'semantic', energy: 0.8, created_at: now,
  } as any, 'semantic');
  index.addEntry({
    id: 'ep1', type: 'episodic', primary_abstraction: 'we deployed',
    cue_anchors: [], tier: 'episodic', energy: 0.8, source_session_id: 's1', created_at: now,
  } as any, 'episodic');

  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  v.upsert('exist', [1, 0]);
  // Stub embedding returns [1,0] for everything → cos=1 with 'exist' → skip.
  setRouteWriteDeps({
    vectors: v,
    provider: { name: 's', dims: 2, embed: async (t) => t.map(() => [1, 0]) },
    judge: async () => null,
  });

  // Wording deliberately unlike the existing entry so MinHash classify → novel,
  // leaving write-time routing as the only dedup mechanism.
  const worker = {
    prompt: async () => JSON.stringify({
      insights: [{ category: 'insight', content: 'a totally unrelated sentence about widgets', cue_anchors: ['misc'] }],
    }),
  };
  const cursor = new ReflectCursor(new GatewayDatabase(path.join(dir, 'db.sqlite')));
  const pipe = new ReflectionPipeline({ index, baseDir: dir, workerFor: () => worker as any, cursor });

  const before = index.getIndex().entries.length;
  const res = await pipe.runSession('s1');

  expect(res.deduped).toBeGreaterThan(0);
  expect(index.getIndex().entries.length).toBe(before); // no new entry written
});
