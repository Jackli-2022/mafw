import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicUnitFileStore } from '../../../src/memory/harmonic-file-store';
import { HarmonicIndexManager } from '../../../src/core/memory/harmonic-index';

describe('novelty persistence (V2 ①c)', () => {
  it('round-trips through index entry and OKF frontmatter', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafwn-'));
    try {
      const idx = new HarmonicIndexManager(dir);
      const store = new HarmonicUnitFileStore(dir, idx);
      const now = new Date().toISOString();
      await store.write({ id: 'nv1', type: 'semantic', primary_abstraction: 'abs',
        cue_anchors: ['k'], memory_value: 'v', energy: 0.8, novelty: 0.42,
        created_at: now, updated_at: now } as any);
      expect((idx.getIndex().entries[0] as any).novelty).toBe(0.42);
      const semDir = path.join(dir, 'memory', 'concepts', 'semantic');
      const okfFile = fs.readdirSync(semDir).find(f => f.includes('nv1'));
      expect(okfFile).toBeDefined();
      const okf = fs.readFileSync(path.join(semDir, okfFile!), 'utf-8');
      expect(okf).toContain('novelty: 0.42');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
