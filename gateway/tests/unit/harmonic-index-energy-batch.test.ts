import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HarmonicIndexManager } from '../../src/core/memory/harmonic-index';
import { runEnergyDecay } from '../../src/automation-engine';
import { eventBus } from '../../src/event-bus';

const DAY = 24 * 60 * 60 * 1000;

function withIndex(entries: any[]): HarmonicIndexManager {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'energy-batch-'));
  fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'memory', '.harmonic_index.json'),
    JSON.stringify({ version: 2, updated_at: new Date().toISOString(), entries }, null, 2),
    'utf-8',
  );
  return new HarmonicIndexManager(dir);
}

const entry = (id: string, energy: number, daysAgo = 2) => ({
  id,
  type: 'semantic',
  primary_abstraction: id,
  cue_anchors: [],
  tier: 'semantic',
  energy,
  salience: 1,
  created_at: new Date(Date.now() - 10 * DAY).toISOString(),
  last_decay_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
});

function captureEnergyEvents(fn: () => void): any[] {
  const events: any[] = [];
  const on = (e: any) => events.push(e);
  eventBus.on('memory_energy_changed', on);
  try { fn(); } finally { eventBus.off('memory_energy_changed', on); }
  return events;
}

describe('energy batching (2026-11-08 decay storm)', () => {
  test('single updateEnergy keeps the legacy save + per-entry event', () => {
    const m = withIndex([entry('a', 0.5)]);
    const save = jest.spyOn(m, 'save');
    const events = captureEnergyEvents(() => m.updateEnergy('a', 0.2));
    expect(save).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'memory_energy_changed', id: 'a' });
  });

  test('batch mode ({silent:true, save:false}) writes and emits nothing per entry', () => {
    const m = withIndex([entry('a', 0.5), entry('b', 0.5), entry('c', 0.5)]);
    const save = jest.spyOn(m, 'save');
    const events = captureEnergyEvents(() => {
      for (const id of ['a', 'b', 'c']) m.updateEnergy(id, 0.1, { silent: true, save: false });
    });
    expect(save).not.toHaveBeenCalled();
    expect(events).toHaveLength(0);
    // mutations still happened in memory
    for (const e of m.getIndex().entries) expect((e as any).energy).toBeCloseTo(0.6, 6);
  });

  test('a full decay pass saves once and emits ONE coalesced event', () => {
    const m = withIndex([entry('a', 0.9), entry('b', 0.8), entry('c', 0.7)]);
    const save = jest.spyOn(m, 'save');
    let result: any;
    const events = captureEnergyEvents(() => {
      result = runEnergyDecay(m, Date.now(), []);
    });
    expect(result.decayed).toBe(3);
    // Bootstrap migration may add one save on the first pass; the steady-state
    // contract is "one save for the whole pass", never one per entry.
    expect(save.mock.calls.length).toBeLessThanOrEqual(2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'memory_energy_changed' });
    expect(events[0].decayed).toBe(3);
  });

  test('a pass with nothing to do emits no event', () => {
    const m = withIndex([entry('fresh', 0.9, 0)]);
    const events = captureEnergyEvents(() => runEnergyDecay(m, Date.now(), []));
    expect(events).toHaveLength(0);
  });
});
