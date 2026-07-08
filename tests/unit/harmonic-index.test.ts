import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { HarmonicIndexManager } from '../../src/memory/harmonic-index';
import { HarmonicUnit } from '../../src/memory/harmonic-types';

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
      id: 'mem_1', memory_type: 'semantic',
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
    const u1: HarmonicUnit = { id: 'm1', memory_type: 'semantic', primary_abstraction: 'JWT auth', cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.8, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', memory_type: 'episodic', primary_abstraction: 'Error handling', cue_anchors: ['error'], memory_value: 'v2', energy: 0.5, created_at: '', updated_at: '' };
    manager.addEntry(u1, 'tier3');
    manager.addEntry(u2, 'tier2');
    const results = manager.search('JWT');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
  });

  it('search is tier-agnostic', () => {
    const u1: HarmonicUnit = { id: 'm1', memory_type: 'semantic', primary_abstraction: 'API design', cue_anchors: ['api'], memory_value: 'v1', energy: 0.6, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', memory_type: 'episodic', primary_abstraction: 'API bug fix', cue_anchors: ['api'], memory_value: 'v2', energy: 0.7, created_at: '', updated_at: '' };
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
      id: 'mem_hook_1', memory_type: 'semantic',
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
      id: 'mem_recall_1', memory_type: 'semantic',
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
      id: 'no_hook', memory_type: 'semantic',
      primary_abstraction: 'test', cue_anchors: ['t'],
      memory_value: 'val', energy: 0.5, created_at: '', updated_at: ''
    };
    expect(() => manager_no_hook.addEntry(unit, 'tier1')).not.toThrow();
  });
});
