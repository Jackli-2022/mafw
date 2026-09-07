import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { handlePinMemory } from '../../src/mcp/handlers/pin-memory';

async function seed(dir: string): Promise<string> {
  const store = new HarmonicUnitFileStore(dir);
  const now = new Date().toISOString();
  await store.write({
    id: 'mem_stick_test', type: 'semantic',
    primary_abstraction: '周五前交方案', cue_anchors: ['方案'],
    memory_value: '周五前交方案', energy: 0.8,
    created_at: now, updated_at: now,
  });
  return 'mem_stick_test';
}

describe('mafw_pin_memory sticky ops', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pin-sticky-'));
  });

  test('sticky: true sticks with default 7-day TTL', async () => {
    const id = await seed(dir);
    const before = Date.now();
    const res = await handlePinMemory({ id, sticky: true }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    const entry = new HarmonicUnitFileStore(dir).indexManager_().getIndex().entries[0] as any;
    expect(new Date(entry.sticky_until).getTime()).toBeGreaterThan(before + 6 * 86400e3);
  });

  test('sticky: true + stickyDays renews the TTL', async () => {
    const id = await seed(dir);
    await handlePinMemory({ id, sticky: true, stickyDays: 1 }, { mafwDir: dir } as any);
    await handlePinMemory({ id, sticky: true, stickyDays: 30 }, { mafwDir: dir } as any);
    const entry = new HarmonicUnitFileStore(dir).indexManager_().getIndex().entries[0] as any;
    expect(new Date(entry.sticky_until).getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3);
  });

  test('sticky: false unsticks (memory itself untouched)', async () => {
    const id = await seed(dir);
    await handlePinMemory({ id, sticky: true }, { mafwDir: dir } as any);
    const res = await handlePinMemory({ id, sticky: false }, { mafwDir: dir } as any);
    expect(JSON.parse(res.content[0].text).success).toBe(true);
    const store = new HarmonicUnitFileStore(dir);
    const entry = store.indexManager_().getIndex().entries[0] as any;
    expect(entry.sticky_until).toBeUndefined();
    const unit = await store.read(id);
    expect(unit?.memory_value).toBe('周五前交方案');
  });

  test('sticky on unknown id → error', async () => {
    const res = await handlePinMemory({ id: 'mem_nope', sticky: true }, { mafwDir: dir } as any);
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(false);
    expect(res.isError).toBe(true);
  });

  test('existing pinned behavior unchanged (pinned flag still works)', async () => {
    const id = await seed(dir);
    const res = await handlePinMemory({ id, pinned: true }, { mafwDir: dir } as any);
    expect(JSON.parse(res.content[0].text).success).toBe(true);
    const entry = new HarmonicUnitFileStore(dir).indexManager_().getIndex().entries[0] as any;
    expect(entry.pinned).toBe(true);
  });
});
