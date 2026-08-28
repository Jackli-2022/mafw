import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'semantic',
    primary_abstraction: '用户偏好中文回复',
    cue_anchors: ['用户', '偏好', '中文'],
    memory_value: '用户偏好中文回复',
    energy: 0.8,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('pinned memory store', () => {
  let dir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pinned-'));
    store = new HarmonicUnitFileStore(dir);
  });

  test('write with pinned=true → index entry carries pinned', async () => {
    await store.write(makeUnit({ pinned: true }));
    const entry = store.indexManager_().getIndex().entries.find((e: any) => e.pinned);
    expect(entry).toBeDefined();
    expect(entry.pinned).toBe(true);
  });

  test('write without pinned → entry has no pinned flag', async () => {
    await store.write(makeUnit());
    const entry = store.indexManager_().getIndex().entries[0];
    expect((entry as any).pinned).toBeFalsy();
  });

  test('setPinned round-trip updates index and is readable', async () => {
    const u = makeUnit();
    await store.write(u);
    expect(store.setPinned(u.id, true)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).pinned).toBe(true);
    const reread = await store.read(u.id);
    expect((reread as any).pinned).toBe(true);
    expect(store.setPinned(u.id, false)).toBe(true);
    expect((store.indexManager_().getIndex().entries[0] as any).pinned).toBe(false);
  });

  test('setPinned on nonexistent id returns false', () => {
    expect(store.setPinned('mem_nope', true)).toBe(false);
  });

  test('MinHash merge: pinned = OR across sources', async () => {
    await store.write(makeUnit({ pinned: true, primary_abstraction: '用户偏好中文回复和简洁代码' }));
    // 相似 abstraction 触发合并（threshold 0.75，3-gram shingle）
    const b = makeUnit({ primary_abstraction: '用户偏好中文回复和简洁代码风格', pinned: false });
    await store.write(b);
    const mergedEntry = store.indexManager_().getIndex().entries.find((e: any) => e.merged_from?.length);
    expect(mergedEntry).toBeDefined();
    expect(mergedEntry.pinned).toBe(true);
  });

  test('explicit supersedes flow: old entry gets superseded_by = new id', async () => {
    const old = makeUnit({ primary_abstraction: '用户偏好在晚上工作' });
    await store.write(old);
    const fresh = makeUnit({ primary_abstraction: '用户偏好在白天工作' });
    await store.write(fresh);
    expect(store.markSuperseded(old.id, fresh.id)).toBe(true);
    const target = store.indexManager_().getIndex().entries.find((e: any) => e.id === old.id);
    expect((target as any).superseded_by).toBe(fresh.id);
    expect(target.energy).toBeLessThan(0.8);
  });
});
