import { MAFWRetriever, HarmonicIndexLike, HarmonicIndexEntryLike } from '../../../src/langchain/retriever';
import { Document } from '@langchain/core/documents';

function makeEntry(overrides: Partial<HarmonicIndexEntryLike> = {}): HarmonicIndexEntryLike {
  return {
    id: 'mem_1',
    primary_abstraction: 'test memory summary',
    cue_anchors: ['test', 'memory'],
    type: 'semantic',
    tier: 'T2',
    energy: 0.8,
    ...overrides,
  };
}

function makeIndex(entries: HarmonicIndexEntryLike[]): jest.Mocked<HarmonicIndexLike> {
  return {
    search: jest.fn().mockReturnValue(entries),
  };
}

describe('MAFWRetriever', () => {
  it('returns documents from harmonic index search', async () => {
    const entries = [
      makeEntry({ id: 'mem_1', primary_abstraction: 'first result' }),
      makeEntry({ id: 'mem_2', primary_abstraction: 'second result' }),
    ];
    const index = makeIndex(entries);
    const retriever = new MAFWRetriever(index);

    const docs = await retriever._getRelevantDocuments('test query');

    expect(docs).toHaveLength(2);
    expect(docs[0]).toBeInstanceOf(Document);
    expect(docs[0].pageContent).toBe('first result');
    expect(docs[0].metadata).toEqual({
      id: 'mem_1',
      type: 'semantic',
      tier: 'T2',
      energy: 0.8,
    });
    expect(docs[1].pageContent).toBe('second result');
    expect(index.search).toHaveBeenCalledWith('test query', 20);
  });

  it('respects defaultLimit', async () => {
    const entries = [
      makeEntry({ id: 'mem_1' }),
      makeEntry({ id: 'mem_2' }),
      makeEntry({ id: 'mem_3' }),
    ];
    const index = makeIndex(entries);
    const retriever = new MAFWRetriever(index, 3);

    await retriever._getRelevantDocuments('query');

    expect(index.search).toHaveBeenCalledWith('query', 3);
  });

  it('handles empty results', async () => {
    const index = makeIndex([]);
    const retriever = new MAFWRetriever(index);

    const docs = await retriever._getRelevantDocuments('nonexistent');

    expect(docs).toEqual([]);
  });

  it('has correct lc_namespace', () => {
    const index = makeIndex([]);
    const retriever = new MAFWRetriever(index);
    expect(retriever.lc_namespace).toEqual(['mafw', 'retriever']);
  });
});
