import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { HarmonicUnitFileStore } from '../../../gateway/src/memory/harmonic-file-store';
import { HarmonicUnit } from '../../../gateway/src/core/memory/harmonic-types';

function makeUnit(overrides: Partial<HarmonicUnit> = {}): HarmonicUnit {
  const now = new Date().toISOString();
  return { id: 'mem_fn_001', type: 'semantic', granularity: 'function',
    primary_abstraction: 'createPayment', cue_anchors: ['payment'],
    memory_value: 'function code', energy: 0.7, salience: 1.0,
    abstraction_level: 2, created_at: now, updated_at: now, ...overrides };
}

describe('HarmonicUnitFileStore', () => {
  let tmpDir: string;
  let store: HarmonicUnitFileStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-'));
    store = new HarmonicUnitFileStore(tmpDir);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('write creates .md file', async () => {
    const unit = makeUnit();
    const fileName = await store.write(unit);
    const filePath = path.join(tmpDir, 'memory', 'concepts', 'knowledge', fileName);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test('write knowledge unit goes to concepts/knowledge/', async () => {
    const unit = makeUnit();
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^knowledge-/);
  });

  test('write semantic unit (no granularity) goes to concepts/semantic/', async () => {
    const unit = makeUnit({ granularity: undefined });
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^semantic-/);
  });

  test('write procedural unit goes to concepts/procedural/', async () => {
    const unit = makeUnit({ type: 'procedural', granularity: undefined });
    const fileName = await store.write(unit);
    expect(fileName).toMatch(/^procedural-/);
  });

  test('read returns unit matching what was written', async () => {
    const unit = makeUnit({ id: 'mem_read_001' });
    await store.write(unit);
    const loaded = await store.read('mem_read_001');
    expect(loaded).not.toBeNull();
    expect(loaded!.primary_abstraction).toBe('createPayment');
  });

  test('archive sets archived flag in frontmatter', async () => {
    const unit = makeUnit({ id: 'mem_arch_001' });
    await store.write(unit);
    await store.archive('mem_arch_001');
    const loaded = await store.read('mem_arch_001');
    expect(loaded).not.toBeNull();
    expect((loaded as any).archived).toBe(true);
  });
});
