/**
 * BM25 must not scan every document for every query token.
 *
 * The boundary recall path calls the scorer 5–10 times per turn (initial pass,
 * up to four expansion passes, one FOK pass). With 16.8k entries and long
 * prompts (200+ query tokens after CJK/identifier splitting) that is
 * ~3.7M Map lookups *per pass* — measured p50 279ms + 101ms just for BM25 on
 * the live corpus.
 *
 * Oracle is structural (a tf-lookup count) or an exact naive re-implementation
 * — never wall-clock. Parity matters in two corners that a naive inverted
 * index gets wrong: duplicate ids (legacy index files may carry them; load()
 * deliberately does not dedupe) and in-place entry mutation (which bypasses
 * addEntry/removeEntry).
 */
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Track temp dirs so the suite leaves nothing behind.
const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  tmpDirs.push(dir);
  return dir;
}

function unit(id: string, abstraction: string, anchors: string[] = []): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: anchors, memory_value: '',
    energy: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

function build(units: HarmonicUnit[]): HarmonicIndexManager {
  const index = new HarmonicIndexManager(tmpDir('bm25-postings-'));
  for (const u of units) index.addEntry(u, 'semantic', { save: false });
  return index;
}

/** Index file → manager, so duplicate ids survive exactly as they do on disk. */
function buildFromFile(rawEntries: Array<Record<string, unknown>>): HarmonicIndexManager {
  const dir = tmpDir('bm25-postings-file-');
  fs.writeFileSync(
    path.join(dir, 'memory', '.harmonic_index.json'),
    JSON.stringify({ version: 1, updated_at: '2024-01-01T00:00:00Z', entries: rawEntries }, null, 2),
    'utf-8',
  );
  return new HarmonicIndexManager(dir);
}

type Doc = { entry: { id: string }; tf: Map<string, number>; len: number };

/**
 * Reference BM25, naive full scan. Documents and the query are tokenized with
 * the PRODUCTION tokenizer (CJK unigrams + splitIdentifierParts), so the only
 * thing this differs in is the algorithm — not the tokenization.
 */
function naiveBm25(
  tokenize: (text: string) => string[],
  docs: Array<{ id: string; text: string }>,
  query: string,
  k1 = 1.2,
  b = 0.75,
): Array<{ id: string; raw: number }> {
  const N = docs.length;
  const docTokens = docs.map(d => tokenize(d.text));
  const lens = docTokens.map(t => t.length);
  const avgdl = lens.reduce((a, c) => a + c, 0) / N;
  const queryTokens = tokenize(query);
  const df = new Map<string, number>();
  for (const toks of docTokens) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const out: Array<{ id: string; raw: number }> = [];
  docTokens.forEach((toks, i) => {
    let score = 0;
    for (const t of queryTokens) {
      const idf = Math.log((N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5) + 1);
      let tf = 0;
      for (const tok of toks) if (tok === t) tf++;
      if (tf === 0) continue;
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (lens[i] / avgdl)));
    }
    if (score > 0) out.push({ id: docs[i].id, raw: score });
  });
  return out;
}

function rawOf(index: HarmonicIndexManager, query: string): Array<{ id: string; raw: number }> {
  return ((index as any).bm25RawScored(query) as Array<{ entry: { id: string }; raw: number }>)
    .map(r => ({ id: r.entry.id, raw: r.raw }));
}

function searchableText(entry: any): string {
  return entry.primary_abstraction + ' ' + (entry.cue_anchors || []).join(' ');
}

describe('BM25 postings (no full-corpus scan per query token)', () => {
  test('a rare term consults only the documents that contain it', () => {
    const units: HarmonicUnit[] = [];
    for (let i = 0; i < 48; i++) units.push(unit(`filler_${i}`, `common filler token number${i}`));
    units.push(unit('hit_a', 'needle in the haystack', ['amsterdam']));
    units.push(unit('hit_b', 'another needle sighting', ['utrecht']));
    const index = build(units);

    // Warm the per-entry token cache (the scorer's own memo) before counting.
    index.bm25RawScores('warmup', 5);

    const cache: Map<string, { tf: Map<string, number> }> = (index as any).tokenCache;
    const gets = new Map<string, number>();
    let total = 0;
    for (const [id, cached] of cache) {
      const tf = cached.tf;
      cached.tf = new Proxy(tf, {
        get(target, prop, receiver) {
          if (prop === 'get') {
            gets.set(id, (gets.get(id) || 0) + 1);
            total++;
          }
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }) as Map<string, number>;
    }

    const scores = index.bm25RawScores('needle', 10);
    expect(scores.length).toBe(2);

    // 50 docs × 1 query token = 50 lookups without postings; only 2 docs match.
    expect(total).toBeLessThanOrEqual(4);
    expect([...gets.keys()].sort()).toEqual(['hit_a', 'hit_b']);
  });

  test('scores stay identical to the naive reference (duplicate tokens, CJK, camelCase, snake_case, absent term)', () => {
    const corpus: Array<[string, string[]]> = [
      ['kubernetes deployment rollout', ['cluster', 'k8s']],
      ['kubernetes notes', ['cluster']],
      ['pasta recipe tomato', ['kitchen']],
      ['memory 谐波 索引 性能', ['记忆']],
      ['gateway 快照 latency', ['snapshot']],
      ['getUserAuthToken rotation policy', ['authModule', 'snake_case_anchor']],
      ['snake_case_identifier handling', ['build_pipeline', 'camelCaseCue']],
    ];
    const index = build(corpus.map(([a, c], i) => unit(`u${i}`, a, c)));
    const entries = index.getIndex().entries as any[];
    const docs = entries.map(e => ({ id: e.id, text: searchableText(e) }));
    const tokenize = (text: string) => (index as any).tokenizeBM25(text) as string[];

    for (const query of [
      'kubernetes deployment',
      'kubernetes kubernetes',
      'needle absent',
      '记忆 索引',
      'gateway 快照',
      'getUserAuthToken rotation',
      'snake_case identifier build_pipeline',
    ]) {
      const expected = naiveBm25(tokenize, docs, query);
      const actual = rawOf(index, query);
      expect(actual.map(r => r.id)).toEqual(expected.map(r => r.id));
      actual.forEach((r, i) => expect(r.raw).toBeCloseTo(expected[i].raw, 12));
    }
  });

  test('duplicate ids get one independent score per physical entry (legacy parity)', () => {
    const rawEntries = [
      { id: 'dup', type: 'semantic', primary_abstraction: 'shared topic alpha', cue_anchors: ['one'], energy: 1, salience: 1 },
      { id: 'other', type: 'semantic', primary_abstraction: 'shared topic beta', cue_anchors: ['two'], energy: 1, salience: 1 },
      { id: 'dup', type: 'semantic', primary_abstraction: 'shared topic gamma with a much longer tail', cue_anchors: ['three'], energy: 1, salience: 1 },
    ];
    const index = buildFromFile(rawEntries);
    const entries = index.getIndex().entries as any[];
    expect(entries.map(e => e.id)).toEqual(['dup', 'other', 'dup']); // load() must not dedupe

    const tokenize = (text: string) => (index as any).tokenizeBM25(text) as string[];
    const docs = entries.map(e => ({ id: e.id, text: searchableText(e) }));
    const expected = naiveBm25(tokenize, docs, 'shared topic');

    const actual = rawOf(index, 'shared topic');
    expect(actual).toHaveLength(3); // one row per PHYSICAL entry, not per id
    expect(actual.map(r => r.id)).toEqual(expected.map(r => r.id));
    // Each duplicate carries its own single-document score — never the sum.
    actual.forEach((r, i) => expect(r.raw).toBeCloseTo(expected[i].raw, 12));
    const dupRaws = actual.filter(r => r.id === 'dup').map(r => r.raw);
    expect(dupRaws[0]).not.toBeCloseTo(dupRaws[1], 6); // different docs, different lengths
  });

  test('in-place cue_anchors mutation invalidates postings (same entries array/object)', () => {
    const index = build([unit('a', 'alpha summary', ['zebraword', 'sharedword']), unit('b', 'beta summary', ['sharedword'])]);
    index.bm25RawScores('alpha summary', 5); // warm docs + postings

    const liveEntries = (index as any).index.entries;
    const entry = index.getIndex().entries.find((e: any) => e.id === 'a')!;
    // In-place edit: same array, same object — no addEntry/removeEntry involved.
    entry.cue_anchors = ['quokkaword', 'sharedword'];
    expect((index as any).index.entries).toBe(liveEntries);

    expect(index.bm25RawScores('quokkaword', 5).length).toBe(1);
    expect(index.bm25RawScores('zebraword', 5).length).toBe(0);

    const tokenize = (text: string) => (index as any).tokenizeBM25(text) as string[];
    const docs = (index.getIndex().entries as any[]).map(e => ({ id: e.id, text: searchableText(e) }));
    const expected = naiveBm25(tokenize, docs, 'quokkaword');
    rawOf(index, 'quokkaword').forEach((r, i) => expect(r.raw).toBeCloseTo(expected[i].raw, 12));
  });

  test('removal updates df/N for the surviving document (not just dropping a row)', () => {
    const index = build([
      unit('a', 'shared common term alpha'),
      unit('b', 'shared common term beta'),
      unit('c', 'shared common term gamma'),
    ]);
    const before = rawOf(index, 'shared common');
    expect(before).toHaveLength(3);

    index.removeEntry('a');

    const tokenize = (text: string) => (index as any).tokenizeBM25(text) as string[];
    const docs = (index.getIndex().entries as any[]).map(e => ({ id: e.id, text: searchableText(e) }));
    const expected = naiveBm25(tokenize, docs, 'shared common');
    const actual = rawOf(index, 'shared common');

    expect(actual.map(r => r.id)).toEqual(['b', 'c']);
    // df moved 3 → 2 and N moved 3 → 2, so the survivor's idf/length terms move too.
    actual.forEach((r, i) => expect(r.raw).toBeCloseTo(expected[i].raw, 12));
    const survivorBefore = before.find(r => r.id === 'b')!.raw;
    expect(actual.find(r => r.id === 'b')!.raw).not.toBeCloseTo(survivorBefore, 9);
  });

  test('the postings index is reused across repeated queries', () => {
    const index = build([unit('a', 'alpha beta'), unit('b', 'beta gamma')]);
    index.bm25RawScores('beta', 5);
    const first = (index as any).postingsCache?.byTerm;
    index.bm25RawScores('gamma', 5);
    const second = (index as any).postingsCache?.byTerm;
    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });
});
