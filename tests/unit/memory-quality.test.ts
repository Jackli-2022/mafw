import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../gateway/src/core/memory/harmonic-types';
import { MinHashMerger } from '../../gateway/src/core/memory/minhash-merger';
import { HarmonicUnitFileStore } from '../../gateway/src/memory/harmonic-file-store';

describe('Harmonic memory quality improvements (A1/A2/B4/B5/C)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-q-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function unit(id: string, abs: string, anchors: string[], energy = 0.8, salience = 1, mergedFrom?: string[]): HarmonicUnit {
    return {
      id,
      type: 'semantic',
      primary_abstraction: abs,
      cue_anchors: anchors,
      memory_value: 'value for ' + id,
      energy,
      salience,
      merged_from: mergedFrom,
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-01T00:00:00.000Z',
    } as any;
  }

  // ── A1: 超长 primary_abstraction 截断参与检索 ──
  describe('A1: long abstraction truncated for retrieval', () => {
    it('a 1500-char mega entry does not outrank a short precise hit even when it contains the query words', () => {
      const manager = new HarmonicIndexManager(tmpDir);
      // 巨型合并条目：包含查询词 FlutterSecureStorage/mobile/tests 但堆了大量无关主题
      const mega =
        'FlutterSecureStorage API change breaks mobile tests | ' +
        Array.from({ length: 15 }, (_, i) => `topic${i} keyword${i} alpha${i} beta${i} gamma${i} delta${i} epsilon${i}`).join(' | ');
      manager.addEntry(unit('mem_mega', mega, [], 0.95, 1), 'tier3');
      // 精确命中的短条目
      manager.addEntry(unit('mem_precise', 'FlutterSecureStorage API change breaks mobile tests', ['flutter'], 0.8, 1), 'tier3');

      const results = manager.search('FlutterSecureStorage API change breaks mobile tests', 5, { retriever: 'bm25' });
      expect(results[0].id).toBe('mem_precise');
    });
  });

  // ── A2: 合并产物降权 ──
  describe('A2: merged entries penalized in retrieval', () => {
    it('merged entry (merged_from) ranks below same-keyword unmerged entry', () => {
      const manager = new HarmonicIndexManager(tmpDir);
      manager.addEntry(unit('mem_merged', 'JWT auth token config setup', ['jwt'], 0.95, 1, ['mem_x']), 'tier3');
      manager.addEntry(unit('mem_fresh', 'JWT auth token config setup', ['jwt'], 0.8, 1), 'tier3');

      const results = manager.search('JWT auth token config', 5, { retriever: 'bm25' });
      expect(results[0].id).toBe('mem_fresh');
    });
  });

  // ── B4: dedupMerge 长度上限 ──
  describe('B4: merge output length cap', () => {
    it('does not merge when combined abstraction would exceed 500 chars', async () => {
      const merger = new MinHashMerger();
      const store = new HarmonicUnitFileStore(tmpDir);
      const manager = store.indexManager_();

      const longAbs = 'A'.repeat(480);
      const existing: HarmonicUnit = {
        id: 'mem_long', type: 'semantic', primary_abstraction: longAbs,
        cue_anchors: ['x'], memory_value: 'v1', energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
      };
      await store.write(existing);

      const incoming: HarmonicUnit = {
        id: 'mem_new', type: 'semantic',
        primary_abstraction: longAbs + 'B', // 与 existing 高度相似
        cue_anchors: ['x'], memory_value: 'v2', energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z', updated_at: '2025-02-01T00:00:00.000Z',
      };

      const result = await merger.merge(incoming, manager, store);
      // 组合超过上限 → 不合并，不产生 merged_from
      expect(result.merged_from).toBeUndefined();
      expect(result.id).toBe('mem_new');
    });
  });

  // ── B5: 合并阈值调高 ──
  describe('B5: higher merge threshold (0.75)', () => {
    it('loosely-similar entries no longer merge (below threshold)', async () => {
      const merger = new MinHashMerger();
      const store = new HarmonicUnitFileStore(tmpDir);
      const manager = store.indexManager_();

      const existing: HarmonicUnit = {
        id: 'mem_e', type: 'semantic', primary_abstraction: 'JWT token auth configuration setup',
        cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
      };
      await store.write(existing);

      // 部分重叠但不同主题
      const incoming: HarmonicUnit = {
        id: 'mem_i', type: 'semantic', primary_abstraction: 'JWT token refresh flow for mobile app login',
        cue_anchors: ['jwt'], memory_value: 'v2', energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z', updated_at: '2025-02-01T00:00:00.000Z',
      };

      const result = await merger.merge(incoming, manager, store);
      expect(result.merged_from).toBeUndefined();
    });
  });

  // ── C: cue_anchors 自动提取 ──
  describe('C: cue_anchors auto-fill', () => {
    it('write with empty anchors extracts keywords from abstraction', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const incoming: HarmonicUnit = {
        id: 'mem_c', type: 'procedural',
        primary_abstraction: 'Gateway mobile route regex must anchor query string for token auth',
        cue_anchors: [], memory_value: 'v', energy: 0.8,
        created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
      };
      await store.write(incoming);

      const idx = store.indexManager_().getIndex();
      const entry = idx.entries.find(e => e.id === 'mem_c');
      expect(entry!.cue_anchors.length).toBeGreaterThan(0);
      expect(entry!.cue_anchors).toContain('gateway');
      expect(entry!.cue_anchors).toContain('mobile');
    });

    it('preserves provided anchors when non-empty', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const incoming: HarmonicUnit = {
        id: 'mem_c2', type: 'procedural',
        primary_abstraction: 'Gateway mobile route regex must anchor query string',
        cue_anchors: ['route', 'regex'], memory_value: 'v', energy: 0.8,
        created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
      };
      await store.write(incoming);

      const idx = store.indexManager_().getIndex();
      const entry = idx.entries.find(e => e.id === 'mem_c2');
      expect(entry!.cue_anchors).toEqual(['route', 'regex']);
    });
  });
});
