/**
 * R5 FOK gate needs *raw* BM25 scores: the gate judges retrieval's own
 * evidence strength, so it must not be distorted by the energy×salience
 * multiplier (which is a recency/importance prior, not relevance).
 */
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, energy: number): HarmonicUnit {
  return {
    id, type: 'episodic', primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction,
    energy, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

function build(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm25-raw-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  // identical text, different energy: raw scores must tie, weighted must not.
  index.addEntry(unit('hi', 'kubernetes deployment notes', 0.9), 'episodic');
  index.addEntry(unit('lo', 'kubernetes deployment notes', 0.1), 'episodic');
  return index;
}

describe('bm25RawScores (FOK feature source)', () => {
  test('ignores energy weighting (ties stay tied)', () => {
    const raw = build().bm25RawScores('kubernetes deployment', 10);
    expect(raw).toHaveLength(2);
    expect(raw[0]).toBeCloseTo(raw[1], 9);
  });

  test('bm25SearchScored DOES apply energy (contrast)', () => {
    const weighted = build().bm25SearchScored('kubernetes deployment', 10);
    expect(weighted.map(s => s.entry.id)).toEqual(['hi', 'lo']);
    expect(weighted[0].score).toBeGreaterThan(weighted[1].score);
  });

  test('returns descending scores and caps at topK', () => {
    const index = build();
    const raw = index.bm25RawScores('kubernetes deployment', 1);
    expect(raw).toHaveLength(1);
  });

  test('no match → empty', () => {
    expect(build().bm25RawScores('zzz nonexistent token', 10)).toEqual([]);
  });
});
