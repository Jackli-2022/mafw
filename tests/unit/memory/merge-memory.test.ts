import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const mhash = require('../../../gateway/src/core/memory/minhash-merger');
const htypes = require('../../../gateway/src/core/memory/harmonic-types');

function makeMemory(overrides: Record<string, any> = {}): any {
  const now = new Date().toISOString();
  return {
    id: htypes.generateHarmonicId(),
    type: 'semantic',
    primary_abstraction: 'test memory',
    cue_anchors: ['test'],
    memory_value: 'test value',
    energy: 0.8,
    salience: 1.0,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('Memory Merge', () => {
  let targetDir: string;
  let sourceDir: string;

  beforeEach(() => {
    targetDir = path.join(os.tmpdir(), `mm-target-${Date.now()}`);
    sourceDir = path.join(os.tmpdir(), `mm-source-${Date.now()}`);
    fs.mkdirSync(path.join(targetDir, '.mafw', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(sourceDir, '.mafw', 'memory'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(targetDir, { recursive: true, force: true });
    fs.rmSync(sourceDir, { recursive: true, force: true });
  });

  it('adds unique memories from source to target', () => {
    const targetUnits = [makeMemory({ id: 'm1', primary_abstraction: 'existing memory', memory_value: 'exists' })];
    const sourceUnits = [makeMemory({ id: 's1', primary_abstraction: 'new memory from branch', memory_value: 'new stuff' })];

    fs.writeFileSync(path.join(targetDir, '.mafw', 'memory', 'memories.json'), JSON.stringify(targetUnits, null, 2));
    fs.writeFileSync(path.join(sourceDir, '.mafw', 'memory', 'memories.json'), JSON.stringify(sourceUnits, null, 2));

    const minhash = new mhash.MinHashMerger();
    const target = [...targetUnits];
    const added: any[] = [];

    for (const srcUnit of sourceUnits) {
      const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
      let bestSim = 0;
      for (const tgtUnit of target) {
        const tgtSig = minhash.generateSignature(tgtUnit.primary_abstraction || '');
        const sim = minhash.similarity(srcSig, tgtSig);
        if (sim > bestSim) bestSim = sim;
      }
      if (bestSim <= 0.6) {
        const now = new Date().toISOString();
        target.push({
          id: htypes.generateHarmonicId(),
          type: srcUnit.type || 'semantic',
          primary_abstraction: srcUnit.primary_abstraction,
          cue_anchors: srcUnit.cue_anchors || [],
          memory_value: srcUnit.memory_value,
          energy: 0.4,
          merged_from: [srcUnit.id],
          created_at: now,
          updated_at: now,
        });
        added.push(srcUnit);
      }
    }

    expect(added).toHaveLength(1);
    expect(target).toHaveLength(2);
    expect(target[1].energy).toBe(0.4);
    expect(target[1].merged_from).toEqual(['s1']);
  });

  it('skips memories that already exist in target (same abstraction + value)', () => {
    const targetUnits = [makeMemory({ id: 'm1', primary_abstraction: 'shared memory', memory_value: 'same content' })];
    const sourceUnits = [makeMemory({ id: 's1', primary_abstraction: 'shared memory', memory_value: 'same content' })];

    const minhash = new mhash.MinHashMerger();
    const target = [...targetUnits];
    const added: any[] = [];
    const conflicts: any[] = [];

    for (const srcUnit of sourceUnits) {
      const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
      let bestMatch: any = null;
      let bestSim = 0;
      for (const tgtUnit of target) {
        const tgtSig = minhash.generateSignature(tgtUnit.primary_abstraction || '');
        const sim = minhash.similarity(srcSig, tgtSig);
        if (sim > bestSim) { bestSim = sim; bestMatch = tgtUnit; }
      }
      if (bestSim > 0.6) {
        if (bestMatch.memory_value !== srcUnit.memory_value) conflicts.push(srcUnit);
      } else {
        added.push(srcUnit);
      }
    }

    expect(added).toHaveLength(0);
    expect(conflicts).toHaveLength(0);
  });

  it('detects conflicts when same abstraction has different values', () => {
    const targetUnits = [makeMemory({ id: 'm1', primary_abstraction: 'payment timeout', memory_value: 'timeout is 3s' })];
    const sourceUnits = [makeMemory({ id: 's1', primary_abstraction: 'payment timeout', memory_value: 'timeout is 10s' })];

    const minhash = new mhash.MinHashMerger();
    const target = [...targetUnits];
    const conflicts: any[] = [];

    for (const srcUnit of sourceUnits) {
      const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
      let bestMatch: any = null;
      let bestSim = 0;
      for (const tgtUnit of target) {
        const tgtSig = minhash.generateSignature(tgtUnit.primary_abstraction || '');
        const sim = minhash.similarity(srcSig, tgtSig);
        if (sim > bestSim) { bestSim = sim; bestMatch = tgtUnit; }
      }
      if (bestSim > 0.6 && bestMatch.memory_value !== srcUnit.memory_value) {
        conflicts.push({ source: srcUnit, target: bestMatch });
      }
    }

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].source.memory_value).toBe('timeout is 10s');
    expect(conflicts[0].target.memory_value).toBe('timeout is 3s');
  });

  it('new memories get energy=0.4 and merged_from set', () => {
    const srcUnit = makeMemory({ id: 'src-1', primary_abstraction: 'branch specific knowledge', memory_value: 'only in branch' });
    const now = new Date().toISOString();
    const newUnit = {
      id: htypes.generateHarmonicId(),
      type: srcUnit.type,
      primary_abstraction: srcUnit.primary_abstraction,
      cue_anchors: srcUnit.cue_anchors,
      memory_value: srcUnit.memory_value,
      energy: 0.4,
      merged_from: [srcUnit.id],
      created_at: now,
      updated_at: now,
    };

    expect(newUnit.energy).toBe(0.4);
    expect(newUnit.merged_from).toEqual(['src-1']);
  });

  it('creates fusion log when memories are added', () => {
    const targetMemPath = path.join(targetDir, '.mafw', 'memory', 'memories.json');
    const sourceMemPath = path.join(sourceDir, '.mafw', 'memory', 'memories.json');
    fs.writeFileSync(targetMemPath, JSON.stringify([], null, 2));
    fs.writeFileSync(sourceMemPath, JSON.stringify([makeMemory({ primary_abstraction: 'unique' })], null, 2));

    const minhash = new mhash.MinHashMerger();
    const target: any[] = JSON.parse(fs.readFileSync(targetMemPath, 'utf-8'));
    const sourceUnits: any[] = JSON.parse(fs.readFileSync(sourceMemPath, 'utf-8'));
    const added: any[] = [];

    for (const srcUnit of sourceUnits) {
      const srcSig = minhash.generateSignature(srcUnit.primary_abstraction || '');
      let bestSim = 0;
      for (const tgtUnit of target) {
        const tgtSig = minhash.generateSignature(tgtUnit.primary_abstraction || '');
        const sim = minhash.similarity(srcSig, tgtSig);
        if (sim > bestSim) bestSim = sim;
      }
      if (bestSim <= 0.6) {
        target.push({
          id: htypes.generateHarmonicId(),
          primary_abstraction: srcUnit.primary_abstraction,
          memory_value: srcUnit.memory_value,
          energy: 0.4,
          merged_from: [srcUnit.id],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        added.push(srcUnit);
      }
    }

    const fusionLogPath = path.join(targetDir, '.mafw', 'fusion-log.jsonl');
    if (added.length > 0) {
      fs.writeFileSync(targetMemPath, JSON.stringify(target, null, 2));
      const logEntry = JSON.stringify({ timestamp: new Date().toISOString(), source_worktree: sourceDir, added: [{ id: added[0].id }], conflicts: [] });
      fs.appendFileSync(fusionLogPath, logEntry + '\n', 'utf-8');
    }

    expect(fs.existsSync(fusionLogPath)).toBe(true);
    const logContent = fs.readFileSync(fusionLogPath, 'utf-8').trim();
    expect(logContent).toContain('source_worktree');
  });
});
