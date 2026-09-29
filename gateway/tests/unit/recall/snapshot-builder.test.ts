/**
 * R8 snapshot builder: builds the expensive (reranked) pointer block in the
 * background and stores it for the boundary path; fails open at every step.
 */
import { buildSnapshot, SnapshotDeps } from '../../../src/recall/snapshot-builder';
import { RecallMemory } from '../../../src/recall/recall-context';

function mem(id: string, score: number): RecallMemory {
  return { id, primary_abstraction: `abstraction ${id}`, memory_value: '', energy: 0.8, score };
}

function deps(over: Partial<SnapshotDeps> = {}): SnapshotDeps {
  return {
    recentTurnTexts: () => ['kubernetes deployment rollout question', 'earlier turn about clusters'],
    search: (_q, n) => [mem('a', 1), mem('b', 0.8), mem('c', 0.6)].slice(0, n),
    render: ms => `<recall>${ms.map(m => m.id).join(',')}</recall>`,
    store: () => { /* noop */ },
    now: () => new Date('2026-09-28T10:00:00Z'),
    ...over,
  };
}

describe('buildSnapshot', () => {
  test('builds and stores a snapshot with the rolling-window query', async () => {
    const stored: any[] = [];
    const snap = await buildSnapshot(deps({ store: (sid, s) => stored.push([sid, s]) }), 'ses_1');
    expect(snap).not.toBeNull();
    expect(snap!.query).toContain('kubernetes');
    expect(snap!.builtAt).toBe('2026-09-28T10:00:00.000Z');
    expect(stored).toHaveLength(1);
    expect(stored[0][0]).toBe('ses_1');
  });

  test('applies the reranker and renders the reranked order', async () => {
    const snap = await buildSnapshot(
      deps({
        verify: async (_q, ms) => ({ memories: [...ms].reverse() }),
      }),
      'ses_1',
    );
    expect(snap!.block).toBe('<recall>c,b,a</recall>');
    expect(snap!.ids[0]).toBe('c');
  });

  test('reranker failure is fail-open (keeps un-reranked ranking)', async () => {
    const snap = await buildSnapshot(
      deps({ verify: async () => { throw new Error('sidecar down'); } }),
      'ses_1',
    );
    expect(snap!.block).toBe('<recall>a,b,c</recall>');
  });

  test('no recent turns / no hits / empty render 鈫?null (caller falls back)', async () => {
    expect(await buildSnapshot(deps({ recentTurnTexts: () => [] }), 'ses_1')).toBeNull();
    expect(await buildSnapshot(deps({ search: () => [] }), 'ses_1')).toBeNull();
    expect(await buildSnapshot(deps({ render: () => null }), 'ses_1')).toBeNull();
  });

  test('async search dep (dense channel) is awaited', async () => {
    const snap = await buildSnapshot(
      deps({ search: async (_q, n) => [mem('z', 1)].slice(0, n) }),
      'ses_1',
    );
    expect(snap!.block).toBe('<recall>z</recall>');
  });

  test('R5 FOK zone from the verification layer is baked into the snapshot', async () => {
    const snap = await buildSnapshot(
      deps({
        render: (ms, status) => `<recall status="${status ?? 'inject'}">${ms.map(m => m.id).join(',')}</recall>`,
        verify: async (_q, ms) => ({ memories: ms, fokStatus: 'no-memory' as const }),
      }),
      'ses_1',
    );
    expect(snap!.fokStatus).toBe('no-memory');
    expect(snap!.block).toContain('status="no-memory"');
  });

  test('A4 hit-proxy: top1prob from the verification layer is carried into the snapshot', async () => {
    const snap = await buildSnapshot(
      deps({
        verify: async (_q, ms) => ({ memories: ms, fokStatus: 'inject' as const, top1prob: 0.87 }),
      }),
      'ses_1',
    );
    expect(snap!.top1prob).toBe(0.87);
    expect(snap!.fokStatus).toBe('inject');
  });

  test('fail-open: verify throwing leaves the snapshot at the normal zone', async () => {
    const snap = await buildSnapshot(
      deps({
        render: (ms, status) => `<recall status="${status ?? 'inject'}">${ms.map(m => m.id).join(',')}</recall>`,
        verify: async () => { throw new Error('reranker down'); },
      }),
      'ses_1',
    );
    expect(snap!.fokStatus).toBeUndefined();
    expect(snap!.block).toContain('status="inject"');
  });
});
