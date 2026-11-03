import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  createGoalAssignment,
  currentAssignmentSummary,
  readGoalAssignment,
  renderGoalAssignmentBlock,
  retryGoalAssignment,
  writeGoalAssignment,
} from '../../../src/core/goal/assignment';

function input(overrides: Record<string, unknown> = {}) {
  return {
    goalId: 'goal-1',
    revision: 1,
    role: 'builder' as const,
    strategy: 'quick' as const,
    taskIds: ['w1-t1'],
    acceptance: { 'w1-t1': ['tests pass'] },
    contextRefs: ['/project/.mafw/waves.json'],
    artifacts: { receipt: '/project/.mafw/receipts/goal-1/loop-1-receipt.json' },
    instructions: 'Fix the assigned bug.',
    sessionId: 'ses_1',
    startedAt: '2026-11-03T00:00:00.000Z',
    nodeRunId: 10,
    ...overrides,
  };
}

describe('Goal assignment files', () => {
  test('creates a deterministic assignment id from the dispatched work', () => {
    const a = createGoalAssignment(input());
    const b = createGoalAssignment(input());
    expect(a.assignmentId).toBe(b.assignmentId);
    expect(a.assignmentId).toMatch(/^asg_[a-f0-9]{12}$/);

    const changed = createGoalAssignment(input({ acceptance: { 'w1-t1': ['different'] } }));
    expect(changed.assignmentId).not.toBe(a.assignmentId);
  });

  test('retry keeps the id and appends an attempt without overwriting the old prompt', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-assignment-'));
    const first = createGoalAssignment(input());
    const firstPaths = writeGoalAssignment({
      mafwDir: dir,
      assignment: first,
      fullPrompt: 'first prompt',
    });
    const retry = retryGoalAssignment(first, {
      sessionId: 'ses_2',
      startedAt: '2026-11-03T00:05:00.000Z',
      nodeRunId: 11,
    });
    const secondPaths = writeGoalAssignment({
      mafwDir: dir,
      assignment: retry,
      fullPrompt: 'retry prompt',
    });

    expect(retry.assignmentId).toBe(first.assignmentId);
    expect(readGoalAssignment(secondPaths.jsonPath)?.attempts).toEqual([
      { attempt: 1, sessionId: 'ses_1', startedAt: '2026-11-03T00:00:00.000Z', nodeRunId: 10 },
      { attempt: 2, sessionId: 'ses_2', startedAt: '2026-11-03T00:05:00.000Z', nodeRunId: 11 },
    ]);
    expect(firstPaths.promptPath).not.toBe(secondPaths.promptPath);
    expect(fs.readFileSync(firstPaths.promptPath, 'utf-8')).toBe('first prompt');
    expect(fs.readFileSync(secondPaths.promptPath, 'utf-8')).toBe('retry prompt');
  });

  test('refuses to overwrite an existing prompt snapshot', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-assignment-'));
    const assignment = createGoalAssignment(input());
    writeGoalAssignment({ mafwDir: dir, assignment, fullPrompt: 'same prompt' });
    expect(() => writeGoalAssignment({ mafwDir: dir, assignment, fullPrompt: 'same prompt' }))
      .toThrow();
  });

  test('rejects unsafe goal ids and traversal', () => {
    expect(() => createGoalAssignment(input({ goalId: '../escape' }))).toThrow(/goal id/i);
    expect(() => createGoalAssignment(input({ revision: 0 }))).toThrow(/revision/i);
  });

  test('renders task, acceptance, context and artifact paths for the Worker', () => {
    const block = renderGoalAssignmentBlock(createGoalAssignment(input()));
    expect(block).toContain('[ASSIGNMENT]');
    expect(block).toContain('goal-1');
    expect(block).toContain('revision: 1');
    expect(block).toContain('w1-t1');
    expect(block).toContain('tests pass');
    expect(block).toContain('/project/.mafw/waves.json');
    expect(block).toContain('loop-1-receipt.json');
    expect(block).toContain('Fix the assigned bug.');
  });

  test('projects only the current revision and assignment, never another one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-assignment-'));
    const assignment = createGoalAssignment(input({
      revision: 2,
      role: 'reviewer',
      artifacts: { review: '/project/.mafw/reviews/goal-1-loop1.md' },
    }));
    const paths = writeGoalAssignment({ mafwDir: dir, assignment, fullPrompt: 'review prompt' });

    expect(currentAssignmentSummary(dir, 'goal-1', 2, assignment.assignmentId)).toMatchObject({
      assignmentId: assignment.assignmentId,
      role: 'reviewer',
      taskIds: ['w1-t1'],
      attempt: 1,
    });
    expect(currentAssignmentSummary(dir, 'goal-1', 1, assignment.assignmentId)).toBeNull();
    expect(currentAssignmentSummary(dir, 'goal-1', 2, 'asg_missing')).toBeNull();
    expect(paths.jsonPath).toContain(path.join('revisions', 'goal-1', 'rev-2'));
  });
});
