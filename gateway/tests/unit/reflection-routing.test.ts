/**
 * S1: reflection write-time routing — an insight that is an embedding-level
 * duplicate (but not a MinHash duplicate) is deduped instead of appended.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ReflectionPipeline } from '../../src/recall/reflection';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
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
  // Seed the existing semantic entry via the store so it has an OKF filePath
  // (the update path reads the target to merge it).
  const seed = new HarmonicUnitFileStore(dir, index);
  await seed.write({
    id: 'exist', type: 'semantic', primary_abstraction: 'deploy region',
    cue_anchors: ['deploy'], memory_value: 'deploy region', energy: 0.8,
    created_at: now, updated_at: now,
  } as any, 'semantic');
  index.addEntry({
    id: 'ep1', type: 'episodic', primary_abstraction: 'we deployed',
    cue_anchors: [], tier: 'episodic', energy: 0.8, source_session_id: 's1', created_at: now,
  } as any, 'episodic');

  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  v.upsert('exist', [1, 0]);
  // Embedding returns [1,0] for everything → cos=1 with 'exist'. The insight text
  // differs, so (post-fix) it routes to the judge; the stub judge says update →
  // the existing entry is superseded (routing update path).
  setRouteWriteDeps({
    vectors: v,
    provider: { name: 's', dims: 2, embed: async (t) => t.map(() => [1, 0]) },
    judge: async () => ({ action: 'update', targetId: 'exist' }),
  });

  const worker = {
    prompt: async () => JSON.stringify({
      insights: [{ category: 'insight', content: 'a totally unrelated sentence about widgets', cue_anchors: ['misc'] }],
    }),
  };
  const cursor = new ReflectCursor(new GatewayDatabase(path.join(dir, 'db.sqlite')));
  const pipe = new ReflectionPipeline({ index, baseDir: dir, workerFor: () => worker as any, cursor });

  const res = await pipe.runSession('s1');

  // Routing ran: the existing entry was superseded by an update (not appended).
  const existEntry = index.getIndex().entries.find((e) => e.id === 'exist');
  expect(existEntry?.superseded_by).toBeTruthy();
  expect(res.distilled).toBeGreaterThan(0);
});
