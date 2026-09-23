import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import { config } from '../../src/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, type: string): HarmonicUnit {
  const now = new Date().toISOString();
  return { id, type, primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction, energy: 0.8, created_at: now, updated_at: now } as HarmonicUnit;
}

/**
 * Synthetic mixed-type probe for Phase C4b (channelSplit). The ANSWER is a
 * SEMANTIC memory; the distractors are short EPISODIC memories with a stronger
 * BM25 match (short-doc length normalization) — so plain BM25 ranks the
 * distractors first. The split down-weights the episodic channel, so the
 * semantic answer should rise. This is the controlled test LongMemEval can't
 * provide (it ingests everything as episodic).
 */
function buildMixed(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c4b-probe-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit('answer', 'kubernetes deployment strategy is blue-green with canary gates', 'semantic'), 'semantic');
  for (let i = 0; i < 6; i++) index.addEntry(unit('ep' + i, 'kubernetes deployment', 'episodic'), 'episodic');
  return index;
}

function answerRank(index: HarmonicIndexManager): number {
  const res = index.searchScored('kubernetes deployment', 10, { retriever: 'bm25' });
  return res.findIndex(r => r.entry.id === 'answer');
}

describe('channelSplit synthetic probe (C4b)', () => {
  afterEach(() => { config.search.channelSplit.enabled = false; });

  test('开启后 semantic 答案排名不劣于关闭时（机制生效）', () => {
    config.search.channelSplit.enabled = false;
    const off = answerRank(buildMixed());
    config.search.channelSplit.enabled = true;
    const on = answerRank(buildMixed());
    // off >= 0 means the answer was found but not first; on should improve or hold.
    expect(off).toBeGreaterThanOrEqual(0);
    expect(on).toBeLessThanOrEqual(off);
    expect(on).toBe(0);
  });
});
