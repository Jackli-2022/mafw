import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../gateway/src/core/memory/harmonic-index';
import { HarmonicUnit } from '../../gateway/src/core/memory/harmonic-types';

describe('HarmonicIndexManager', () => {
  let tmpDir: string;
  let manager: HarmonicIndexManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi-test-'));
    const memoryDir = path.join(tmpDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    manager = new HarmonicIndexManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates empty index when no file exists', () => {
    const idx = manager.getIndex();
    expect(idx.version).toBe(1);
    expect(idx.entries).toEqual([]);
  });

  it('adds and retrieves an entry', () => {
    const unit: HarmonicUnit = {
      id: 'mem_1', type: 'semantic',
      primary_abstraction: 'JWT token configuration',
      cue_anchors: ['jwt', 'auth', 'token'],
      memory_value: 'JWT should expire in 30 minutes',
      energy: 0.7, created_at: '', updated_at: ''
    };
    manager.addEntry(unit, 'tier3');
    const idx = manager.getIndex();
    expect(idx.entries).toHaveLength(1);
    expect(idx.entries[0].primary_abstraction).toBe('JWT token configuration');
  });

  it('search returns matching entries', () => {
    const u1: HarmonicUnit = { id: 'm1', type: 'semantic', primary_abstraction: 'JWT auth', cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.8, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', type: 'episodic', primary_abstraction: 'Error handling', cue_anchors: ['error'], memory_value: 'v2', energy: 0.5, created_at: '', updated_at: '' };
    manager.addEntry(u1, 'tier3');
    manager.addEntry(u2, 'tier2');
    const results = manager.search('JWT');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
  });

  it('search is tier-agnostic', () => {
    const u1: HarmonicUnit = { id: 'm1', type: 'semantic', primary_abstraction: 'API design', cue_anchors: ['api'], memory_value: 'v1', energy: 0.6, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', type: 'episodic', primary_abstraction: 'API bug fix', cue_anchors: ['api'], memory_value: 'v2', energy: 0.7, created_at: '', updated_at: '' };
    manager.addEntry(u1, 'tier3');
    manager.addEntry(u2, 'tier2');
    const results = manager.search('API');
    expect(results).toHaveLength(2);
  });

  it('emits memory.write on addEntry when hookManager is provided', () => {
    const calls: Array<{ event: string; ctx: any }> = [];
    const mockHookManager = {
      execute: async (event: string, ctx: any) => { calls.push({ event, ctx }); }
    };
    const hookedManager = new HarmonicIndexManager(tmpDir, mockHookManager);
    const unit: HarmonicUnit = {
      id: 'mem_hook_1', type: 'semantic',
      primary_abstraction: 'test', cue_anchors: ['t'],
      memory_value: 'val', energy: 0.5, created_at: '', updated_at: ''
    };
    hookedManager.addEntry(unit, 'tier3');
    expect(calls).toHaveLength(1);
    expect(calls[0].event).toBe('memory.write');
    expect(calls[0].ctx.unit.id).toBe('mem_hook_1');
    expect(calls[0].ctx.tier).toBe('tier3');
    expect(calls[0].ctx.source).toBe('HarmonicIndexManager.addEntry');
  });

  it('emits memory.recall on search when hookManager is provided', () => {
    const calls: Array<{ event: string; ctx: any }> = [];
    const mockHookManager = {
      execute: async (event: string, ctx: any) => { calls.push({ event, ctx }); }
    };
    const hookedManager = new HarmonicIndexManager(tmpDir, mockHookManager);
    const unit: HarmonicUnit = {
      id: 'mem_recall_1', type: 'semantic',
      primary_abstraction: 'JWT auth', cue_anchors: ['jwt'],
      memory_value: 'val', energy: 0.8, created_at: '', updated_at: ''
    };
    hookedManager.addEntry(unit, 'tier2');
    const results = hookedManager.search('JWT');
    expect(calls).toHaveLength(2);
    expect(calls[1].event).toBe('memory.recall');
    expect(calls[1].ctx.query).toBe('JWT');
    expect(calls[1].ctx.resultIds).toEqual(['mem_recall_1']);
    expect(calls[1].ctx.source).toBe('HarmonicIndexManager.search');
  });

  it('works silently without hookManager', () => {
    const manager_no_hook = new HarmonicIndexManager(tmpDir);
    const unit: HarmonicUnit = {
      id: 'no_hook', type: 'semantic',
      primary_abstraction: 'test', cue_anchors: ['t'],
      memory_value: 'val', energy: 0.5, created_at: '', updated_at: ''
    };
    expect(() => manager_no_hook.addEntry(unit, 'tier1')).not.toThrow();
  });

  describe('BM25 retriever', () => {
    function seed() {
      const units: HarmonicUnit[] = [
        { id: 'b1', type: 'semantic', primary_abstraction: 'JWT token configuration and auth', cue_anchors: ['jwt', 'auth'], memory_value: 'v', energy: 0.8, created_at: '', updated_at: '' },
        { id: 'b2', type: 'episodic', primary_abstraction: 'PostgreSQL connection pool tuning', cue_anchors: ['postgres', 'pool'], memory_value: 'v', energy: 0.7, created_at: '', updated_at: '' },
        { id: 'b3', type: 'semantic', primary_abstraction: 'OAuth2 refresh token rotation', cue_anchors: ['oauth', 'token'], memory_value: 'v', energy: 0.6, created_at: '', updated_at: '' },
        { id: 'b4', type: 'procedural', primary_abstraction: 'Redis cache eviction policy', cue_anchors: ['redis', 'cache'], memory_value: 'v', energy: 0.9, created_at: '', updated_at: '' },
      ];
      units.forEach((u, i) => manager.addEntry(u, `tier${i + 1}`));
    }

    it('returns relevant entries ranked by BM25 score', () => {
      seed();
      const results = manager.search('JWT token', 10, { retriever: 'bm25' });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('b1');
    });

    it('respects energy weighting when BM25 scores tie', () => {
      const units: HarmonicUnit[] = [
        { id: 'hi_e1', type: 'semantic', primary_abstraction: 'alpha token beta', cue_anchors: [], memory_value: 'v', energy: 0.9, created_at: '', updated_at: '' },
        { id: 'hi_e2', type: 'semantic', primary_abstraction: 'gamma token delta', cue_anchors: [], memory_value: 'v', energy: 0.5, created_at: '', updated_at: '' },
      ];
      units.forEach(u => manager.addEntry(u, 'tier1'));
      const results = manager.search('token', 10, { retriever: 'bm25' });
      expect(results.map(r => r.id)).toEqual(['hi_e1', 'hi_e2']);
    });

    it('returns empty for no matches', () => {
      seed();
      const results = manager.search('zzzzqwerty', 10, { retriever: 'bm25' });
      expect(results).toEqual([]);
    });

    it('is equivalent to search() default when entries are small', () => {
      const only: HarmonicUnit[] = [
        { id: 'x1', type: 'semantic', primary_abstraction: 'hello world test', cue_anchors: ['hi'], memory_value: 'v', energy: 0.5, created_at: '', updated_at: '' },
        { id: 'x2', type: 'semantic', primary_abstraction: 'goodbye', cue_anchors: [], memory_value: 'v', energy: 0.5, created_at: '', updated_at: '' },
      ];
      only.forEach(u => manager.addEntry(u, 'tier1'));
      const bm = manager.search('hello', 5, { retriever: 'bm25' });
      const tk = manager.search('hello', 5);
      expect(bm.map(r => r.id)).toContain('x1');
      expect(tk.map(r => r.id)).toContain('x1');
    });

    it('emits memory.recall with bm25 source', () => {
      const calls: Array<{ event: string; ctx: any }> = [];
      const mockHookManager = {
        execute: async (event: string, ctx: any) => { calls.push({ event, ctx }); }
      };
      const hookedManager = new HarmonicIndexManager(tmpDir, mockHookManager);
      const unit: HarmonicUnit = {
        id: 'bm_recall_1', type: 'semantic',
        primary_abstraction: 'JWT auth', cue_anchors: ['jwt'],
        memory_value: 'val', energy: 0.8, created_at: '', updated_at: ''
      };
      hookedManager.addEntry(unit, 'tier2');
      hookedManager.search('JWT', 5, { retriever: 'bm25' });
      expect(calls).toHaveLength(2);
      expect(calls[1].event).toBe('memory.recall');
      expect(calls[1].ctx.source).toBe('HarmonicIndexManager.bm25Search');
      expect(calls[1].ctx.resultIds).toEqual(['bm_recall_1']);
    });

    it('handles CJK queries via unigram tokenization', () => {
      const unit: HarmonicUnit = {
        id: 'cjk1', type: 'semantic',
        primary_abstraction: '支付系统密钥轮换', cue_anchors: ['支付', '密钥'],
        memory_value: 'val', energy: 0.7, created_at: '', updated_at: ''
      };
      manager.addEntry(unit, 'tier1');
      const results = manager.search('支付密钥', 5, { retriever: 'bm25' });
      expect(results.map(r => r.id)).toContain('cjk1');
    });

    it('empty index returns empty', () => {
      const results = manager.search('anything', 5, { retriever: 'bm25' });
      expect(results).toEqual([]);
    });
  });

  describe('searchScored and salience weighting', () => {
    it('returns entries with scores in descending order', () => {
      const u1: HarmonicUnit = { id: 's1', type: 'semantic', primary_abstraction: 'alpha beta gamma', cue_anchors: [], memory_value: 'v', energy: 0.8, created_at: '', updated_at: '' };
      manager.addEntry(u1, 'tier1');
      const scored = manager.searchScored('alpha beta', 5);
      expect(scored).toHaveLength(1);
      expect(scored[0].entry.id).toBe('s1');
      expect(scored[0].score).toBeGreaterThan(0);
    });

    it('persists salience in the index entry', () => {
      const u1: HarmonicUnit = { id: 'sal1', type: 'semantic', primary_abstraction: 'important fact', cue_anchors: ['important'], memory_value: 'v', energy: 0.5, salience: 1.5, created_at: '', updated_at: '' };
      manager.addEntry(u1, 'tier1');
      const idx = manager.getIndex();
      expect(idx.entries[0].salience).toBe(1.5);
    });

    it('boosts higher-salience entries with otherwise equal matches', () => {
      const low: HarmonicUnit = { id: 'low', type: 'semantic', primary_abstraction: 'same text', cue_anchors: [], memory_value: 'v', energy: 0.8, salience: 0.5, created_at: '', updated_at: '' };
      const high: HarmonicUnit = { id: 'high', type: 'semantic', primary_abstraction: 'same text', cue_anchors: [], memory_value: 'v', energy: 0.8, salience: 1.5, created_at: '', updated_at: '' };
      manager.addEntry(low, 'tier1');
      manager.addEntry(high, 'tier1');
      const results = manager.search('same text', 5);
      expect(results.map(r => r.id)).toEqual(['high', 'low']);
    });

    it('search still returns bare entries for backward compatibility', () => {
      const u1: HarmonicUnit = { id: 'bare1', type: 'semantic', primary_abstraction: 'bare test', cue_anchors: [], memory_value: 'v', energy: 0.5, created_at: '', updated_at: '' };
      manager.addEntry(u1, 'tier1');
      const results = manager.search('bare test', 5);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('bare1');
      expect((results[0] as any).score).toBeUndefined();
    });
  });
});
