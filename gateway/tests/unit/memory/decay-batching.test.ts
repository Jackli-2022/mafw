/**
 * Regression: daily decay over thousands of entries must not save + broadcast
 * per entry (2026-11-08 storm: 17k memory_energy_changed SSE frames, gateway
 * HTTP starvation). Per-entry updates are silent; one save and one event at end.
 */
import { eventBus } from '../../../src/event-bus';
import { runEnergyDecay } from '../../../src/automation-engine';

describe('runEnergyDecay batching', () => {
  afterEach(() => jest.restoreAllMocks());

  it('updates entries silently, saves once, emits one summary event', () => {
    const now = Date.now();
    const old = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const entries = [
      { id: 'a', type: 'semantic', energy: 0.9, salience: 1, last_decay_at: old, created_at: old },
      { id: 'b', type: 'semantic', energy: 0.8, salience: 1, last_decay_at: old, created_at: old },
    ];
    const updates: Array<{ id: string; delta: number; opts: any }> = [];
    const save = jest.fn();
    const stamp = jest.fn();
    const manager: any = {
      getIndex: () => ({ version: 2, entries }),
      updateEnergy: (id: string, delta: number, opts: any) => updates.push({ id, delta, opts }),
      stampDecay: stamp,
      save,
    };
    const emit = jest.spyOn(eventBus, 'emit');

    const result = runEnergyDecay(manager, now, []);

    expect(result.decayed).toBe(2);
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update.opts).toEqual({ silent: true, save: false });
    }
    expect(stamp).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    const energyEmits = emit.mock.calls.filter(([name]) => name === 'memory_energy_changed');
    expect(energyEmits).toHaveLength(1);
    expect(energyEmits[0][1]).toMatchObject({ decayed: 2, bonused: 0 });
  });
});
