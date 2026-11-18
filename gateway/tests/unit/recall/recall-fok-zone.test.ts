/**
 * R5 wiring: the boundary-recall exit classifies the raw BM25 score
 * distribution into a three-zone FOK gate. Disabled by default; fail-open
 * (never suppress recall because the gate itself failed).
 */
import { computeRecallFokZone, evaluateRecallFokZone } from '../../../src/recall/recall-context';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string): HarmonicUnit {
  return {
    id, type: 'episodic', primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction,
    energy: 0.8, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

/** One dominant doc (term repeated) + two weak docs → high top1/mean ratio. */
function dominantIndex(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fok-zone-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit('dom', 'kubernetes kubernetes kubernetes deployment rollout'), 'episodic');
  index.addEntry(unit('weak1', 'kubernetes cooking pasta'), 'episodic');
  index.addEntry(unit('weak2', 'kubernetes gardening tips'), 'episodic');
  return index;
}

/** Identical docs → tied scores → flat distribution → weak evidence. */
function flatIndex(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fok-zone-flat-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit('a', 'kubernetes deployment notes'), 'episodic');
  index.addEntry(unit('b', 'kubernetes deployment notes'), 'episodic');
  return index;
}

const CFG = { enabled: true, low: 1.2, high: 1.35 };

describe('computeRecallFokZone', () => {
  test('disabled config → inject (gate off)', () => {
    expect(computeRecallFokZone(flatIndex(), 'kubernetes', { ...CFG, enabled: false })).toBe('inject');
  });

  test('undefined config → inject (fail-open)', () => {
    expect(computeRecallFokZone(flatIndex(), 'kubernetes', undefined)).toBe('inject');
  });

  test('index without raw scorer → inject (fail-open)', () => {
    expect(computeRecallFokZone({}, 'kubernetes', CFG)).toBe('inject');
  });

  test('dominant top-1 → inject', () => {
    expect(computeRecallFokZone(dominantIndex(), 'kubernetes deployment', CFG)).toBe('inject');
  });

  test('flat distribution → no-memory', () => {
    expect(computeRecallFokZone(flatIndex(), 'kubernetes deployment', CFG)).toBe('no-memory');
  });

  test('no match at all → no-memory (explicit, not silence)', () => {
    expect(computeRecallFokZone(flatIndex(), 'zzz nonexistent term', CFG)).toBe('no-memory');
  });
});

describe('evaluateRecallFokZone (evaluated signal)', () => {
  test('disabled config is not evaluated and stays inject', () => {
    const result = evaluateRecallFokZone(flatIndex(), 'kubernetes', { ...CFG, enabled: false });
    expect(result).toEqual({ zone: 'inject', evaluated: false });
  });

  test('undefined config is not evaluated and stays inject', () => {
    expect(evaluateRecallFokZone(flatIndex(), 'kubernetes', undefined))
      .toEqual({ zone: 'inject', evaluated: false });
  });

  test('index without a raw scorer is not evaluated and stays inject', () => {
    expect(evaluateRecallFokZone({}, 'kubernetes', CFG))
      .toEqual({ zone: 'inject', evaluated: false });
  });

  test('a throwing raw scorer is not evaluated and stays inject', () => {
    const index = { bm25RawScores: () => { throw new Error('scorer exploded'); } };
    expect(evaluateRecallFokZone(index, 'kubernetes', CFG))
      .toEqual({ zone: 'inject', evaluated: false });
  });

  test('dominant top-1 is an evaluated inject', () => {
    expect(evaluateRecallFokZone(dominantIndex(), 'kubernetes deployment', CFG))
      .toEqual({ zone: 'inject', evaluated: true });
  });

  test('flat distribution is an evaluated no-memory', () => {
    expect(evaluateRecallFokZone(flatIndex(), 'kubernetes deployment', CFG))
      .toEqual({ zone: 'no-memory', evaluated: true });
  });
});
