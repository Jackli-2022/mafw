import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ParametricStore } from '../../src/core/memory/store';
import { Delta } from '../../src/core/types/parametric';

const DAY = 24 * 60 * 60 * 1000;

function makeDelta(overrides: Partial<Delta> = {}): Delta {
  return {
    id: 'd1',
    type: 'constraint',
    scope: ['plan'],
    enforcement: 'hard',
    trigger_condition: { event: 'before_plan' },
    origin: { goal: 'g', loop: 1, task: 't' },
    created_at: new Date(Date.now() - 10 * DAY).toISOString(),
    energy_score: 0.5,
    verified: false,
    priority: 5,
    rule: 'must do X',
    ...overrides,
  } as Delta;
}

describe('ParametricStore incremental energy decay', () => {
  let tmpDir: string;
  let store: ParametricStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltas-'));
    store = new ParametricStore({ baseDir: tmpDir, bannedDir: path.join(tmpDir, 'banned'), manifestFile: path.join(tmpDir, 'manifest.yaml') });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('first save decays from created_at once, then stamps last_energy_at', () => {
    store.save(makeDelta());
    const loaded = store.load('d1', 'constraint')!;
    // 0.5 − 0.005×10 (full age, correct on first application) + 0.02 (retrieved)
    expect(loaded.energy_score).toBeCloseTo(0.47, 3);
    expect(loaded.last_energy_at).toBeDefined();
  });

  test('second save does not re-apply full-age decay (no quadratic accumulation)', () => {
    store.save(makeDelta());
    const first = store.load('d1', 'constraint')!;
    // Buggy version would subtract 0.005×10 again → 0.44.
    const again = makeDelta({ rule: 'must do Y', energy_score: first.energy_score, created_at: first.created_at, last_energy_at: first.last_energy_at });
    store.save(again);
    const loaded = store.load('d1', 'constraint')!;
    // Days since last_energy_at ≈ 0 → only the retrieved bonus applies.
    expect(loaded.energy_score).toBeCloseTo(first.energy_score + 0.02, 3);
  });

  test('updateEnergy applies the event delta incrementally from last_energy_at', () => {
    store.save(makeDelta());
    const first = store.load('d1', 'constraint')!;
    store.updateEnergy('d1', 'constraint', { type: 'useful_feedback' });
    const loaded = store.load('d1', 'constraint')!;
    // No time passed since stamp → pure +0.1 event bonus.
    expect(loaded.energy_score).toBeCloseTo(first.energy_score + 0.1, 3);
  });

  test('updateEnergy after 2 days decays 0.01 then applies event bonus', () => {
    store.save(makeDelta());
    const first = store.load('d1', 'constraint')!;
    // Simulate 2 days since the stamp.
    const bumped = { ...first, last_energy_at: new Date(Date.now() - 2 * DAY).toISOString() };
    store.save({ ...bumped, rule: 'must do Z' });
    const stamped = store.load('d1', 'constraint')!;
    store.updateEnergy('d1', 'constraint', { type: 'useful_feedback' });
    const loaded = store.load('d1', 'constraint')!;
    // The 2-day incremental decay (−0.01) was already settled by the save;
    // updateEnergy adds only the useful_feedback bonus (+0.1).
    expect(loaded.energy_score).toBeCloseTo(stamped.energy_score + 0.1, 3);
  });
});

describe('ParametricStore cleanupThreshold', () => {
  let tmpDir: string;
  let store: ParametricStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deltas-cleanup-'));
    store = new ParametricStore(
      { baseDir: tmpDir, bannedDir: path.join(tmpDir, 'banned'), manifestFile: path.join(tmpDir, 'manifest.yaml') },
      { cleanupThreshold: 0.3 }
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('cleanup archives deltas below threshold', () => {
    const lowEnergyDelta = makeDelta({
      id: 'low1',
      energy_score: 0.1,
      created_at: new Date(Date.now() - 100 * DAY).toISOString()
    });
    store.save(lowEnergyDelta);
    
    const archived = store.cleanup();
    
    expect(archived).toContain('low1');
    expect(store.load('low1', 'constraint')).toBeNull();
  });

  test('cleanup preserves deltas above threshold', () => {
    const healthyDelta = makeDelta({
      id: 'healthy1',
      energy_score: 0.8,
      created_at: new Date().toISOString()
    });
    store.save(healthyDelta);
    
    const archived = store.cleanup();
    
    expect(archived).not.toContain('healthy1');
    expect(store.load('healthy1', 'constraint')).not.toBeNull();
  });

  test('loadAll excludes archived deltas', () => {
    store.save(makeDelta({ id: 'keep1', energy_score: 0.9, created_at: new Date().toISOString() }));
    store.save(makeDelta({ id: 'archive1', energy_score: 0.05, created_at: new Date(Date.now() - 200 * DAY).toISOString() }));
    
    store.cleanup();
    const all = store.loadAll();
    
    expect(all.map(d => d.id)).toContain('keep1');
    expect(all.map(d => d.id)).not.toContain('archive1');
  });
});
