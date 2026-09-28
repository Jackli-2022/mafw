/**
 * Perf: scoring must not rescan every doc token per query token. The tf cache
 * must be transparent 鈥?identical scores to the naive computation.
 */
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, anchors: string[] = []): HarmonicUnit {
  return {
    id, type: 'semantic', primary_abstraction: abstraction, cue_anchors: anchors, memory_value: '',
    energy: 1, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

function build(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-cache-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit('a', 'kubernetes kubernetes deployment rollout', ['cluster']), 'semantic');
  index.addEntry(unit('b', 'kubernetes deployment notes'), 'semantic');
  index.addEntry(unit('c', 'pasta recipe tomato'), ['kubernetes']), 'semantic';
  return index;
}

/** Reference BM25 computed the naive way (scan every token). */
function naiveBm25(texts: string[][], query: string[], k1 = 1.2, b = 0.75): number[] {
  const N = texts.length;
  const lens = texts.map(t => t.length);
  const avgdl = lens.reduce((a, c) => a + c, 0) / N;
  const df = new Map<string, number>();
  for (const toks of texts) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  return texts.map((toks, i) => {
    let score = 0;
    for (const t of query) {
      const idf = Math.log((N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5) + 1);
      let tf = 0;
      for (const tok of toks) if (tok === t) tf++;
      if (tf === 0) continue;
      score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (lens[i] / avgdl)));
    }
    return score;
  });
}

describe('BM25 tf cache transparency', () => {
  test('cached scoring matches the naive reference computation', () => {
    const index = build();
    const entries = index.getIndex().entries as any[];
    const texts = entries.map(e => [...(e.primary_abstraction + ' ' + (e.cue_anchors || []).join(' ')).toLowerCase().split(/[^a-z0-9]+/).filter((w: string) => w.length >= 2)]);
    const expected = naiveBm25(texts, ['kubernetes', 'deployment']);
    const raw = index.bm25RawScores('kubernetes deployment', 10);
    // both sorted desc; compare pairwise on the positive-scoring docs
    const positives = expected.filter(s => s > 0).sort((a, b) => b - a);
    expect(raw.length).toBe(positives.length);
    raw.forEach((v, i) => expect(v).toBeCloseTo(positives[i], 9));
  });

  test('repeated queries stay identical and cheap', () => {
    const index = build();
    const first = index.bm25RawScores('kubernetes deployment', 10);
    const spy = jest.spyOn(index as any, 'tokenizeBM25');
    const second = index.bm25RawScores('kubernetes deployment', 10);
    expect(second).toEqual(first);
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1); // query only
  });
});
