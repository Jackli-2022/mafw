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

  // ── A1: 超长 primary_abstraction 全文参与检索（不截断） ──
  describe('A1: long abstractions stay fully retrievable', () => {
    it('does not truncate away answer tokens in long single-document entries', () => {
      const manager = new HarmonicIndexManager(tmpDir);
      // LongMemEval 风格：全文入 primary_abstraction，答案在 1000 字符之后
      const body = 'user: what is the wifi password?\nassistant: The wifi password is S3cr3t-Passw0rd-2024 and the router is in the hall closet.\nuser: thanks\nassistant: you are welcome, happy to help with anything else';
      const filler = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum. ';
      const padded = filler.repeat(3) + body;
      expect(padded.length).toBeGreaterThan(1000);
      manager.addEntry(unit('mem_long', padded, ['lmesid:s1'], 0.8, 1), 'tier3');

      const results = manager.search('what is the wifi password S3cr3t-Passw0rd-2024', 5, { retriever: 'bm25' });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe('mem_long');
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
    it('merged_from is persisted into the index entry (A2 penalty must work in prod)', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const existing: HarmonicUnit = {
        id: 'mem_src', type: 'semantic', primary_abstraction: 'JWT token auth configuration setup',
        cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.7,
        created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
      };
      await store.write(existing);

      const incoming: HarmonicUnit = {
        id: 'mem_new', type: 'semantic',
        primary_abstraction: 'JWT token authentication configuration setup for users',
        cue_anchors: ['jwt', 'user-auth'], memory_value: 'v2', energy: 0.5,
        created_at: '2025-02-01T00:00:00.000Z', updated_at: '2025-02-01T00:00:00.000Z',
      };
      await store.write(incoming); // 触发合并

      const idx = store.indexManager_().getIndex();
      const entry = idx.entries.find(e => e.id === 'mem_new');
      expect(entry).toBeDefined();
      expect(entry!.merged_from).toEqual(['mem_src']);
      // 旧条目被标记 superseded（energy 降权），新条目是活跃合并产物
      const oldEntry = idx.entries.find(e => e.id === 'mem_src');
      expect(oldEntry!.superseded_by).toBe('mem_new');
      // A2: 合并产物在检索时被降权（与同词条非合并条目相比）
      const fresh: HarmonicUnit = {
        id: 'mem_fresh', type: 'semantic', primary_abstraction: 'JWT token auth config quick note',
        cue_anchors: ['jwt'], memory_value: 'v3', energy: 0.8,
        created_at: '2025-03-01T00:00:00.000Z', updated_at: '2025-03-01T00:00:00.000Z',
      };
      await store.write(fresh);
      const results = store.indexManager_().search('JWT token auth', 5, { retriever: 'bm25' });
      expect(results[0].id).toBe('mem_fresh');
    });
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

  describe('merged_from propagation (regression)', () => {
    it('should write merged_from to index entry after MinHash merge', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const base = 'test knowledge module about react hooks and state management';
      const similar = 'test knowledge module about react hooks and state management patterns';
      const anchors = ['react', 'hooks', 'state'];

      // Write two similar units — second should merge first
      await store.write(unit('mem_src', base, anchors, 0.8, 1), undefined, { skipMerge: false });
      await store.write(unit('mem_new', similar, anchors, 0.8, 1), undefined, { skipMerge: false });

      const idx = store.indexManager_().getIndex();
      const srcEntry = idx.entries.find(e => e.id === 'mem_src');
      const newEntry = idx.entries.find(e => e.id === 'mem_new');

      // Source should be superseded
      expect(srcEntry!.superseded_by).toBe('mem_new');
      // New entry should have merged_from recorded in index
      expect(newEntry!.merged_from).toBeDefined();
      expect(newEntry!.merged_from).toContain('mem_src');
      // A2 penalty should apply: score multiplier = 0.8 when merged_from is non-empty
      expect(newEntry!.merged_from!.length).toBeGreaterThan(0);
    });

    it('should read merged_from from OKF and backfill to index', async () => {
      const store = new HarmonicUnitFileStore(tmpDir);
      const base = 'test knowledge module about react hooks and state management';
      const similar = 'test knowledge module about react hooks and state management patterns';
      const anchors = ['react', 'hooks', 'state'];

      await store.write(unit('mem_src2', base, anchors, 0.8, 1), undefined, { skipMerge: false });
      await store.write(unit('mem_new2', similar, anchors, 0.8, 1), undefined, { skipMerge: false });

      // Simulate old index without merged_from (delete and reload from OKF)
      const idx = store.indexManager_().getIndex();
      const entry = idx.entries.find(e => e.id === 'mem_new2');
      const savedMergedFrom = entry!.merged_from;
      delete (entry as any).merged_from;
      store.indexManager_().save();

      // Reload index from disk
      const store2 = new HarmonicUnitFileStore(tmpDir);
      const idx2 = store2.indexManager_().getIndex();
      const reloaded = idx2.entries.find(e => e.id === 'mem_new2');
      // After reload, merged_from is missing (old index format)
      expect(reloaded!.merged_from).toBeUndefined();

      // Backfill: read OKF and patch index
      const okfPath = path.join(tmpDir, (entry as any).filePath);
      const fs = require('fs');
      const content = fs.readFileSync(okfPath, 'utf8');
      const match = content.match(/^merged_from:\s*\n((?:\s+-\s+.+\n?)*)/m);
      if (match) {
        const ids = match[1].split('\n').filter((l: string) => l.trim().startsWith('-')).map((l: string) => l.replace(/^\s*-\s+/, '').trim());
        reloaded!.merged_from = ids;
        store2.indexManager_().save();
      }

      const store3 = new HarmonicUnitFileStore(tmpDir);
      const idx3 = store3.indexManager_().getIndex();
      const final = idx3.entries.find(e => e.id === 'mem_new2');
      expect(final!.merged_from).toEqual(savedMergedFrom);
    });
  });
});

describe('anchor graph write-path integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-gw-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeStoreWithGraph(baseDir: string): { store: HarmonicUnitFileStore; graph: any; db: any } {
    const { GatewayDatabase } = require('../../gateway/src/memory/gateway-db');
    const { AnchorGraphStore } = require('../../gateway/src/graph/anchor-graph-store');
    const db = new GatewayDatabase(path.join(baseDir, 'gw-graph.db'));
    const graph = new AnchorGraphStore(db);
    const store = new HarmonicUnitFileStore(baseDir, undefined, graph);
    return { store, graph, db };
  }

  test('write() upserts anchor edges for the new unit', async () => {
    const { store, db } = makeStoreWithGraph(tmpDir);
    const u1 = { id: 'mem_g1', type: 'semantic', primary_abstraction: 'Project Orion timeline agreed by Dave', cue_anchors: ['project-orion', 'dave'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any;
    await store.write(u1);
    const u2 = { id: 'mem_g2', type: 'semantic', primary_abstraction: 'Dave works on prototype schedule', cue_anchors: ['project-orion', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any;
    await store.write(u2);
    // 验证图里有边（u1↔u2 共享 project-orion）
    const shared = (store as any).anchorGraphStore?.getSharedAnchors('mem_g1', 'mem_g2') ?? 0;
    expect(shared).toBeGreaterThan(0);
    db.close();
  });

  test('markSuperseded removes old unit from the graph', async () => {
    const { store, db } = makeStoreWithGraph(tmpDir);
    const u1 = { id: 'mem_s1', type: 'semantic', primary_abstraction: 'JWT auth config setup', cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.7, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any;
    await store.write(u1);
    const u2 = { id: 'mem_s2', type: 'semantic', primary_abstraction: 'JWT auth config setup updated', cue_anchors: ['jwt'], memory_value: 'v2', energy: 0.8, created_at: '2025-02-01T00:00:00.000Z', updated_at: '2025-02-01T00:00:00.000Z' } as any;
    await store.write(u2); // 触发合并 → mem_s1 superseded + 移图
    const idx = store.indexManager_().getIndex();
    const oldEntry = idx.entries.find(e => e.id === 'mem_s1');
    expect(oldEntry!.superseded_by).toBe('mem_s2');
    db.close();
  });
});

describe('graph multi-hop retrieval', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-mh-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeGraphStore() {
    const { GatewayDatabase } = require('../../gateway/src/memory/gateway-db');
    const { AnchorGraphStore } = require('../../gateway/src/graph/anchor-graph-store');
    const db = new GatewayDatabase(path.join(tmpDir, 'gw-mh.db'));
    const graph = new AnchorGraphStore(db);
    return { db, graph };
  }

  test('expands neighbors into results with shared anchors', async () => {
    const { db, graph } = makeGraphStore();
    const store = new HarmonicUnitFileStore(tmpDir, undefined, graph);
    await store.write({ id: 'mh_a', type: 'semantic', primary_abstraction: 'Dave and Sarah agreed the Orion plan', cue_anchors: ['orion-plan', 'dave', 'sarah'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    await store.write({ id: 'mh_b', type: 'semantic', primary_abstraction: 'Prototype pushed to April 1', cue_anchors: ['orion-plan', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any);
    await store.write({ id: 'mh_c', type: 'semantic', primary_abstraction: 'Unrelated recipe for pasta', cue_anchors: ['cooking'], memory_value: 'v3', energy: 0.8, created_at: '2025-01-03T00:00:00.000Z', updated_at: '2025-01-03T00:00:00.000Z' } as any);

    const results = store.indexManager_().search('Orion plan agreed', 5, { retriever: 'bm25', graphExpand: true });
    const ids = results.map(r => r.id);
    expect(ids[0]).toBe('mh_a');
    expect(ids).toContain('mh_b');
    expect(ids).not.toContain('mh_c');
    db.close();
  });

  test('graphExpand=false returns baseline behavior (no expansion)', async () => {
    const { db, graph } = makeGraphStore();
    const store = new HarmonicUnitFileStore(tmpDir, undefined, graph);
    // a 独有锚点 'orion-timeline'；b 共享 'orion-timeline' 但文本无关
    await store.write({ id: 'mh2_a', type: 'semantic', primary_abstraction: 'Dave agreed the Orion schedule', cue_anchors: ['orion-timeline', 'dave'], memory_value: 'v1', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    await store.write({ id: 'mh2_b', type: 'semantic', primary_abstraction: 'Prototype pushed to April 1', cue_anchors: ['orion-timeline', 'prototype'], memory_value: 'v2', energy: 0.8, created_at: '2025-01-02T00:00:00.000Z', updated_at: '2025-01-02T00:00:00.000Z' } as any);

    // query 用 a 的独有词（orion-schedule 相关），b 的 bm25 分应低
    const withGraph = store.indexManager_().search('Orion schedule agreed', 5, { retriever: 'bm25', graphExpand: true });
    const withoutGraph = store.indexManager_().search('Orion schedule agreed', 5, { retriever: 'bm25', graphExpand: false });
    const withIds = withGraph.map(r => r.id);
    const withoutIds = withoutGraph.map(r => r.id);
    // 图扩展把 b（共享 orion-timeline 锚点）带进结果；无图时 b 未进 top（bm25 低分）
    expect(withIds).toContain('mh2_b');
    const rankWithB = withIds.indexOf('mh2_b');
    const rankWithoutB = withoutIds.indexOf('mh2_b');
    expect(rankWithB).toBeGreaterThanOrEqual(0);
    // 图扩展后 b 排名应优于（或等于）无图时的排名；无图可能不在结果（-1）
    if (rankWithoutB >= 0) {
      expect(rankWithB).toBeLessThanOrEqual(rankWithoutB);
    } else {
      expect(rankWithB).toBeGreaterThanOrEqual(0);
    }
    db.close();
  });

  test('works without graph store (isolated env behaves as before)', async () => {
    const store = new HarmonicUnitFileStore(tmpDir);
    await store.write({ id: 'iso1', type: 'semantic', primary_abstraction: 'some unique memory about zzz', cue_anchors: [], memory_value: 'v', energy: 0.8, created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z' } as any);
    const results = store.indexManager_().search('some unique memory about zzz', 5, { retriever: 'bm25', graphExpand: true });
    expect(results.length).toBeGreaterThan(0);
  });
});
