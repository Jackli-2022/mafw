import { searchRecallMemories } from '../../../gateway/src/recall/recall-context';

describe('searchRecallMemories', () => {
  const entries = [
    { id: 'mem-1', primary_abstraction: 'JWT RS256', content: 'full value 1', energy: 0.9 },
    { id: 'mem-2', primary_abstraction: 'self-hosted', content: 'full value 2', energy: 0.8 },
    { id: 'mem-3', primary_abstraction: 'nuts allergy', content: 'full value 3', energy: 0.7 },
  ];
  const index: any = {
    search: (query: string, topK: number) => entries.slice(0, topK),
  };

  test('returns memories without pushed filter', () => {
    const result = searchRecallMemories(index, 'q', new Set());
    expect(result.map((m) => m.id)).toEqual(['mem-1', 'mem-2', 'mem-3']);
    expect(result[0]).toMatchObject({ primary_abstraction: 'JWT RS256', memory_value: 'full value 1' });
  });

  test('filters out pushed memory IDs (path 1 integration)', () => {
    const pushed = new Set(['mem-1', 'mem-3']);
    const result = searchRecallMemories(index, 'q', pushed);
    expect(result.map((m) => m.id)).toEqual(['mem-2']);
  });

  test('returns empty when index is unavailable', () => {
    expect(searchRecallMemories(undefined, 'q', new Set())).toEqual([]);
  });

  test('respects topK', () => {
    const result = searchRecallMemories(index, 'q', new Set(), 1);
    expect(result.length).toBe(1);
  });

  test('passes retriever option to index.search', () => {
    const calls: Array<{ query: string; topK: number; options?: any }> = [];
    const indexWithOptions: any = {
      search: (query: string, topK: number, options?: any) => {
        calls.push({ query, topK, options });
        return [];
      },
    };
    searchRecallMemories(indexWithOptions, 'q', new Set(), 3, { retriever: 'bm25' });
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toEqual({ retriever: 'bm25' });
  });

  test('maps type and created_at into RecallMemory', () => {
    const typed: any = {
      search: () => [{ id: 'typed-1', primary_abstraction: 'typed', energy: 0.5, type: 'semantic', created_at: '2026-08-18T12:00:00.000Z' }],
    };
    const result = searchRecallMemories(typed, 'q', new Set());
    expect(result[0]).toMatchObject({ id: 'typed-1', type: 'semantic', created_at: '2026-08-18T12:00:00.000Z' });
  });

  test('never leaks memory_value undefined', () => {
    const sparse: any = {
      search: () => [{ id: 'x', energy: 0.5 }],
    };
    const result = searchRecallMemories(sparse, 'q', new Set());
    expect(result[0]).toEqual({ id: 'x', primary_abstraction: '', memory_value: '', energy: 0.5, type: undefined, created_at: undefined });
  });
});
