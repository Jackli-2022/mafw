import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  GoalStateV3, statePathFor, loadGoalState, writeGoalState,
  ensureGoalState, effectiveRound, isTerminalState,
} from '../../src/core/goal/state-v3';

function tmpMafwDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-state-'));
}

describe('state-v3', () => {
  it('ensureGoalState 幂等：已存在则不覆盖', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
    writeGoalState(dir, 'g1', { round: 5 });
    const s2 = ensureGoalState(dir, 'g1', { projectDir: 'C:/p', maxRounds: 3 });
    expect(s2.round).toBe(5);
  });

  it('ensureGoalState 新建：version 3 / nextNode plan / round=loop=1 / policySnapshot', () => {
    const dir = tmpMafwDir();
    const s = ensureGoalState(dir, 'g2', { projectDir: 'C:/p', maxRounds: 3, policySnapshot: { version: 'builtin-v1' } });
    expect(s.version).toBe('3');
    expect(s.nextNode).toBe('plan');
    expect(s.round).toBe(1);
    expect(s.loop).toBe(1); // 双写别名（dashboard/旧读方兼容）
    expect(s.phase).toBe('PLANNING');
    expect(s.policySnapshot).toEqual({ version: 'builtin-v1' });
  });

  it('writeGoalState 原子合并 + round/loop 双写 + updatedAt 刷新 + 无 tmp 残留', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g3', { projectDir: 'C:/p', maxRounds: 3 });
    const before = loadGoalState(dir, 'g3')!;
    writeGoalState(dir, 'g3', { round: 2, lastError: 'boom' });
    const after = loadGoalState(dir, 'g3')!;
    expect(after.round).toBe(2);
    expect(after.loop).toBe(2);
    expect(after.lastError).toBe('boom');
    expect(after.maxRounds).toBe(before.maxRounds);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
    expect(fs.existsSync(statePathFor(dir, 'g3') + '.tmp')).toBe(false);
  });

  it('writeGoalState bumpVersion 显式递增 stateVersion', () => {
    const dir = tmpMafwDir();
    ensureGoalState(dir, 'g4', { projectDir: 'C:/p', maxRounds: 3 });
    const s = writeGoalState(dir, 'g4', { reviewVerdict: 'FAIL' }, { bumpVersion: true });
    expect(s.stateVersion).toBe(1);
  });

  it('effectiveRound: round 优先，回退 loop，再回退 0', () => {
    expect(effectiveRound({ round: 3, loop: 9 })).toBe(3);
    expect(effectiveRound({ loop: 9 } as any)).toBe(9);
    expect(effectiveRound({} as any)).toBe(0);
  });

  it('isTerminalState: nextAction 终态集', () => {
    expect(isTerminalState({ nextAction: 'COMPLETED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'FAILED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'CANCELLED' } as GoalStateV3)).toBe(true);
    expect(isTerminalState({ nextAction: 'RUNNING_plan' } as GoalStateV3)).toBe(false);
  });

  it('loadGoalState 读旧 v2（loop 字段）→ effectiveRound 规范化', () => {
    const dir = tmpMafwDir();
    fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
    fs.writeFileSync(statePathFor(dir, 'g5'), JSON.stringify({
      version: '2', goalId: 'g5', loop: 4, phase: 'EXECUTING', nextAction: 'WAIT_PHASE_COMPLETE',
    }), 'utf-8');
    const s = loadGoalState(dir, 'g5');
    expect(s).not.toBeNull();
    expect(effectiveRound(s!)).toBe(4);
  });
});
