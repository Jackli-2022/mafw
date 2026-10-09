/**
 * S1: mafw_add_memory write-time routing — duplicate writes are deduped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleAddMemory } from '../../../src/mcp/handlers/add-memory';
import { setRouteWriteDeps } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-addroute-'));
}

function oldUnit(id: string): any {
  const now = new Date().toISOString();
  return {
    id,
    type: 'semantic',
    primary_abstraction: '陈旧条目',
    cue_anchors: [],
    memory_value: '陈旧条目',
    energy: 0.8,
    created_at: now,
    updated_at: now,
  };
}

afterEach(() => setRouteWriteDeps(null));

test('near-exact duplicate → deduped, not persisted', async () => {
  const dir = tmp();
  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  v.upsert('existing', [1, 0]); // cos = 1.0 with the new unit's [1,0]
  setRouteWriteDeps({
    vectors: v,
    provider: { name: 's', dims: 2, embed: async (t) => t.map(() => [1, 0]) },
    judge: async () => null,
    // Same abstraction as the incoming unit → genuine re-statement → skip.
    readEntry: () => ({ primary_abstraction: 'same' }),
  });

  const res: any = await handleAddMemory(
    { content: 'same content', memoryType: 'semantic', cueAnchors: [], primaryAbstraction: 'same', importance: 5 },
    { mafwDir: dir } as any,
  );
  const body = JSON.parse(res.content[0].text);
  expect(body.success).toBe(true);
  expect(body.deduped).toBe(true);
  expect(body.id).toBe('existing');
});

test('no routing deps → plain write (rollback-safe)', async () => {
  const dir = tmp();
  const res: any = await handleAddMemory(
    { content: 'fresh content', memoryType: 'semantic', cueAnchors: [], primaryAbstraction: 'fresh', importance: 5 },
    { mafwDir: dir } as any,
  );
  const body = JSON.parse(res.content[0].text);
  expect(body.success).toBe(true);
  expect(body.deduped).toBeUndefined();
});

test('supersedes + routing create → target marked superseded and reported', async () => {
  const dir = tmp();
  const oldId = 'mem_old_create';
  await new HarmonicUnitFileStore(dir).write(oldUnit(oldId));
  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  setRouteWriteDeps({
    vectors: v,
    provider: { name: 's', dims: 2, embed: async (t) => t.map(() => [1, 0]) },
    judge: async () => null, // no candidates → create
  });

  const res: any = await handleAddMemory(
    { content: '新内容', memoryType: 'semantic', primaryAbstraction: '新内容', supersedes: [oldId] },
    { mafwDir: dir } as any,
  );
  const body = JSON.parse(res.content[0].text);
  expect(body.success).toBe(true);
  expect(body.superseded).toEqual([oldId]);
  const reread: any = await new HarmonicUnitFileStore(dir).read(oldId);
  expect(reread.superseded_by).toBe(body.id);
});

test('supersedes + routing skip → target NOT marked, response omits superseded', async () => {
  const dir = tmp();
  const oldId = 'mem_old_skip';
  await new HarmonicUnitFileStore(dir).write(oldUnit(oldId));
  const v = new MemoryVectorStore(path.join(dir, 'v.json'), 2);
  v.upsert('dup', [1, 0]); // cos = 1.0 with the incoming unit's [1,0]
  setRouteWriteDeps({
    vectors: v,
    provider: { name: 's', dims: 2, embed: async (t) => t.map(() => [1, 0]) },
    judge: async () => null,
    // Same abstraction as the incoming unit → genuine re-statement → skip.
    readEntry: () => ({ primary_abstraction: 'same' }),
  });

  const res: any = await handleAddMemory(
    { content: 'same content', memoryType: 'semantic', primaryAbstraction: 'same', supersedes: [oldId] },
    { mafwDir: dir } as any,
  );
  const body = JSON.parse(res.content[0].text);
  expect(body.success).toBe(true);
  expect(body.deduped).toBe(true);
  expect(body.id).toBe('dup');
  expect(body.superseded).toBeUndefined();
  const reread: any = await new HarmonicUnitFileStore(dir).read(oldId);
  expect(reread.superseded_by).toBeUndefined();
});
