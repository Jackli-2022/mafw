import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { HarmonicUnit } from '../../src/memory/harmonic-types';
import { MinHashMerger } from '../../src/memory/minhash-merger';

describe('MinHashMerger', () => {
  let merger: MinHashMerger;
  let tmpDir: string;

  beforeEach(() => {
    merger = new MinHashMerger();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhm-test-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('generateSignature', () => {
    it('returns vector of length signatureSize', () => {
      const sig = merger.generateSignature('hello world');
      expect(sig).toHaveLength(4);
    });

    it('is deterministic for identical input', () => {
      const sig1 = merger.generateSignature('query routing algorithm');
      const sig2 = merger.generateSignature('query routing algorithm');
      expect(sig1).toEqual(sig2);
    });

    it('differs for different inputs', () => {
      const sig1 = merger.generateSignature('apple banana cherry');
      const sig2 = merger.generateSignature('dog elephant frog');
      expect(sig1).not.toEqual(sig2);
    });

    it('handles empty string gracefully', () => {
      const sig = merger.generateSignature('');
      expect(sig).toHaveLength(4);
      expect(sig.every(v => typeof v === 'number')).toBe(true);
    });

    it('handles short text (less than 3 chars)', () => {
      const sig = merger.generateSignature('ab');
      expect(sig).toHaveLength(4);
      expect(sig.every(v => typeof v === 'number')).toBe(true);
    });

    it('is case-insensitive', () => {
      const sig1 = merger.generateSignature('JWT Auth');
      const sig2 = merger.generateSignature('jwt auth');
      expect(sig1).toEqual(sig2);
    });
  });

  describe('similarity', () => {
    it('returns 1.0 for identical signatures', () => {
      const sig = merger.generateSignature('identical text');
      expect(merger.similarity(sig, sig)).toBe(1.0);
    });

    it('returns 0.0 when no positions match', () => {
      const sigA = [100, 200, 300, 400];
      const sigB = [999, 888, 777, 666];
      expect(merger.similarity(sigA, sigB)).toBe(0.0);
    });

    it('returns correct fraction for partial match', () => {
      const sigA = [100, 200, 300, 400];
      const sigB = [100, 200, 777, 666];
      expect(merger.similarity(sigA, sigB)).toBe(0.5);
    });

    it('returns correct fraction for 1/4 match', () => {
      const sigA = [100, 200, 300, 400];
      const sigB = [999, 200, 777, 666];
      expect(merger.similarity(sigA, sigB)).toBe(0.25);
    });
  });

  describe('merge', () => {
    it('returns same unit when no similar entries exist in index', async () => {
      const manager = new HarmonicIndexManager(tmpDir);
      const unit: HarmonicUnit = {
        id: 'mem_new',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'unique abstraction about something',
        cue_anchors: ['unique'],
        memory_value: 'some value',
        energy: 0.5,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z'
      };

      const result = await merger.merge(unit, 'tier3', manager, tmpDir);
      expect(result.id).toBe('mem_new');
      expect(result.energy).toBe(0.5);
      expect(result.merged_from).toBeUndefined();
    });

    it('merges with similar existing entry from index', async () => {
      const manager = new HarmonicIndexManager(tmpDir);

      const existing: HarmonicUnit = {
        id: 'mem_existing',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token auth configuration setup',
        cue_anchors: ['jwt', 'auth', 'token'],
        memory_value: 'JWT should expire in 30 minutes',
        energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z'
      };

      const tierDir = path.join(tmpDir, 'memory', 'tier3');
      fs.mkdirSync(tierDir, { recursive: true });
      fs.writeFileSync(path.join(tierDir, 'mem_existing.json'), JSON.stringify(existing), 'utf-8');

      manager.addEntry(existing, 'tier3');

      const incoming: HarmonicUnit = {
        id: 'mem_new',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token authentication configuration setup for users',
        cue_anchors: ['jwt', 'user-auth'],
        memory_value: 'tokens should be short-lived',
        energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z',
        updated_at: '2025-02-01T00:00:00.000Z'
      };

      const result = await merger.merge(incoming, 'tier3', manager, tmpDir);

      expect(result.id).toBe('mem_new');
      expect(result.merged_from).toEqual(['mem_existing']);
      expect(result.energy).toBe(0.65);
      expect(result.primary_abstraction).toContain('JWT token auth configuration setup');
      expect(result.primary_abstraction).toContain('JWT token authentication configuration setup for users');
      expect(result.cue_anchors).toContain('jwt');
      expect(result.cue_anchors).toContain('auth');
      expect(result.cue_anchors).toContain('token');
      expect(result.cue_anchors).toContain('user-auth');
      expect(result.memory_value).toContain('JWT should expire in 30 minutes');
      expect(result.memory_value).toContain('tokens should be short-lived');
    });

    it('caps energy at 1.0 after merge', async () => {
      const manager = new HarmonicIndexManager(tmpDir);

      const existing: HarmonicUnit = {
        id: 'mem_high',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token auth configuration setup',
        cue_anchors: ['jwt'],
        memory_value: 'value1',
        energy: 0.9,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z'
      };

      const tierDir = path.join(tmpDir, 'memory', 'tier3');
      fs.mkdirSync(tierDir, { recursive: true });
      fs.writeFileSync(path.join(tierDir, 'mem_high.json'), JSON.stringify(existing), 'utf-8');
      manager.addEntry(existing, 'tier3');

      const incoming: HarmonicUnit = {
        id: 'mem_new',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token authentication configuration',
        cue_anchors: ['token'],
        memory_value: 'value2',
        energy: 0.9,
        created_at: '2025-02-01T00:00:00.000Z',
        updated_at: '2025-02-01T00:00:00.000Z'
      };

      const result = await merger.merge(incoming, 'tier3', manager, tmpDir);
      expect(result.energy).toBe(1.0);
    });

    it('removes old entry from index after merge', async () => {
      const manager = new HarmonicIndexManager(tmpDir);

      const existing: HarmonicUnit = {
        id: 'mem_removed',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token auth configuration setup',
        cue_anchors: ['jwt'],
        memory_value: 'value1',
        energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z'
      };

      const tierDir = path.join(tmpDir, 'memory', 'tier3');
      fs.mkdirSync(tierDir, { recursive: true });
      fs.writeFileSync(path.join(tierDir, 'mem_removed.json'), JSON.stringify(existing), 'utf-8');
      manager.addEntry(existing, 'tier3');

      const incoming: HarmonicUnit = {
        id: 'mem_new',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'JWT token authentication configuration',
        cue_anchors: ['token'],
        memory_value: 'value2',
        energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z',
        updated_at: '2025-02-01T00:00:00.000Z'
      };

      await merger.merge(incoming, 'tier3', manager, tmpDir);
      const idx = manager.getIndex();
      const stillThere = idx.entries.find(e => e.id === 'mem_removed');
      expect(stillThere).toBeUndefined();
    });

    it('does not merge when similarity is below threshold', async () => {
      const manager = new HarmonicIndexManager(tmpDir);

      const existing: HarmonicUnit = {
        id: 'mem_diff',
        goal_id: 'g1',
        memory_type: 'semantic',
        primary_abstraction: 'python async web framework django flask',
        cue_anchors: ['python'],
        memory_value: 'use async views',
        energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z'
      };

      const tierDir = path.join(tmpDir, 'memory', 'tier3');
      fs.mkdirSync(tierDir, { recursive: true });
      fs.writeFileSync(path.join(tierDir, 'mem_diff.json'), JSON.stringify(existing), 'utf-8');
      manager.addEntry(existing, 'tier3');

      const incoming: HarmonicUnit = {
        id: 'mem_new',
        goal_id: 'g2',
        memory_type: 'procedural',
        primary_abstraction: 'database indexing postgresql query optimization',
        cue_anchors: ['database'],
        memory_value: 'index columns',
        energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z',
        updated_at: '2025-02-01T00:00:00.000Z'
      };

      const result = await merger.merge(incoming, 'tier3', manager, tmpDir);
      expect(result.id).toBe('mem_new');
      expect(result.merged_from).toBeUndefined();
      expect(result.energy).toBe(0.5);
    });
  });
});
