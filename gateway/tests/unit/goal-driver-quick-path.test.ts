import * as fs from 'fs';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import {
  currentAssignmentSummary,
  goalAssignmentFilePath,
  readGoalAssignment,
} from '../../src/core/goal/assignment';

const quickPlan = {
  status: 'ready',
  strategy: 'quick',
  taskType: 'bugfix',
  waves: [{
    id: 'w1',
    title: 'Small debug',
    riskNote: 'low',
    tasks: [{ title: 'fix the log error', acceptance: ['the error is gone'] }],
  }],
};

describe('quick Worker assignment dispatch', () => {
  test('persists an assignment before dispatch and puts its block after manifest/handoff', async () => {
    const h = makeHarness({ structured: async () => quickPlan });
    h.deps.contextBlock = async () => '[CONTEXT MANIFEST]\nmanifest';
    h.deps.podContext = () => '[POD HANDOFF]\nhandoff';
    seedGoal(h, 'gq');
    const sid = await h.startAndIdle('gq');
    await h.fireIdle(sid);

    const state = h.load('gq')!;
    expect(state.nextNode).toBe('execute');
    expect(state.currentAssignmentId).toMatch(/^asg_/);

    const jsonPath = goalAssignmentFilePath(h.mafwDir, 'gq', 1, state.currentAssignmentId);
    const assignment = readGoalAssignment(jsonPath)!;
    expect(assignment).toMatchObject({
      goalId: 'gq',
      revision: 1,
      role: 'builder',
      strategy: 'quick',
      taskIds: ['w1-t1'],
      acceptance: { 'w1-t1': ['the error is gone'] },
    });
    expect(assignment.attempts).toEqual([
      expect.objectContaining({ attempt: 1, sessionId: state.nodeSession.id }),
    ]);
    expect(currentAssignmentSummary(h.mafwDir, 'gq', 1, state.currentAssignmentId)).toMatchObject({
      assignmentId: state.currentAssignmentId,
      role: 'builder',
      taskIds: ['w1-t1'],
      attempt: 1,
    });

    const prompt = h.calls.filter((c) => c.op === 'promptAsync').at(-1)?.parts?.[0]?.text as string;
    const manifestAt = prompt.indexOf('[CONTEXT MANIFEST]');
    const handoffAt = prompt.indexOf('[POD HANDOFF]');
    const assignmentAt = prompt.indexOf('[ASSIGNMENT]');
    const taskAt = prompt.indexOf('任务：');
    expect(manifestAt).toBeGreaterThanOrEqual(0);
    expect(handoffAt).toBeGreaterThan(manifestAt);
    expect(assignmentAt).toBeGreaterThan(handoffAt);
    expect(taskAt).toBeGreaterThan(assignmentAt);
    expect(prompt).toContain('w1-t1');
    expect(prompt).toContain('the error is gone');
    expect(prompt).toContain(assignment.artifacts.receipt!);

    const promptPath = jsonPath.replace(/\.json$/, '.attempt-1.prompt.md');
    expect(fs.readFileSync(promptPath, 'utf-8')).toBe(prompt);
  });
});
