import { searchRecallMemories } from '../../src/recall/recall-context';

const fakeIndex: any = {
  search: () => [
    { id: 'aaaaaaaaaaaa', primary_abstraction: 'x', energy: 0.8, type: 'semantic', created_at: '2026-01-01' },
  ],
};

// The plugin-side boundary recall client aborts after 100ms — the sync recall
// path must therefore never call (let alone await) the index scan. Scan value
// arrives via async prefetch snapshots instead.
describe('recall sync path excludes scan', () => {
  it('never invokes a scan service, even when legacy options ask for it', async () => {
    let scanCalled = false;
    const hungScanService = {
      scan: () => {
        scanCalled = true;
        return new Promise(() => { /* never resolves */ });
      },
    };
    const res = await searchRecallMemories(fakeIndex, 'q', new Set(), 3, {
      enableScan: true,
      scanService: hungScanService,
    } as any);
    expect(scanCalled).toBe(false);
    expect(res.length).toBe(1);
    expect(res[0].source).toBe('bm25');
  });
});
