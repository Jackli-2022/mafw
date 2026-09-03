import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildGoalSnapshot, collectActiveGoals } from '../../src/core/manager/goal-snapshot';

function writeState(mafwDir: string, goalId: string, state: Record<string, unknown>): void {
  fs.writeFileSync(path.join(mafwDir, 'state', `${goalId}.json`), JSON.stringify(state), 'utf-8');
}

describe('buildGoalSnapshot', () => {
  let mafwDir: string;

  beforeEach(() => {
    mafwDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-snap-'));
    fs.mkdirSync(path.join(mafwDir, 'state'), { recursive: true });
  });

  afterEach(() => fs.rmSync(mafwDir, { recursive: true, force: true }));

  it('returns null when no state dir or no active goals', () => {
    expect(buildGoalSnapshot(path.join(mafwDir, 'nonexistent'))).toBeNull();
    expect(buildGoalSnapshot(mafwDir)).toBeNull();
  });

  it('renders active goals and skips terminal ones', () => {
    writeState(mafwDir, 'g1', { goalId: 'g1', title: 'T1', phase: 'EXECUTING', round: 2, nextAction: 'CONTINUE' });
    writeState(mafwDir, 'g2', { goalId: 'g2', title: 'T2', phase: 'ARCHIVED', round: 5, nextAction: 'COMPLETED' });
    const snap = buildGoalSnapshot(mafwDir)!;
    expect(snap).toContain('<goal-snapshot>');
    expect(snap).toContain('g1: T1 [phase=EXECUTING round=2]');
    expect(snap).not.toContain('g2');
    expect(snap).toContain('</goal-snapshot>');
  });

  it('marks pending question count', () => {
    writeState(mafwDir, 'g3', {
      goalId: 'g3', title: 'T3', phase: 'REVIEWING', round: 1, nextAction: 'ASK_USER',
      pendingQuestion: { questions: [{ q: 'a' }, { q: 'b' }] },
    });
    expect(buildGoalSnapshot(mafwDir)).toContain('pendingQ=2');
  });

  it('caps goals at maxGoals', () => {
    for (let i = 0; i < 15; i++) {
      writeState(mafwDir, `g${i}`, { goalId: `g${i}`, title: `T${i}`, phase: 'EXECUTING', round: 1, nextAction: 'CONTINUE' });
    }
    const snap = buildGoalSnapshot(mafwDir, { maxGoals: 10 })!;
    expect(collectActiveGoals(mafwDir).length).toBe(15);
    expect(snap.split('\n').length).toBe(12); // open tag + 10 lines + close tag
  });

  it('skips corrupt state files', () => {
    fs.writeFileSync(path.join(mafwDir, 'state', 'bad.json'), '{not json', 'utf-8');
    writeState(mafwDir, 'gok', { goalId: 'gok', title: 'T', phase: 'EXECUTING', round: 1, nextAction: 'CONTINUE' });
    expect(collectActiveGoals(mafwDir).map(g => g.goalId)).toEqual(['gok']);
  });
});
