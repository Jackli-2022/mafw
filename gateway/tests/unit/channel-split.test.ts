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

function build(): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chansplit-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  // episodic entries match the query more strongly than semantic ones
  index.addEntry(unit('e1', 'kubernetes deployment rollout kubernetes deployment', 'episodic'), 'episodic');
  index.addEntry(unit('e2', 'kubernetes deployment notes', 'episodic'), 'episodic');
  index.addEntry(unit('s1', 'kubernetes rollout', 'semantic'), 'semantic');
  index.addEntry(unit('s2', 'deployment notes', 'semantic'), 'semantic');
  return index;
}

describe('channelSplit', () => {
  afterEach(() => { config.search.channelSplit.enabled = false; });

  test('关闭时按 BM25（episodic 可居首）', () => {
    config.search.channelSplit.enabled = false;
    const index = build();
    const res = index.searchScored('kubernetes deployment', 4, { retriever: 'bm25' });
    expect(res[0].entry.id).toBe('e1');
  });

  test('开启时 semantic 优先于 episodic', () => {
    config.search.channelSplit.enabled = true;
    const index = build();
    const res = index.searchScored('kubernetes deployment', 4, { retriever: 'bm25' });
    const ids = res.map(r => r.entry.id);
    expect(['s1', 's2']).toContain(ids[0]);
    expect(ids.indexOf('s1')).toBeLessThan(ids.indexOf('e1'));
  });
});
