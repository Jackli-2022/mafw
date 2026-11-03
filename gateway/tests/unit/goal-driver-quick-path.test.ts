import * as fs from 'fs';
import { makeHarness, seedGoal } from './helpers/goal-driver-harness';
import * as path from 'path';
import {
  currentAssignmentSummary,
  goalAssignmentFilePath,
  readGoalAssignment,
} from '../../src/core/goal/assignment';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';

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

  test('a complete quick receipt archives UNREVIEWED, never PASS', async () => {
    let structuredCalls = 0;
    const h = makeHarness({ structured: async () => (structuredCalls++ === 0 ? quickPlan : null) });
    seedGoal(h, 'gq');
    const planSid = await h.startAndIdle('gq');
    await h.fireIdle(planSid);

    const executeSid = h.load('gq')!.nodeSession.id;
    const receipt = nodeArtifactPaths(h.mafwDir, 'gq', 1).receipt;
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify({
      goalId: 'gq',
      receipts: [{ taskId: 'w1-t1', status: 'done', summary: 'fixed', files: ['src/log.ts'] }],
    }), 'utf-8');
    await h.fireIdle(executeSid);

    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'UNREVIEWED' });
    const st = h.load('gq')!;
    expect(st.nextAction).toBe('COMPLETED');
    expect(st.assessment).toBe('unreviewed');
    expect(st.reviewVerdict).toBeNull();
  });

  test('a failed quick receipt archives FAIL, not completed', async () => {
    let structuredCalls = 0;
    const h = makeHarness({ structured: async () => (structuredCalls++ === 0 ? quickPlan : null) });
    seedGoal(h, 'gq');
    const planSid = await h.startAndIdle('gq');
    await h.fireIdle(planSid);

    const executeSid = h.load('gq')!.nodeSession.id;
    const receipt = nodeArtifactPaths(h.mafwDir, 'gq', 1).receipt;
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify({
      goalId: 'gq',
      receipts: [{ taskId: 'w1-t1', status: 'failed', summary: 'could not fix' }],
    }), 'utf-8');
    await h.fireIdle(executeSid);

    expect(h.calls.find((c) => c.op === 'archiveGoal')).toMatchObject({ verdict: 'FAIL' });
    expect(h.load('gq')!.nextAction).toBe('FAILED');
  });

  test('an incomplete quick receipt returns to Tech Lead once', async () => {
    let structuredCalls = 0;
    const h = makeHarness({ structured: async () => (structuredCalls++ === 0 ? quickPlan : null) });
    seedGoal(h, 'gq');
    const planSid = await h.startAndIdle('gq');
    await h.fireIdle(planSid);

    const executeSid = h.load('gq')!.nodeSession.id;
    const receipt = nodeArtifactPaths(h.mafwDir, 'gq', 1).receipt;
    fs.mkdirSync(path.dirname(receipt), { recursive: true });
    fs.writeFileSync(receipt, JSON.stringify({ goalId: 'gq', receipts: [] }), 'utf-8');
    await h.fireIdle(executeSid);

    const st = h.load('gq')!;
    expect(st.quickRepairCount).toBe(1);
    expect(st.nextNode).toBe('plan');
    expect(st.planFeedback).toContain('w1-t1');
    expect(h.calls.some((c) => c.op === 'archiveGoal')).toBe(false);
  });
});
