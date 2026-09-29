/**
 * B4: reward-modulated consolidation — archiveGoal(PASS) bumps the energy of
 * memories from the goal's sessions (asymmetric: failure never drains, so
 * correct facts inside a failed goal are not punished for bad company).
 */
import { goalRewardBonus, applyGoalReward } from '../../../../src/core/manager/goal-reward';
import { HarmonicIndexManager } from '../../../../src/core/memory/harmonic-index';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('goalRewardBonus', () => {
  it('asymmetric: only PASS is rewarded, failure/cancel never punished', () => {
    expect(goalRewardBonus('PASS')).toBe(0.08);
    expect(goalRewardBonus('FAIL')).toBe(0);
    expect(goalRewardBonus('MAX_RETRIES')).toBe(0);
    expect(goalRewardBonus('ERROR')).toBe(0);
    expect(goalRewardBonus('CANCELLED')).toBe(0);
  });
});

describe('applyGoalReward', () => {
  function makeIndex(entries: Array<Partial<any>>): { index: HarmonicIndexManager; dir: string } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-reward-'));
    fs.mkdirSync(path.join(dir, 'memory'), { recursive: true });
    const index = new HarmonicIndexManager(dir);
    for (const e of entries) {
      index.addEntry({
        id: 'x',
        type: 'semantic',
        primary_abstraction: 'a',
        cue_anchors: [],
        created_at: new Date().toISOString(),
        ...e,
      } as any, (e.type as any) ?? 'semantic');
    }
    return { index, dir };
  }

  it('bumps energy (clamped at 1.0) only for live memories from the goal sessions', () => {
    const { index, dir } = makeIndex([
      { id: 'a', source_session_id: 's1', energy: 0.5 },
      { id: 'b', source_session_id: 's2', energy: 0.5 },
      { id: 'other', source_session_id: 's3', energy: 0.5 },
      { id: 'dead', source_session_id: 's1', energy: 0.5, superseded_by: 'newer' },
    ]);
    const res = applyGoalReward({ index, sessions: ['s1', 's2'] }, 'PASS');
    expect(res.rewarded).toBe(2); // a + b only (other excluded, dead excluded)
    const byId = new Map(index.getIndex().entries.map((e: any) => [e.id, e]));
    expect(byId.get('a')!.energy).toBeCloseTo(0.58, 5);
    expect(byId.get('b')!.energy).toBeCloseTo(0.58, 5);
    expect(byId.get('other')!.energy).toBe(0.5);
    expect(byId.get('dead')!.energy).toBe(0.5);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('clamps at the 1.0 ceiling instead of overflowing', () => {
    const { index, dir } = makeIndex([{ id: 'hi', source_session_id: 's1', energy: 0.97 }]);
    applyGoalReward({ index, sessions: ['s1'] }, 'PASS');
    expect(index.getIndex().entries[0].energy).toBeLessThanOrEqual(1.0);
    expect(index.getIndex().entries[0].energy).toBeCloseTo(1.0, 5);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('non-PASS verdicts are a no-op', () => {
    const { index, dir } = makeIndex([{ id: 'a', source_session_id: 's1', energy: 0.5 }]);
    const res = applyGoalReward({ index, sessions: ['s1'] }, 'FAIL');
    expect(res.rewarded).toBe(0);
    expect(index.getIndex().entries[0].energy).toBe(0.5);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
