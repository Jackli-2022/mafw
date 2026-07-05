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
      id: 'mem_1', goal_id: 'g1', memory_type: 'semantic',
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
    const u1: HarmonicUnit = { id: 'm1', goal_id: 'g1', memory_type: 'semantic', primary_abstraction: 'JWT auth', cue_anchors: ['jwt'], memory_value: 'v1', energy: 0.8, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', goal_id: 'g1', memory_type: 'episodic', primary_abstraction: 'Error handling', cue_anchors: ['error'], memory_value: 'v2', energy: 0.5, created_at: '', updated_at: '' };
    manager.addEntry(u1, 'tier3');
    manager.addEntry(u2, 'tier2');
    const results = manager.search('JWT');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
  });

  it('search is tier-agnostic', () => {
    const u1: HarmonicUnit = { id: 'm1', goal_id: 'g1', memory_type: 'semantic', primary_abstraction: 'API design', cue_anchors: ['api'], memory_value: 'v1', energy: 0.6, created_at: '', updated_at: '' };
    const u2: HarmonicUnit = { id: 'm2', goal_id: 'g1', memory_type: 'episodic', primary_abstraction: 'API bug fix', cue_anchors: ['api'], memory_value: 'v2', energy: 0.7, created_at: '', updated_at: '' };
    manager.addEntry(u1, 'tier3');
    manager.addEntry(u2, 'tier2');
    const results = manager.search('API');
    expect(results).toHaveLength(2);
  });
});
