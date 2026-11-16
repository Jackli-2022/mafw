import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../../src/core/memory/harmonic-types';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';

function unit(id: string): HarmonicUnit {
  const now = new Date().toISOString();
  return {
    id,
    type: 'semantic',
    primary_abstraction: id,
    cue_anchors: [id],
    memory_value: id,
    energy: 0.8,
    created_at: now,
    updated_at: now,
  } as HarmonicUnit;
}

describe('batched index writes', () => {
  test('addEntry save:false defers the index write until save()', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harmonic-batch-'));
    try {
      const index = new HarmonicIndexManager(dir);
      const save = jest.spyOn(index, 'save').mockImplementation(() => {});
      index.addEntry(unit('a'), 'semantic', { save: false });
      index.addEntry(unit('b'), 'semantic', { save: false });
      expect(save).not.toHaveBeenCalled();
      index.save();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('store.write forwards the save flag', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harmonic-batch-'));
    try {
      const store = new HarmonicUnitFileStore(dir);
      const index = store.indexManager_();
      const save = jest.spyOn(index, 'save').mockImplementation(() => {});
      await store.write(unit('a'), undefined, { save: false });
      expect(save).not.toHaveBeenCalled();
      index.save();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
