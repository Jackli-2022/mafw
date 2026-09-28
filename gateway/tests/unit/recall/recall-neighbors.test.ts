/**
 * R6 presentation wiring: chronological neighbours of the returned memories,
 * keyed by anchor id — presentation only (neighbours never re-rank; the L1
 * metric cannot see them, so the effect is measured at L2).
 */
import { recallNeighbors } from '../../../src/recall/recall-context';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function unit(id: string, abstraction: string, session: string, created_at: string): HarmonicUnit {
  return {
    id, type: 'episodic', primary_abstraction: abstraction, cue_anchors: [], memory_value: abstraction,
    energy: 0.8, created_at, updated_at: created_at, source_session_id: session,
  } as HarmonicUnit;
}

function build(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-recall-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  index.addEntry(unit('s1a', 'gardening tips', 'A', '2024-01-01T00:00:00Z'), 'episodic');
  index.addEntry(unit('hit', 'kubernetes deployment rollout', 'A', '2024-02-01T00:00:00Z'), 'episodic');
  index.addEntry(unit('s2a', 'cooking pasta recipes', 'B', '2024-03-01T00:00:00Z'), 'episodic');
  return index;
}

describe('recallNeighbors (R6 presentation)', () => {
  test('maps each anchor to its chronological neighbours', () => {
    const index = build();
    const memories = [{ id: 'hit', primary_abstraction: '', memory_value: '', energy: 0.8, score: 1 }];
    const map = recallNeighbors(index, memories as any);
    const ids = (map.get('hit') ?? []).map(n => n.id).sort();
    expect(ids).toEqual(['s1a', 's2a']);
  });

  test('neighbours are not ranked: the anchor is excluded from its own list', () => {
    const index = build();
    const map = recallNeighbors(index, [{ id: 'hit', primary_abstraction: '', memory_value: '', energy: 0.8, score: 1 }] as any);
    expect((map.get('hit') ?? []).map(n => n.id)).not.toContain('hit');
  });

  test('fail-open: bad index → empty map', () => {
    expect(recallNeighbors({}, [{ id: 'x', primary_abstraction: '', memory_value: '', energy: 0, score: 1 }] as any).size).toBe(0);
    expect(recallNeighbors(build(), []).size).toBe(0);
  });

  test('carries the source date/type so the block can render a verifiable pointer', () => {
    const index = build();
    const map = recallNeighbors(index, [{ id: 'hit', primary_abstraction: '', memory_value: '', energy: 0.8, score: 1 }] as any);
    const nb = (map.get('hit') ?? []).find(n => n.id === 's2a');
    expect(nb?.created_at).toBe('2024-03-01T00:00:00Z');
    expect(nb?.type).toBe('episodic');
  });
});
