import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';

function mkUnit(id: string, abs: string) {
  const now = new Date().toISOString();
  return {
    id, type: 'semantic' as const, primary_abstraction: abs, cue_anchors: ['t'],
    memory_value: abs, energy: 0.8, created_at: now, updated_at: now,
  };
}

describe('V2 MinHash retirement (write path)', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwh-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('near-verbatim second write is NOT merged: both entries persist', async () => {
    const idx = new HarmonicIndexManager(dir);
    const store = new HarmonicUnitFileStore(dir, idx);
    await store.write(mkUnit('u1', 'BM25 token cache memoize harmonic index speed') as any);
    await store.write(mkUnit('u2', 'BM25 token cache memoize harmonic index speed') as any);
    const entries = idx.getIndex().entries;
    expect(entries.map(e => e.id).sort()).toEqual(['u1', 'u2']);
    expect((entries.find(e => e.id === 'u1') as any).superseded_by).toBeUndefined();
  });
});
