/**
 * Soft-supersede enforcement at retrieval (arXiv:2609.08258): a revoked fact
 * must never be presented as authoritative. Hits on superseded entries are
 * rewritten to their supersede-chain head (keeps knowledge-update queries
 * pointing at the current version); broken chains are dropped.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicIndexManager, resolveSupersededHeads } from '../../src/core/memory/harmonic-index';

function entry(id: string, overrides: Record<string, any> = {}): any {
  return {
    id,
    type: 'semantic',
    primary_abstraction: `memory ${id}`,
    cue_anchors: [],
    tier: 'semantic',
    energy: 0.8,
    salience: 1,
    ...overrides,
  };
}

const lookupOf = (entries: any[]) => (id: string) => entries.find(e => e.id === id);

describe('resolveSupersededHeads', () => {
  test('live entries pass through unchanged', () => {
    const entries = [entry('a')];
    const out = resolveSupersededHeads([{ entry: entries[0], score: 1 }], lookupOf(entries));
    expect(out.map(s => s.entry.id)).toEqual(['a']);
  });

  test('superseded hit is rewritten to its replacement, keeping the score', () => {
    const entries = [entry('old', { superseded_by: 'new' }), entry('new')];
    const out = resolveSupersededHeads([{ entry: entries[0], score: 3 }], lookupOf(entries));
    expect(out.map(s => s.entry.id)).toEqual(['new']);
    expect(out[0].score).toBe(3);
  });

  test('multi-hop chain resolves to the live head', () => {
    const entries = [entry('a', { superseded_by: 'b' }), entry('b', { superseded_by: 'c' }), entry('c')];
    const out = resolveSupersededHeads([{ entry: entries[0], score: 1 }], lookupOf(entries));
    expect(out.map(s => s.entry.id)).toEqual(['c']);
  });

  test('two revoked hits mapping to the same head dedupe, keeping the max score', () => {
    const entries = [entry('a', { superseded_by: 'head' }), entry('b', { superseded_by: 'head' }), entry('head')];
    const out = resolveSupersededHeads(
      [{ entry: entries[0], score: 1 }, { entry: entries[1], score: 5 }],
      lookupOf(entries),
    );
    expect(out.map(s => s.entry.id)).toEqual(['head']);
    expect(out[0].score).toBe(5);
  });

  test('dangling superseded_by is dropped, not surfaced', () => {
    const entries = [entry('old', { superseded_by: 'missing' })];
    expect(resolveSupersededHeads([{ entry: entries[0], score: 1 }], lookupOf(entries))).toEqual([]);
  });

  test('cycle is dropped', () => {
    const entries = [entry('a', { superseded_by: 'b' }), entry('b', { superseded_by: 'a' })];
    expect(resolveSupersededHeads([{ entry: entries[0], score: 1 }], lookupOf(entries))).toEqual([]);
  });

  test('chain deeper than maxDepth is dropped', () => {
    const entries = [entry('a', { superseded_by: 'b' }), entry('b', { superseded_by: 'c' }), entry('c')];
    expect(resolveSupersededHeads([{ entry: entries[0], score: 1 }], lookupOf(entries), 1)).toEqual([]);
  });

  test('output is sorted by score desc', () => {
    const entries = [entry('a'), entry('b')];
    const out = resolveSupersededHeads([{ entry: entries[0], score: 1 }, { entry: entries[1], score: 9 }], lookupOf(entries));
    expect(out.map(s => s.entry.id)).toEqual(['b', 'a']);
  });
});

describe('searchScored enforces supersede', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'supersede-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('revoked entry never appears; its replacement does', () => {
    const memDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, '.harmonic_index.json'),
      JSON.stringify({
        version: 2,
        updated_at: new Date().toISOString(),
        entries: [
          entry('old', { primary_abstraction: 'widget config port 8080', superseded_by: 'new' }),
          entry('new', { primary_abstraction: 'widget config port 9090' }),
        ],
      }, null, 2),
      'utf-8',
    );

    const mgr = new HarmonicIndexManager(tmpDir);
    const ids = mgr.searchScored('widget config port', 10).map(s => s.entry.id);
    expect(ids).not.toContain('old');
    expect(ids).toContain('new');
    expect(ids.filter(id => id === 'new')).toHaveLength(1);
  });
});
