import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import { handleAddMemory } from '../../src/mcp/handlers/add-memory';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'semantic',
    primary_abstraction: '发布前必须跑 dry-run',
    cue_anchors: ['发布', 'dry-run'],
    memory_value: '发布前必须跑 dry-run',
    energy: 0.8,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('sticky memory store', () => {
  let dir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sticky-'));
    store = new HarmonicUnitFileStore(dir);
  });

  test('write with sticky_until → index entry carries sticky_until', async () => {
    const until = new Date(Date.now() + 7 * 86400e3).toISOString();
    await store.write(makeUnit({ sticky_until: until }));
    const entry = store.indexManager_().getIndex().entries.find((e: any) => e.sticky_until);
    expect(entry).toBeDefined();
    expect((entry as any).sticky_until).toBe(until);
  });

  test('write without sticky_until → entry has no sticky_until', async () => {
    await store.write(makeUnit());
    const entry = store.indexManager_().getIndex().entries[0] as any;
    expect(entry.sticky_until).toBeFalsy();
  });

  test('setSticky round-trip updates index and OKF; null clears', async () => {
    const u = makeUnit();
    await store.write(u);
    const until = new Date(Date.now() + 3 * 86400e3).toISOString();
    expect(store.setSticky(u.id, until)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).sticky_until).toBe(until);
    const reread = await store.read(u.id);
    expect((reread as any).sticky_until).toBe(until);
    expect(store.setSticky(u.id, null)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).sticky_until).toBeUndefined();
    const reread2 = await store.read(u.id);
    expect((reread2 as any).sticky_until).toBeUndefined();
  });

  test('setSticky on nonexistent id returns false', () => {
    expect(store.setSticky('mem_nope', new Date().toISOString())).toBe(false);
  });
});

describe('mafw_add_memory sticky params', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-sticky-add-'));
  });

  test('sticky: true → sticky_until ~7 days out; response reports it', async () => {
    const before = Date.now();
    const res = await handleAddMemory(
      { content: '客户在等 v4.2 报价', memoryType: 'semantic', sticky: true },
      { mafwDir: dir } as any,
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.sticky_until).toBeDefined();
    const until = new Date(body.sticky_until).getTime();
    expect(until).toBeGreaterThan(before + 6 * 86400e3);
    expect(until).toBeLessThan(Date.now() + 8 * 86400e3);

    const store = new HarmonicUnitFileStore(dir);
    const entry = store.indexManager_().getIndex().entries.find((e: any) => e.id === body.id) as any;
    expect(entry.sticky_until).toBe(body.sticky_until);
  });

  test('stickyDays: 3 overrides the default TTL', async () => {
    const res = await handleAddMemory(
      { content: '周五前交方案', memoryType: 'semantic', sticky: true, stickyDays: 3 },
      { mafwDir: dir } as any,
    );
    const body = JSON.parse(res.content[0].text);
    const until = new Date(body.sticky_until).getTime();
    expect(until).toBeLessThan(Date.now() + 4 * 86400e3);
    expect(until).toBeGreaterThan(Date.now() + 2 * 86400e3);
  });

  test('no sticky flag → no sticky_until', async () => {
    const res = await handleAddMemory(
      { content: '普通记忆', memoryType: 'semantic' },
      { mafwDir: dir } as any,
    );
    const body = JSON.parse(res.content[0].text);
    expect(body.success).toBe(true);
    expect(body.sticky_until).toBeUndefined();
  });
});
