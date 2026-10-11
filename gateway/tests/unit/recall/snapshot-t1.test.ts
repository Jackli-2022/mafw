import { SNAPSHOT_DEFAULTS } from '../../../src/recall/recall-snapshot';
import { config } from '../../../src/config';
import { buildSnapshot, SnapshotDeps } from '../../../src/recall/snapshot-builder';

describe('t1 snapshot config defaults', () => {
  test('SNAPSHOT_DEFAULTS carries t1K/t1MaxChars', () => {
    expect((SNAPSHOT_DEFAULTS as any).t1K).toBe(3);
    expect((SNAPSHOT_DEFAULTS as any).t1MaxChars).toBe(600);
  });
  test('config.recall.t1Recall defaults enabled', () => {
    expect((config.recall as any).t1Recall?.enabled).toBe(true);
    expect((config.recall as any).t1Recall?.k).toBe(3);
  });
});

const mem = (id: string) => ({ id, primary_abstraction: `abs ${id}`, cue_anchors: ['x'], created_at: '2026-10-10T00:00:00Z' } as any);

function makeDeps(overrides: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    recentTurnTexts: () => ['hello gateway'],
    search: () => [mem('m1'), mem('m2')],
    render: (ms: any[]) => `block with ${ms.length} memories`,
    store: () => {},
    ...overrides,
  } as SnapshotDeps;
}

describe('buildSnapshot searchT1 fusion', () => {
  test('appends t1 lines to the block and records t1Hits', async () => {
    const stored: any[] = [];
    const deps = makeDeps({
      searchT1: async () => [
        { sessionId: 'ses_PROVIDER123456', turnId: 3, cosine: 0.8, excerpt: 'verbatim hit one' },
      ],
      store: (_sid: string, snap: any) => stored.push(snap),
    });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400, t1K: 3, t1MaxChars: 300 } as any, 3);
    expect(snap).toBeTruthy();
    expect(snap!.block).toContain('block with 2 memories');
    expect(snap!.block).toContain('[t1|123456:3]');
    expect(snap!.block).toContain('verbatim hit one');
    expect(snap!.t1Hits).toHaveLength(1);
    expect(stored[0].t1Hits).toHaveLength(1);
  });
  test('searchT1 empty → block unchanged, t1Hits undefined', async () => {
    const deps = makeDeps({ searchT1: async () => [] });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap!.block).toBe('block with 2 memories');
    expect(snap!.t1Hits).toBeUndefined();
  });
  test('searchT1 absent → behavior identical to today', async () => {
    const deps = makeDeps();
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap!.block).toBe('block with 2 memories');
    expect(snap!.t1Hits).toBeUndefined();
  });
  test('searchT1 throws → fail-open (snapshot still built)', async () => {
    const deps = makeDeps({
      searchT1: async () => { throw new Error('embed down'); },
    });
    const snap = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 400 } as any, 3);
    expect(snap).toBeTruthy();
    expect(snap!.t1Hits).toBeUndefined();
  });
});
