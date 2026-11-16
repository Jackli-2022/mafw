import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import type { HarmonicUnit } from '../../src/core/memory/harmonic-types';
import { config } from '../../src/config';

function unit(id: string, type: string, over: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  const text = `kubernetes deployment notes ${id}`;
  return {
    id,
    type,
    primary_abstraction: text,
    cue_anchors: [],
    memory_value: text,
    energy: 0.8,
    created_at: now,
    updated_at: now,
    ...over,
  } as HarmonicUnit;
}

describe('legacy episodic cortex filter', () => {
  let dir: string;
  let index: HarmonicIndexManager;

  beforeEach(() => {
    config.search.channelSplit.enabled = false;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-episodic-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    index = new HarmonicIndexManager(dir);
    index.addEntry(unit('e_unpinned', 'episodic'), 'episodic');
    index.addEntry(unit('e_pinned', 'episodic', { pinned: true }), 'episodic');
    index.addEntry(unit('e_sticky', 'episodic', { sticky_until: '2999-01-01T00:00:00.000Z' }), 'episodic');
    index.addEntry(unit('s1', 'semantic'), 'semantic');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('default search hides unpinned legacy episodic, keeps pinned/sticky', () => {
    const ids = index.searchScored('kubernetes deployment', 10, { retriever: 'bm25' }).map((r) => r.entry.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('e_pinned');
    expect(ids).toContain('e_sticky');
    expect(ids).not.toContain('e_unpinned');
  });

  test('explicit flag includes all legacy episodic rows', () => {
    const ids = index.searchScored('kubernetes deployment', 10, {
      retriever: 'bm25',
      includeLegacyEpisodic: true,
    }).map((r) => r.entry.id);
    expect(ids).toContain('e_unpinned');
    expect(ids).toContain('e_pinned');
  });
});
