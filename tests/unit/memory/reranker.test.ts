import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager, ScoredEntry } from '../../../gateway/src/core/memory/harmonic-index';
import { HeuristicReranker, createReranker, applyReranker } from '../../../gateway/src/core/memory/reranker';

describe('HeuristicReranker', () => {
  function makeEntry(id: string, score: number, energy = 0.8, salience?: number, createdAt?: string): ScoredEntry {
    return {
      entry: {
        id,
        type: 'semantic',
        primary_abstraction: `entry ${id}`,
        cue_anchors: [],
        tier: 'tier1',
        energy,
        salience,
        created_at: createdAt,
      },
      score,
    };
  }

  it('returns topK results sorted by fused score', () => {
    const r = new HeuristicReranker();
    const candidates = [
      makeEntry('a', 10, 0.5),
      makeEntry('b', 20, 0.9),
      makeEntry('c', 5, 0.6),
    ];
    const result = r.rerank('q', candidates, 2);
    expect(result.map(x => x.entry.id)).toEqual(['b', 'a']);
  });

  it('boosts newer entries when dates differ', () => {
    const r = new HeuristicReranker({ weights: { bm25: 0.2, recency: 0.6, energy: 0.1, salience: 0.1 } });
    const candidates = [
      makeEntry('old', 10, 0.8, 1, '2023-01-01T00:00:00.000Z'),
      makeEntry('new', 10, 0.8, 1, '2023-01-10T00:00:00.000Z'),
    ];
    const result = r.rerank('q', candidates, 2);
    expect(result[0].entry.id).toBe('new');
  });

  it('applies cutoff ratio', () => {
    const r = new HeuristicReranker({ cutoffRatio: 0.5 });
    const candidates = [
      makeEntry('top', 100, 0.8),
      makeEntry('mid', 60, 0.8),
      makeEntry('low', 30, 0.8),
    ];
    const result = r.rerank('q', candidates, 10);
    // With cutoff 0.5, only entries >= 50 are kept; low (normalized score below 0.5 of top) is dropped
    expect(result.map(x => x.entry.id)).toEqual(['top', 'mid']);
  });

  it('returns empty for empty candidates', () => {
    expect(new HeuristicReranker().rerank('q', [], 5)).toEqual([]);
  });
});

describe('createReranker', () => {
  it('returns null for off', () => {
    expect(createReranker('off')).toBeNull();
  });

  it('returns HeuristicReranker for heuristic', () => {
    const r = createReranker('heuristic');
    expect(r).not.toBeNull();
    expect(r!.name).toBe('heuristic');
  });

  it('returns CrossEncoderReranker for cross-encoder', () => {
    const r = createReranker('cross-encoder');
    expect(r).not.toBeNull();
    expect(r!.name).toBe('cross-encoder');
  });
});

describe('applyReranker integration', () => {
  let tmpDir: string;
  let manager: HarmonicIndexManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-rerank-'));
    fs.mkdirSync(path.join(tmpDir, 'memory'), { recursive: true });
    manager = new HarmonicIndexManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uses applyReranker to boost newer memories over BM25 baseline', async () => {
    manager.addEntry({
      id: 'old', type: 'semantic', primary_abstraction: 'project alpha status', cue_anchors: ['alpha'],
      memory_value: '', energy: 0.8, salience: 1, created_at: '2023-01-01T00:00:00.000Z', updated_at: '',
    }, 'tier1');
    manager.addEntry({
      id: 'new', type: 'semantic', primary_abstraction: 'project alpha updated', cue_anchors: ['alpha'],
      memory_value: '', energy: 0.8, salience: 1, created_at: '2023-06-01T00:00:00.000Z', updated_at: '',
    }, 'tier1');

    const candidates = manager.searchScored('alpha', 10, { retriever: 'bm25' });
    const reranker = new HeuristicReranker({ weights: { bm25: 0.1, recency: 0.8, energy: 0.05, salience: 0.05 } });
    const results = await applyReranker('alpha', candidates, reranker, 2);
    expect(results[0].entry.id).toBe('new');
  });
});
