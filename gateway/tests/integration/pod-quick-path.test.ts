import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../src/core/pod/pod-store';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import { PodGoalRevisionService } from '../../src/core/pod/pod-goal-revision-service';
import {
  ensureGoalState,
  loadGoalState,
  revisionStatePathFor,
  writeGoalState,
} from '../../src/core/goal/state-v3';
import {
  createGoalAssignment,
  writeGoalAssignment,
} from '../../src/core/goal/assignment';

const NOW = '2026-11-03T00:00:00.000Z';

describe('quick Goal result -> Tech Lead rejection', () => {
  test('opens the next revision and preserves revision-1 evidence and assignment prompt', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-quick-reject-'));
    const db = new Database(path.join(dir, 'test.db'));
    const store = new PodStore(db);
    const mafwDir = path.join(dir, 'mafw');
    const ensureSession = jest.fn(async () => 'ses_tl');
    store.ensurePod({ id: 'pod_1', projectDir: '/proj/a', name: 'Project', now: NOW });
    const goal = store.enqueueGoal({ id: 'pg_quick', podId: 'pod_1', goalId: 'gq', now: NOW });
    store.setGoalStatus(goal.id, 'active', { startedAt: NOW });
    store.updatePod('pod_1', { status: 'active', activeGoalId: 'gq' }, NOW);
    store.createGoalRevision({
      podId: 'pod_1',
      goalId: 'gq',
      revision: 1,
      status: 'completed',
      verdict: null,
      endedAt: NOW,
      now: NOW,
    });

    const assignment = createGoalAssignment({
      goalId: 'gq',
      revision: 1,
      role: 'builder',
      strategy: 'quick',
      taskIds: ['w1-t1'],
      acceptance: { 'w1-t1': ['works'] },
      contextRefs: ['/proj/a/.mafw/waves.json'],
      artifacts: { receipt: '/proj/a/.mafw/receipts/gq/loop-1-receipt.json' },
      instructions: 'fix',
      sessionId: 'ses_builder',
      startedAt: NOW,
    });
    const assignmentFiles = writeGoalAssignment({ mafwDir, assignment, fullPrompt: 'frozen prompt' });
    ensureGoalState(mafwDir, 'gq', { projectDir: '/proj/a', maxRounds: 3 });
    writeGoalState(mafwDir, 'gq', {
      nextAction: 'COMPLETED',
      phase: 'ARCHIVED',
      reviewVerdict: null,
      strategy: 'quick',
      assessment: 'unreviewed',
      quickRepairCount: 1,
      currentAssignmentId: assignment.assignmentId,
    });

    const revisions = new PodGoalRevisionService({
      store,
      resolveMafwDir: () => mafwDir,
      now: () => NOW,
      resultForGoal: () => ({
        goalId: 'gq',
        revision: 1,
        verdict: null,
        resultReady: true,
        reviewed: false,
        assessment: 'unreviewed',
        goalAcceptance: [],
        goalConditions: [],
        goalResults: [],
        goalEvalValid: false,
        failure: null,
        tasks: [],
        reviewFeedback: '',
        receipt: {},
        artifacts: [],
      }),
      notify: () => {},
    });
    const service = new PodGoalService({
      store,
      pods: { ensure: jest.fn() } as any,
      startGoal: jest.fn(async () => {}),
      resolveProjectDir: () => '/proj/a',
      now: () => NOW,
      newId: () => `pg_${Math.random().toString(36).slice(2, 8)}`,
      notify: () => {},
      resultForGoal: () => ({
        goalId: 'gq',
        revision: 1,
        verdict: null,
        resultReady: true,
        reviewed: false,
        assessment: 'unreviewed',
        goalAcceptance: [],
        goalConditions: [],
        goalResults: [],
        goalEvalValid: false,
        failure: null,
        tasks: [],
        reviewFeedback: '',
        receipt: {},
        artifacts: [],
      }),
      revisions,
      sessions: { retireRevision: jest.fn(async () => true) },
      techLead: { ensureSession } as any,
    });

    const rejected = await service.rejectResult('pod_1', 'gq', '这个修法不行，Tech Lead 重做');

    expect(rejected).toMatchObject({ revision: 2, status: 'discussing', sessionID: 'ses_tl' });
    expect(ensureSession).toHaveBeenCalledWith('gq');
    expect(JSON.parse(fs.readFileSync(revisionStatePathFor(mafwDir, 'gq', 1), 'utf-8')))
      .toMatchObject({ strategy: 'quick', assessment: 'unreviewed', nextAction: 'COMPLETED' });
    expect(fs.readFileSync(assignmentFiles.promptPath, 'utf-8')).toBe('frozen prompt');
    expect(loadGoalState(mafwDir, 'gq')).toMatchObject({
      revision: 2,
      strategy: undefined,
      assessment: undefined,
      quickRepairCount: undefined,
      currentAssignmentId: undefined,
    });
    expect(store.getGoalRevision('pod_1', 'gq', 1)).toMatchObject({
      status: 'completed',
      verdict: null,
    });

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
