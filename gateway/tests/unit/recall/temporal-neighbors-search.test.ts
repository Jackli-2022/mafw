/**
 * R6 wiring: searchScored pulls in chronological neighbors of top hits
 * (context reinstatement). Off by default; enabled via options/config.
 */
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { config } from '../../../src/config';
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'temporal-nb-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  // Only 'h' matches the query; n1 is the same-session predecessor, c is the
  // first entry of the next session (the cross-session bridge, h being last of A).
  index.addEntry(unit('n1', 'gardening tips', 'A', '2024-01-01T00:00:00Z'), 'episodic');
  index.addEntry(unit('h', 'kubernetes deployment rollout', 'A', '2024-02-01T00:00:00Z'), 'episodic');
  index.addEntry(unit('c', 'cooking pasta recipes', 'B', '2024-03-01T00:00:00Z'), 'episodic');
  return index;
}

describe('R6 temporal-neighbor wiring', () => {
  afterEach(() => { (config.search as any).temporalNeighbors = { enabled: false }; });

  test('off by default: only the direct BM25 hit is returned', () => {
    const index = build();
    const res = index.searchScored('kubernetes deployment', 10, { retriever: 'bm25' });
    expect(res.map(r => r.entry.id)).toEqual(['h']);
  });

  test('enabled: pulls the same-session predecessor and the cross-session bridge', () => {
    const index = build();
    const res = index.searchScored('kubernetes deployment', 10, { retriever: 'bm25', temporalNeighbors: true });
    const ids = res.map(r => r.entry.id);
    expect(ids).toContain('h');
    expect(ids).toContain('n1');
    expect(ids).toContain('c');
    // the genuine hit still outranks every neighbor
    expect(ids[0]).toBe('h');
  });

  test('same-session neighbors outrank the cross-session bridge', () => {
    const index = build();
    const res = index.searchScored('kubernetes deployment', 10, { retriever: 'bm25', temporalNeighbors: true });
    const ids = res.map(r => r.entry.id);
    expect(ids.indexOf('n1')).toBeLessThan(ids.indexOf('c'));
  });
});
