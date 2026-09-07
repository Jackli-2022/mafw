import { planUnmerge, CleanupEntry } from '../../src/memory/unmerge-cleanup';

const existsAll = () => true;

describe('planUnmerge', () => {
  test('simple blob: delete blob, restore direct sources', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S2'] },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
      { id: 'S2', superseded_by: 'B', energy: 0.3 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([
      { id: 'S1', energy: 0.8 },
      { id: 'S2', energy: 0.6 },
    ]);
    expect(plan.keepBlobs).toEqual([]);
  });

  test('chain: intermediate blob is expanded and deleted, leaf sources restored', () => {
    const entries: CleanupEntry[] = [
      { id: 'B2', merged_from: ['B1', 'S2'] },
      { id: 'B1', merged_from: ['S1'], superseded_by: 'B2' },
      { id: 'S1', superseded_by: 'B1', energy: 0.5 },
      { id: 'S2', superseded_by: 'B2', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs.sort()).toEqual(['B1', 'B2']);
    expect(plan.restore.map(r => r.id).sort()).toEqual(['S1', 'S2']);
  });

  test('pinned blob is kept and its sources stay superseded', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'], pinned: true },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.keepBlobs).toEqual([{ id: 'B', reason: 'pinned' }]);
    expect(plan.deleteBlobs).toEqual([]);
    expect(plan.restore).toEqual([]);
  });

  test('missing source keeps the blob and records the gap', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S9'] },
      { id: 'S1', superseded_by: 'B', energy: 0.4 },
    ];
    const plan = planUnmerge(entries, (id) => id === 'S1'); // S9 文件缺失
    expect(plan.keepBlobs).toEqual([{ id: 'B', reason: 'missing sources: 1' }]);
    expect(plan.missingSources).toEqual([{ blobId: 'B', sourceId: 'S9' }]);
    expect(plan.deleteBlobs).toEqual([]);
    expect(plan.restore).toEqual([]); // S1 不还原，内容仍由 B 承载
  });

  test('source superseded by a non-blob (explicit knowledge update) is NOT restored', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'] },
      { id: 'S1', superseded_by: 'X', energy: 0.4 },
      { id: 'X', energy: 0.8 }, // 普通条目，显式取代 S1
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([]);
  });

  test('live source (not superseded) is left alone', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1'] },
      { id: 'S1', energy: 0.7 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.deleteBlobs).toEqual(['B']);
    expect(plan.restore).toEqual([]);
  });

  test('energy restore rule: floor 0.4, cap 0.9', () => {
    const entries: CleanupEntry[] = [
      { id: 'B', merged_from: ['S1', 'S2', 'S3'] },
      { id: 'S1', superseded_by: 'B', energy: 0.1 },
      { id: 'S2', superseded_by: 'B', energy: 0.3 },
      { id: 'S3', superseded_by: 'B', energy: 0.48 },
    ];
    const plan = planUnmerge(entries, existsAll);
    expect(plan.restore).toEqual([
      { id: 'S1', energy: 0.4 },
      { id: 'S2', energy: 0.6 },
      { id: 'S3', energy: 0.9 },
    ]);
  });
});
