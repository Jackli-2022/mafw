import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  GoalConflictError,
  createGoalIntake,
  findGoalRequestPath,
  readGoalRequest,
  shouldAutoStartGoalEvent,
  type GoalIntakeDeps,
} from '../../../src/core/goal/goal-intake';

const NOW = '2026-11-03T00:00:00.000Z';

describe('goal intake: direct discussion layout', () => {
  let dir: string;
  let mafwDir: string;

  const deps = (emit = jest.fn()): GoalIntakeDeps => ({
    resolveProject: () => ({ projectDir: dir, mafwDir }),
    now: () => NOW,
    emitGoalCreated: emit,
  });

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-goal-intake-direct-'));
    mafwDir = path.join(dir, '.mafw');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writes goal.md and request.json into the per-Goal workspace without starting anything', () => {
    const emit = jest.fn();
    const result = createGoalIntake({
      goalId: 'goal-direct-1',
      title: 'Pod loop',
      objective: '实现协作 loop',
      projectDir: dir,
      layout: 'goal-dir',
      discussion: true,
      authorization: { source: 'lead', requestMode: 'explicit', scope: dir },
    }, deps(emit));

    const goalDir = path.join(mafwDir, 'goals', 'goal-direct-1');
    expect(result).toMatchObject({
      goalId: 'goal-direct-1',
      projectDir: dir,
      layout: 'goal-dir',
      goalDir,
      charterPath: path.join(goalDir, 'goal.md'),
      requestPath: path.join(goalDir, 'request.json'),
    });
    expect(fs.readFileSync(result.charterPath, 'utf-8')).toContain('# Pod loop');
    expect(fs.existsSync(path.join(mafwDir, 'goals', 'goal-direct-1.md'))).toBe(false);
    expect(fs.existsSync(path.join(mafwDir, 'requests', 'goal-direct-1.json'))).toBe(false);

    const request = JSON.parse(fs.readFileSync(result.requestPath, 'utf-8'));
    expect(request).toMatchObject({
      goalId: 'goal-direct-1',
      title: 'Pod loop',
      layout: 'goal-dir',
      discussion: true,
      stage: 'discussing',
      goalCharter: result.charterPath,
      authorization: { source: 'lead', requestMode: 'explicit', scope: dir },
    });

    // A discussion revision must never let the goal_created listener start NodeDriver.
    expect(emit).not.toHaveBeenCalled();
    expect(shouldAutoStartGoalEvent({ type: 'goal_created', goalId: 'goal-direct-1', discussion: true })).toBe(false);
    expect(shouldAutoStartGoalEvent({
      type: 'goal_created', goalId: 'goal-direct-1', stage: 'discussing',
    })).toBe(false);
    expect(shouldAutoStartGoalEvent({ type: 'goal_created', goalId: 'goal-direct-1' })).toBe(true);
    expect(shouldAutoStartGoalEvent({ type: 'goal_created' })).toBe(false);
  });

  test('keeps the legacy layout and auto-start event for existing callers', () => {
    const emit = jest.fn();
    const result = createGoalIntake({
      goalId: 'g1',
      title: 'Fix',
      charter: '# Fix',
      projectDir: dir,
      authorization: { source: 'user', requestMode: 'explicit' },
    }, deps(emit));

    expect(result).toMatchObject({
      layout: 'legacy',
      goalDir: null,
      charterPath: path.join(mafwDir, 'goals', 'g1.md'),
      requestPath: path.join(mafwDir, 'requests', 'g1.json'),
    });
    const request = JSON.parse(fs.readFileSync(result.requestPath, 'utf-8'));
    expect(request.layout).toBeUndefined();
    expect(request.discussion).toBeUndefined();
    expect(emit).toHaveBeenCalledWith({ type: 'goal_created', goalId: 'g1', projectDir: dir });
  });

  test('goal-dir layout rejects unsafe ids before creating anything', () => {
    for (const goalId of ['../escape', 'a/b', '..', '.hidden', 'C:\\abs', 'goal 1']) {
      expect(() => createGoalIntake({
        goalId,
        title: 'Bad',
        objective: 'x',
        projectDir: dir,
        layout: 'goal-dir',
        discussion: true,
        authorization: { source: 'lead', requestMode: 'explicit' },
      }, deps())).toThrow(/goal id/i);
    }
    expect(fs.existsSync(path.join(mafwDir, 'goals'))).toBe(false);
  });

  test('starter can resolve the goal-dir request and keeps planReview/taskType', () => {
    const result = createGoalIntake({
      goalId: 'goal-dir-start',
      title: 'Start me',
      objective: 'x',
      projectDir: dir,
      layout: 'goal-dir',
      discussion: true,
      planReview: 'manual',
      taskType: 'research',
      authorization: { source: 'lead', requestMode: 'explicit' },
    }, deps());

    expect(findGoalRequestPath(mafwDir, 'goal-dir-start')).toBe(result.requestPath);
    expect(readGoalRequest(mafwDir, 'goal-dir-start')).toMatchObject({
      planReview: 'manual',
      taskType: 'research',
      layout: 'goal-dir',
    });

    // Legacy callers keep resolving through the legacy path.
    const legacy = createGoalIntake({
      goalId: 'legacy-start',
      title: 'Legacy',
      charter: '# Legacy',
      projectDir: dir,
      authorization: { source: 'user', requestMode: 'explicit' },
    }, deps());
    expect(findGoalRequestPath(mafwDir, 'legacy-start')).toBe(legacy.requestPath);
    expect(readGoalRequest(mafwDir, 'legacy-start')).toMatchObject({ goalId: 'legacy-start' });
  });

  test('goal-dir layout reports duplicates through the shared conflict error', () => {
    const input = {
      goalId: 'goal-dup',
      title: 'Dup',
      objective: 'x',
      projectDir: dir,
      layout: 'goal-dir' as const,
      discussion: true,
      authorization: { source: 'lead' as const, requestMode: 'explicit' as const },
    };
    createGoalIntake(input, deps());
    expect(() => createGoalIntake(input, deps())).toThrow(GoalConflictError);
  });
});
