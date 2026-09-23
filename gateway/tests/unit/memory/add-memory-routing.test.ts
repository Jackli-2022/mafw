/**
 * S1: mafw_add_memory write-time routing — duplicate writes are deduped.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { handleAddMemory } from '../../../src/mcp/handlers/add-memory';
import { setRouteWriteDeps } from '../../../src/memory/route-write';
import { MemoryVectorStore } from '../../../src/memory/vector-store';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-addroute-'));
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
