/**
 * P1c: dense+BM25 hybrid retrieval — RRF fusion (pure fn) and the
 * searchScored denseScores option.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { HarmonicIndexManager, rrfFuse, SearchOptions } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-hybrid-'));
}

function unit(id: string, abstraction: string, energy = 0.8): HarmonicUnit {
  return {
    id,
    type: 'semantic',
    primary_abstraction: abstraction,
    cue_anchors: [],
    memory_value: 'value of ' + id,
    energy,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as HarmonicUnit;
}

function makeIndex(dir: string, units: HarmonicUnit[]): HarmonicIndexManager {
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  for (const u of units) index.addEntry(u, 'semantic');
  return index;
}

describe('rrfFuse', () => {
  const e = (id: string, score: number) => ({ entry: { id } as any, score });

  test('entry present in both lists outranks single-list entries', () => {
    const primary = [e('a', 10), e('b', 8), e('c', 6)];
    const secondary = [e('b', 0.99), e('d', 0.9)];
    const fused = rrfFuse(primary, secondary, 60, 10);
    const ids = fused.map(f => f.entry.id);
    expect(ids.indexOf('b')).toBe(0); // top of both lists
    expect(ids).toContain('d'); // secondary-only survives
    expect(ids).toContain('c'); // primary-only survives
  });

  test('rank order is respected (top beats bottom within a list)', () => {
    const primary = [e('a', 10), e('b', 1)];
    const secondary: Array<{ entry: { id: string }; score: number }> = [];
    const fused = rrfFuse(primary, secondary, 60, 10);
    expect(fused.map(f => f.entry.id)).toEqual(['a', 'b']);
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });

  test('slices to recallK', () => {
    const primary = Array.from({ length: 20 }, (_, i) => e('p' + i, 20 - i));
    const fused = rrfFuse(primary, [], 60, 5);
    expect(fused).toHaveLength(5);
  });
});

describe('searchScored denseScores fusion', () => {
  test('dense-only relevant entry surfaces despite zero BM25 overlap', () => {
    const dir = tmpDir();
    // "prefers dark mode" shares no tokens with the query "喜欢深色主题" (CJK unigrams differ)
    const index = makeIndex(dir, [
      unit('bm25-hit', 'user prefers vim editor for coding'),
      unit('dense-hit', 'user interface color theme preferences'),
    ]);
    const denseScores = new Map<string, number>([
      ['dense-hit', 0.92],
      ['bm25-hit', 0.55],
    ]);

    const results = index.searchScored('喜欢深色主题', 2, {
      retriever: 'bm25',
      denseScores,
    } as SearchOptions);

    const ids = results.map(r => r.entry.id);
    expect(ids).toContain('dense-hit');
    expect(ids[0]).toBe('dense-hit');
  });

  test('equal cosine → higher energy ranks higher in the dense channel', () => {
    const dir = tmpDir();
    const index = makeIndex(dir, [
      unit('low-energy', 'alpha topic entry', 0.3),
      unit('high-energy', 'beta topic entry', 0.9),
    ]);
    // Query shares no tokens with either entry → BM25 contributes nothing.
    const denseScores = new Map<string, number>([
      ['low-energy', 0.9],
      ['high-energy', 0.9],
    ]);

    const results = index.searchScored('zzzunrelated', 2, {
      retriever: 'bm25',
      denseScores,
    } as SearchOptions);

    expect(results[0].entry.id).toBe('high-energy');
  });

  test('without denseScores the result equals plain bm25 (regression)', () => {
    const dir = tmpDir();
    const index = makeIndex(dir, [
      unit('a', 'kubernetes cluster setup'),
      unit('b', 'chocolate cake recipe'),
    ]);
    const plain = index.searchScored('kubernetes cluster setup', 2, { retriever: 'bm25' });
    const withEmptyMap = index.searchScored('kubernetes cluster setup', 2, {
      retriever: 'bm25',
      denseScores: new Map(),
    } as SearchOptions);
    expect(withEmptyMap.map(r => r.entry.id)).toEqual(plain.map(r => r.entry.id));
  });
});
