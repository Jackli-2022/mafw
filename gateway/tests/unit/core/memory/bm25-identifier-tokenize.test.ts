/**
 * R7 deterministic cue extraction — identifier-aware dual indexing.
 *
 * Encoding specificity (Tulving & Thomson 1973): retrieval succeeds when the
 * *literal* cue present at write time is available at query time. The old
 * tokenizer collapsed `searchScored` to one token, so a query written
 * "search scored" (or a memory written that way) never matched. The fix keeps
 * the joined token AND indexes the camelCase/snake_case parts — additive only,
 * never filtering (the R1 lesson: never rewrite away the literal cue).
 */
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction,
    energy: 0.8, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

function build(abstractions: Array<[string, string]>): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r7-tok-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  for (const [id, text] of abstractions) index.addEntry(unit(id, text), 'semantic');
  return index;
}

const ids = (r: any[]) => r.map(e => e.entry.id);

describe('R7 identifier-aware tokenization', () => {
  test('camelCase memory is found by the split query', () => {
    const index = build([['a', 'searchScored requires explicit retriever bm25 option']]);
    expect(ids(index.searchScored('search scored', 5, { retriever: 'bm25' }))).toContain('a');
  });

  test('camelCase memory is still found by the exact query (no regression)', () => {
    const index = build([['a', 'searchScored requires explicit retriever bm25 option']]);
    expect(ids(index.searchScored('searchScored', 5, { retriever: 'bm25' }))).toContain('a');
  });

  test('split-written memory is found by the camelCase query (reverse direction)', () => {
    const index = build([['b', 'search scored behavior notes']]);
    expect(ids(index.searchScored('searchScored', 5, { retriever: 'bm25' }))).toContain('b');
  });

  test('snake_case memory is found by the spaced query', () => {
    const index = build([['c', 'harmonic_index decay baseline migration']]);
    expect(ids(index.searchScored('harmonic index', 5, { retriever: 'bm25' }))).toContain('c');
  });

  test('identifier expansion does not create spurious matches', () => {
    const index = build([
      ['x', 'kubernetes deployment rollout'],
      ['y', 'searchScored requires explicit retriever bm25 option'],
    ]);
    const res = ids(index.searchScored('pasta recipes', 5, { retriever: 'bm25' }));
    expect(res).toHaveLength(0);
  });

  test('rankings for plain text queries are unaffected', () => {
    const index = build([
      ['p', 'kubernetes deployment rollout notes'],
      ['q', 'cooking pasta recipes'],
    ]);
    expect(ids(index.searchScored('cooking pasta', 5, { retriever: 'bm25' }))[0]).toBe('q');
  });
});
