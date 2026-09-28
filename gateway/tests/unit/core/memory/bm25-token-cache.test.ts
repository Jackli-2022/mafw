/**
 * Root-cause fix: bm25RawScored re-tokenized the ENTIRE corpus on every query
 * (3752 entries ≈ 50ms at the time of measurement), and query expansion
 * multiplies that by ~15 → the boundary recall path ran at ~109ms in-process
 * (240ms over HTTP), silently blowing the plugin's 100ms contract.
 *
 * The fix memoizes per-entry tokens, keyed by id and validated against the
 * searchable text, so repeated queries tokenize nothing but the query itself.
 */
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: ['anchor'], memory_value: abstraction,
    energy: 0.8, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

function build(n: number): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tok-cache-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  for (let i = 0; i < n; i++) index.addEntry(unit(`id${i}`, `kubernetes deployment note number ${i}`), 'semantic');
  return index;
}

describe('BM25 token cache', () => {
  test('second query does not re-tokenize the corpus (only the query)', () => {
    const index = build(20);
    const spy = jest.spyOn(index as any, 'tokenizeBM25');

    index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' });
    const first = spy.mock.calls.length;
    expect(first).toBeGreaterThanOrEqual(20); // corpus + query

    spy.mockClear();
    index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' });
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1); // query only
  });

  test('results are identical across repeated queries', () => {
    const index = build(10);
    const a = index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    const b = index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    expect(a).toEqual(b);
  });

  test('a changed abstraction invalidates that entry (cache follows the text)', () => {
    const index = build(3);
    index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }); // warm cache
    const entry = index.getIndex().entries.find(e => e.id === 'id0')!;
    entry.primary_abstraction = 'pasta recipe tomato sauce';
    const hits = index.searchScored('pasta recipe', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    expect(hits).toContain('id0');
    const old = index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    expect(old).not.toContain('id0');
  });

  test('removed entries do not leak stale hits', () => {
    const index = build(3);
    index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }); // warm cache
    // getIndex() returns a shallow copy; go through the private field to actually
    // remove an entry from the live index.
    (index as any).index.entries = (index as any).index.entries.filter((e: any) => e.id !== 'id1');
    const hits = index.searchScored('kubernetes deployment', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    expect(hits).not.toContain('id1');
  });
});
