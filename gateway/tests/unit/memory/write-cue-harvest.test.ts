/**
 * Write-side fidelity: identifier cues living only in the memory body are
 * harvested into cue_anchors so queries can actually reach them.
 */
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { config } from '../../../src/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

function build(): { store: HarmonicUnitFileStore; index: HarmonicIndexManager } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cue-harvest-write-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  const index = new HarmonicIndexManager(dir);
  const store = new HarmonicUnitFileStore(dir, index);
  return { store, index };
}

function unit(id: string, abstraction: string, body: string): HarmonicUnit {
  return {
    id, type: 'procedural', primary_abstraction: abstraction, cue_anchors: ['existing cue'],
    memory_value: body, energy: 0.8, created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
  } as HarmonicUnit;
}

describe('write() identifier harvest', () => {
  test('body-only identifiers become searchable cues', async () => {
    const { store, index } = build();
    await store.write(unit('a', 'deployment notes', 'Root cause was in harmonic-index.ts: fetchScored must pass retriever.'), undefined, { skipMerge: true });
    const entry = index.getIndex().entries.find(e => e.id === 'a')!;
    expect(entry.cue_anchors.join(' ')).toContain('harmonic-index.ts');
  });

  test('harvested cue makes the memory retrievable by that identifier', async () => {
    const { store, index } = build();
    await store.write(unit('a', 'deployment notes', 'Root cause was in harmonic-index.ts during rollout'), undefined, { skipMerge: true });
    const hits = index.searchScored('harmonic-index.ts', 5, { retriever: 'bm25' }).map(s => s.entry.id);
    expect(hits).toContain('a');
  });

  test('respects maxCueAnchors and does not duplicate existing cues', async () => {
    const { store, index } = build();
    await store.write(unit('a', 'notes', 'see alphaBeta gammaDelta and existing cue'), undefined, { skipMerge: true });
    const entry = index.getIndex().entries.find(e => e.id === 'a')!;
    expect(entry.cue_anchors.filter((c: string) => c === 'existing cue')).toHaveLength(1);
    expect(entry.cue_anchors.length).toBeLessThanOrEqual(8 + (config.memory.harvestMaxCues ?? 8));
  });
});
