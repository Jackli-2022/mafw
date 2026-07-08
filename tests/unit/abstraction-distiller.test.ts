import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { HarmonicUnit } from '../../src/memory/harmonic-types';
import { runDistillation, DistillationResult } from '../../src/memory/abstraction-distiller';

function makeT2Unit(
  id: string,
  abstraction: string,
  overrides: Partial<HarmonicUnit> = {}
): HarmonicUnit {
  return {
    id,
    memory_type: 'episodic',
    primary_abstraction: abstraction,
    cue_anchors: ['anchor1', 'anchor2'],
    memory_value: `value for ${id}`,
    energy: 0.7,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides
  };
}

function writeT2Units(baseDir: string, units: HarmonicUnit[]): void {
  const memoryDir = path.join(baseDir, 'memory');
  if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
  const filePath = path.join(memoryDir, 'tier2.json');
  const existing = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : [];
  fs.writeFileSync(filePath, JSON.stringify([...existing, ...units], null, 2), 'utf-8');
}

describe('AbstractionDistiller', () => {
  let tmpDir: string;
  let manager: HarmonicIndexManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'distill-test-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    manager = new HarmonicIndexManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Rule 1: T2 Episodic �?T3 Semantic', () => {
    it('distills 3+ similar T2 entries into one T3 unit', async () => {
      const similar = [
        makeT2Unit('t2_a', 'alpha beta gamma one'),
        makeT2Unit('t2_b', 'alpha beta gamma two'),
        makeT2Unit('t2_c', 'alpha beta gamma three'),
      ];
      writeT2Units(tmpDir, similar);
      for (const u of similar) {
        manager.addEntry(u, 'tier2');
      }

      const dissim = makeT2Unit('t2_d', 'delta epsilon zeta');
      writeT2Units(tmpDir, [dissim]);
      manager.addEntry(dissim, 'tier2');

      const result = await runDistillation(manager, tmpDir);

      expect(result.created).toBe(1);
      expect(result.locked).toBe(3);
      expect(result.errors).toEqual([]);

      const idx = manager.getIndex();
      const t3Entries = idx.entries.filter(e => e.tier === 'tier3');
      expect(t3Entries).toHaveLength(1);

      const t3 = t3Entries[0];
      expect(t3.memory_type).toBe('semantic');

      const tier3File = path.join(tmpDir, 'memory', 'tier3.json');
      expect(fs.existsSync(tier3File)).toBe(true);
      const fileContents = JSON.parse(fs.readFileSync(tier3File, 'utf-8'));
      expect(fileContents).toHaveLength(1);
      expect(fileContents[0].id).toBe(t3.id);
      expect(fileContents[0].memory_type).toBe('semantic');
      expect(fileContents[0].merged_from).toEqual(['t2_a', 't2_b', 't2_c']);

      const lockedEntries = similar.map(u => idx.entries.find(e => e.id === u.id));
      for (const entry of lockedEntries) {
        expect(entry!.energy).toBeCloseTo(0.2, 5);
      }
    });

    it('does not distill fewer than 3 similar entries', async () => {
      const units = [
        makeT2Unit('t2_a', 'alpha beta gamma one'),
        makeT2Unit('t2_b', 'alpha beta gamma two'),
        makeT2Unit('t2_c', 'delta epsilon zeta'),
      ];
      writeT2Units(tmpDir, units);
      for (const u of units) {
        manager.addEntry(u, 'tier2');
      }

      const result = await runDistillation(manager, tmpDir);

      expect(result.created).toBe(0);
      expect(result.locked).toBe(0);
      expect(result.errors).toEqual([]);

      const idx = manager.getIndex();
      const t3Entries = idx.entries.filter(e => e.tier === 'tier3');
      expect(t3Entries).toHaveLength(0);
    });

    it('creates T3 with merged abstractions, deduped anchors, and combined memory_value', async () => {
      const units = [
        makeT2Unit('t2_a', 'alpha beta gamma one', { cue_anchors: ['login', 'auth'], memory_value: 'handle login' }),
        makeT2Unit('t2_b', 'alpha beta gamma two', { cue_anchors: ['auth', 'token'], memory_value: 'validate token' }),
        makeT2Unit('t2_c', 'alpha beta gamma three', { cue_anchors: ['login', 'session'], memory_value: 'manage session' }),
      ];
      writeT2Units(tmpDir, units);
      for (const u of units) {
        manager.addEntry(u, 'tier2');
      }

      const result = await runDistillation(manager, tmpDir);

      expect(result.created).toBe(1);

      const idx = manager.getIndex();
      const t3 = idx.entries.find(e => e.tier === 'tier3')!;
      expect(t3.cue_anchors).toEqual(expect.arrayContaining(['login', 'auth', 'token', 'session']));
      expect(t3.cue_anchors).toHaveLength(4);

      const tier3File = path.join(tmpDir, 'memory', 'tier3.json');
      const fileContents = JSON.parse(fs.readFileSync(tier3File, 'utf-8'));
      expect(fileContents[0].memory_value).toContain('handle login');
      expect(fileContents[0].memory_value).toContain('validate token');
      expect(fileContents[0].memory_value).toContain('manage session');
    });
  });

  describe('Rule 2: T4 Procedural counting', () => {
    it('counts but does not create L5 when 5+ T4 entries exist for same goal', async () => {
      for (let i = 0; i < 5; i++) {
        const unit: HarmonicUnit = {
          id: `t4_${i}`, memory_type: 'procedural',
          primary_abstraction: 't4 abstraction', cue_anchors: ['proc'],
          memory_value: `value ${i}`, energy: 0.6,
          created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z'
        };
        manager.addEntry(unit, 'tier4');
      }

      const result = await runDistillation(manager, tmpDir);

      const idx = manager.getIndex();
      const t5Entries = idx.entries.filter(e => e.tier === 'tier5');
      expect(t5Entries).toHaveLength(0);
    });
  });
});
