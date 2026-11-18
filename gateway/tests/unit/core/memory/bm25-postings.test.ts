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
import { computeRecallFokZone } from '../../../../src/recall/recall-context';
import { classifyFok, computeFokFeatures } from '../../../../src/recall/fok-gate';
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

/**
 * The boundary route calls `bm25RawScores(query, 10)` a second time for the same
 * query after `searchRecallMemories` already scored it (FOK gate). Raw BM25 is
 * deterministic while the index text/membership is unchanged, so the second
 * pass must reuse it — measured 43.6ms p50 per turn on the live 16.8k corpus,
 * of which ~24ms is the idf/postings scoring loop that is safe to skip.
 *
 * Oracles are structural (postings consulted or not) or exact value parity,
 * never wall-clock.
 */
describe('BM25 raw-score reuse for the same query (FOK pass)', () => {
  const corpus: Array<[string, string[]]> = [
    ['shared topic alpha', ['one']],
    ['shared topic beta', ['two']],
    ['shared topic gamma with a much longer tail', ['three']],
    ['unrelated cooking notes', ['kitchen']],
  ];

  function seeded(): HarmonicIndexManager {
    const index = build(corpus.map(([a, c], i) => unit(`d${i}`, a, c)));
    index.bm25RawScores('warmup', 5); // build docs + postings once
    return index;
  }

  function naiveScores(index: HarmonicIndexManager, query: string, topK: number): number[] {
    const tokenize = (text: string) => (index as any).tokenizeBM25(text) as string[];
    const docs = (index.getIndex().entries as any[]).map(e => ({ id: e.id, text: searchableText(e) }));
    return naiveBm25(tokenize, docs, query)
      .map(r => r.raw)
      .sort((a, b) => b - a)
      .slice(0, topK);
  }

  test('a repeated same-query call does not re-score (postings not consulted)', () => {
    const index = seeded();
    const spy = jest.spyOn(index as any, 'postingsIndex');
    index.bm25RawScores('shared topic', 10);
    expect(spy).toHaveBeenCalledTimes(1); // first (cold) call still scores
    spy.mockClear();
    index.bm25RawScores('shared topic', 10);
    expect(spy).not.toHaveBeenCalled(); // RED today: scores the corpus again
  });

  test('topK is a slice of the same deterministic scores (1 / 3 / 10 / 20 agree)', () => {
    const index = seeded();
    index.bm25RawScores('shared topic', 10); // warm the reuse entry
    const spy = jest.spyOn(index as any, 'postingsIndex');
    const full = index.bm25RawScores('shared topic', 20);
    expect(index.bm25RawScores('shared topic', 10)).toEqual(full.slice(0, 10));
    expect(index.bm25RawScores('shared topic', 3)).toEqual(full.slice(0, 3));
    expect(index.bm25RawScores('shared topic', 1)).toEqual(full.slice(0, 1));
    expect(spy).not.toHaveBeenCalled();
    expect(full).toEqual(naiveScores(index, 'shared topic', 20));
  });

  test('a different query is scored independently (no cross-query contamination)', () => {
    const index = seeded();
    const shared = index.bm25RawScores('shared topic', 10); // first scoring of this query
    const spy = jest.spyOn(index as any, 'postingsIndex');
    index.bm25RawScores('cooking notes', 10); // different query → must score
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    expect(index.bm25RawScores('cooking notes', 10)).toEqual(naiveScores(index, 'cooking notes', 10));
    expect(spy).not.toHaveBeenCalled(); // its own reuse entry
    expect(index.bm25RawScores('shared topic', 10)).toEqual(shared);
  });

  test('addEntry invalidates the reused scores (df/N move)', () => {
    const index = seeded();
    const before = index.bm25RawScores('shared topic', 10);
    index.addEntry(unit('d5', 'shared topic delta'), 'semantic', { save: false });
    const after = index.bm25RawScores('shared topic', 10);
    expect(after.length).toBe(before.length + 1);
    expect(after).toEqual(naiveScores(index, 'shared topic', 10));
    expect(after).not.toEqual(before);
  });

  test('removeEntry invalidates the reused scores (df/N move)', () => {
    const index = seeded();
    index.bm25RawScores('shared topic', 10);
    index.removeEntry('d0');
    const after = index.bm25RawScores('shared topic', 10);
    expect(after.length).toBe(2);
    expect(after).toEqual(naiveScores(index, 'shared topic', 10));
  });

  test('in-place text mutation invalidates even when only bm25RawScores is called', () => {
    const index = seeded();
    const warm = index.bm25RawScores('shared topic', 10);
    expect(warm.length).toBe(3);
    const entry = index.getIndex().entries.find((e: any) => e.id === 'd0')!;
    entry.primary_abstraction = 'rewired_quokka unrelated'; // no addEntry/removeEntry
    const after = index.bm25RawScores('shared topic', 10);
    expect(after.length).toBe(2);
    expect(after).toEqual(naiveScores(index, 'shared topic', 10));
  });

  test('duplicate ids keep one raw value per physical entry and stay reusable', () => {
    // Identical text: legacy duplicate rows (same unit written twice) — the
    // id-keyed token cache does not thrash, so reuse must engage. Differing-text
    // duplicates are covered by the parity test in the postings suite above.
    const rawEntries = [
      { id: 'dup', type: 'semantic', primary_abstraction: 'shared topic alpha', cue_anchors: ['one'], energy: 1, salience: 1 },
      { id: 'dup', type: 'semantic', primary_abstraction: 'shared topic alpha', cue_anchors: ['one'], energy: 1, salience: 1 },
      { id: 'other', type: 'semantic', primary_abstraction: 'cooking notes', cue_anchors: ['three'], energy: 1, salience: 1 },
    ];
    const index = buildFromFile(rawEntries);
    const first = index.bm25RawScores('shared topic', 10);
    expect(first.length).toBe(2); // one value per PHYSICAL entry, not one per id
    expect(first[0]).toBeCloseTo(first[1], 12);
    const spy = jest.spyOn(index as any, 'postingsIndex');
    const second = index.bm25RawScores('shared topic', 10);
    expect(second).toEqual(first);
    expect(spy).not.toHaveBeenCalled();
    expect(second).toEqual(naiveScores(index, 'shared topic', 10));
  });

  test('callers cannot poison the reused scores or the raw rows', () => {
    const index = seeded();
    const expected = index.bm25RawScores('shared topic', 10);
    const rowsExpected = ((index as any).bm25RawScored('shared topic') as any[]).map(r => ({ id: r.entry.id, raw: r.raw }));

    const scores = index.bm25RawScores('shared topic', 10);
    scores[0] = 9999;
    scores.reverse();
    const rows = (index as any).bm25RawScored('shared topic') as any[];
    rows[0].raw = -1;
    rows.reverse();
    rows.length = 0;

    expect(index.bm25RawScores('shared topic', 10)).toEqual(expected);
    expect(((index as any).bm25RawScored('shared topic') as any[]).map(r => ({ id: r.entry.id, raw: r.raw }))).toEqual(rowsExpected);
  });

  test('FOK zone parity: memoized and fresh scoring classify identically', () => {
    const cfg = { enabled: true, low: 1.2, high: 1.35 };
    const index = seeded();
    const expectedTop = naiveScores(index, 'shared topic', 10);
    const expectedZone = classifyFok(computeFokFeatures(expectedTop), cfg);

    expect(computeRecallFokZone(index, 'shared topic', cfg, 10)).toBe(expectedZone);
    // Second call is served from the reuse path — same zone, same features.
    expect(computeRecallFokZone(index, 'shared topic', cfg, 10)).toBe(expectedZone);
    expect(index.bm25RawScores('shared topic', 10)).toEqual(expectedTop);
  });
});
