import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { actionRegistry } from '../../src/automation-engine';

const DAY = 24 * 60 * 60 * 1000;

function writeIndex(dir: string, index: any): void {
  const memDir = path.join(dir, 'memory');
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, '.harmonic_index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

function readIndex(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, 'memory', '.harmonic_index.json'), 'utf-8'));
}

function makeEntry(overrides: Record<string, any> = {}): any {
  return {
    id: 'm1',
    type: 'semantic',
    primary_abstraction: 'test memory',
    cue_anchors: [],
    tier: 'semantic',
    energy: 0.9,
    salience: 1,
    created_at: new Date(Date.now() - 10 * DAY).toISOString(),
    ...overrides,
  };
}

describe('memory:decay incremental decay', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decay-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function runDecay(): Promise<void> {
    const action = actionRegistry.get('memory:decay');
    expect(action).toBeDefined();
    await action!({} as any, { mafwDir: tmpDir } as any);
  }

  test('decays only days since last_decay_at, not full age since created_at', async () => {
    const now = Date.now();
    writeIndex(tmpDir, {
      version: 2,
      updated_at: new Date(now).toISOString(),
      entries: [makeEntry({
        created_at: new Date(now - 10 * DAY).toISOString(),
        last_decay_at: new Date(now - 2 * DAY).toISOString(),
      })],
    });

    await runDecay();

    const entry = readIndex(tmpDir).entries[0];
    // 2 days × 0.005 = 0.01 → 0.89. The buggy full-age version would give
    // 0.9 − 10×0.005 = 0.85.
    expect(entry.energy).toBeCloseTo(0.89, 3);
    expect(new Date(entry.last_decay_at).getTime()).toBeGreaterThan(now - 60_000);
  });

  test('second run on the same day is a no-op (idempotent)', async () => {
    const now = Date.now();
    writeIndex(tmpDir, {
      version: 2,
      updated_at: new Date(now).toISOString(),
      entries: [makeEntry({ last_decay_at: new Date(now - 2 * DAY).toISOString() })],
    });

    await runDecay();
    const afterFirst = readIndex(tmpDir).entries[0].energy;
    await runDecay();
    const afterSecond = readIndex(tmpDir).entries[0].energy;

    expect(afterSecond).toBeCloseTo(afterFirst, 5);
  });

  test('accumulated days below the write threshold are not lost (no starvation)', async () => {
    const now = Date.now();
    // 0.5 day → diff 0.0025 ≤ 0.005 threshold: no write, and the clock must
    // NOT be reset, otherwise low-rate entries would never decay.
    const halfDayAgo = new Date(now - 0.5 * DAY).toISOString();
    writeIndex(tmpDir, {
      version: 2,
      updated_at: new Date(now).toISOString(),
      entries: [makeEntry({ last_decay_at: halfDayAgo })],
    });

    await runDecay();

    const entry = readIndex(tmpDir).entries[0];
    expect(entry.energy).toBeCloseTo(0.9, 5);
    expect(entry.last_decay_at).toBe(halfDayAgo);

    // Now simulate 1.5 more days passing: 2 days total → 0.01 applied.
    const idx = readIndex(tmpDir);
    idx.entries[0].last_decay_at = new Date(now - 2 * DAY).toISOString();
    writeIndex(tmpDir, idx);
    await runDecay();
    expect(readIndex(tmpDir).entries[0].energy).toBeCloseTo(0.89, 3);
  });

  test('migration (v1 → v2): stamps baseline without applying decay, then decays incrementally', async () => {
    const now = Date.now();
    writeIndex(tmpDir, {
      version: 1,
      updated_at: new Date(now).toISOString(),
      entries: [makeEntry({ created_at: new Date(now - 100 * DAY).toISOString() })],
    });

    await runDecay();

    let idx = readIndex(tmpDir);
    // Past is forgiven: no energy change on migration run (the pre-fix passes
    // already over-decayed entries quadratically; re-applying 100 days would
    // be one more unjustified hit).
    expect(idx.version).toBe(2);
    expect(idx.entries[0].energy).toBeCloseTo(0.9, 5);
    expect(idx.entries[0].last_decay_at).toBeDefined();

    // After migration, incremental decay resumes from the stamped baseline.
    idx.entries[0].last_decay_at = new Date(now - 3 * DAY).toISOString();
    writeIndex(tmpDir, idx);
    await runDecay();
    expect(readIndex(tmpDir).entries[0].energy).toBeCloseTo(0.885, 3);
  });

  test('entry without last_decay_at on a v2 index falls back to created_at', async () => {
    const now = Date.now();
    writeIndex(tmpDir, {
      version: 2,
      updated_at: new Date(now).toISOString(),
      entries: [makeEntry({ created_at: new Date(now - 4 * DAY).toISOString() })],
    });

    await runDecay();

    const entry = readIndex(tmpDir).entries[0];
    expect(entry.energy).toBeCloseTo(0.88, 3); // 4 × 0.005
    expect(entry.last_decay_at).toBeDefined();
  });
});
