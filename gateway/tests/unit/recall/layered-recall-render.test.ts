import { buildSnapshot, renderLayeredRecall } from '../../../src/recall/snapshot-builder';
import type { EpisodeHit } from '../../../src/recall/t1-episode-search';

const episode: EpisodeHit = {
  episodeId: 't1ep_a',
  sessionId: 's1',
  startTurn: 1,
  endTurn: 3,
  status: 'closed',
  startedAt: Date.UTC(2026, 10, 16),
  intent: 'review embedding',
  actors: ['agent:reviewer', 'agent:builder'],
  conceptIds: [],
  score: 1,
  sources: ['turn', 'declared'],
  topTraceIds: ['t1t_1'],
};

describe('renderLayeredRecall', () => {
  test('renders episodes before knowledge and omits empty sections', () => {
    const block = renderLayeredRecall({
      episodes: [episode],
      memories: [{ id: 'mem_1', primary_abstraction: 'baseline requires evidence' }],
      maxChars: 2000,
    });
    expect(block.indexOf('## Episodes')).toBeLessThan(block.indexOf('## Knowledge'));
    expect(block).toContain('[t1ep:t1ep_a] 2026-11-16');
    expect(block).toContain('reviewer,builder');
    expect(block).toContain('review embedding');
    expect(block).toContain('(3 turns)');
    expect(block).toContain('[mem_1] baseline requires evidence');

    expect(renderLayeredRecall({ episodes: [], memories: [], maxChars: 2000 })).toBe('');
    expect(renderLayeredRecall({ episodes: [episode], memories: [], maxChars: 2000 })).not.toContain('## Knowledge');
  });

  test('respects the char cap', () => {
    const block = renderLayeredRecall({
      episodes: [episode],
      memories: [{ id: 'mem_1', primary_abstraction: 'x'.repeat(200) }],
      maxChars: 120,
    });
    expect(block.length).toBeLessThanOrEqual(120);
    expect(block).toContain('## Episodes');
    expect(block).not.toContain('mem_1');
  });
});

describe('snapshot builder layered recall', () => {
  const baseDeps = (over: any = {}) => {
    const stored: any[] = [];
    return {
      stored,
      deps: {
        recentTurnTexts: () => ['review the embedding change'],
        search: async () => [{
          id: 'mem_1',
          primary_abstraction: 'baseline requires evidence',
          memory_value: '',
          energy: 1,
          type: 'semantic',
          score: 1,
        }],
        render: () => 'KNOWLEDGE BLOCK',
        store: (_sid: string, snapshot: any) => { stored.push(snapshot); },
        ...over,
      } as any,
    };
  };

  test('uses episodes + knowledge when episode search is available', async () => {
    const { deps, stored } = baseDeps({
      searchEpisodes: async () => [episode],
      searchT1: async () => [],
    });
    const snapshot = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 600 } as any, 3);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.block).toContain('## Episodes');
    expect(snapshot!.block).toContain('## Knowledge');
    expect(snapshot!.episodes).toEqual([episode]);
    expect(stored).toHaveLength(1);
  });

  test('keeps the existing harmonic block when no episodes exist', async () => {
    const { deps } = baseDeps({ searchEpisodes: async () => [], searchT1: async () => [] });
    const snapshot = await buildSnapshot(deps, 's1', { maxTurns: 4, maxChars: 600 } as any, 3);
    expect(snapshot!.block).toBe('KNOWLEDGE BLOCK');
    expect(snapshot!.episodes).toBeUndefined();
  });
});
