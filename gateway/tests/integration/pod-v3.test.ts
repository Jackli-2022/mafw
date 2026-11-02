import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../src/core/pod/pod-store';
import { PodGoalService } from '../../src/core/pod/pod-goal-service';
import { buildPodAttention, buildPodGoalView } from '../../src/core/pod/pod-view';
import type { PodGoalDescription } from '../../src/core/pod/pod-view';
import { createGoalIntake } from '../../src/core/goal/goal-intake';
import { ensureGoalState, loadGoalState } from '../../src/core/goal/state-v3';
import { nodeArtifactPaths } from '../../src/core/goal/node-prompts';
import { makeHarness } from '../unit/helpers/goal-driver-harness';

describe('Pod v3 integration', () => {
  test('goal -> manual plan -> pause -> approve -> resume -> real failure -> next goal', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-v3-'));
    const db = new Database(path.join(root, 'test.db'));
    const store = new PodStore(db);
    const now = '2026-11-02T00:00:00.000Z';
    const pod = store.ensurePod({ id: 'pod_1', projectDir: root, name: 'Project', now });
    const h = makeHarness();
    const notifications: string[] = [];

    const describeGoal = (goalId: string): PodGoalDescription | null => {
      const state = loadGoalState(h.mafwDir, goalId);
      if (!state) return null;
      let request: any = null;
      try {
        request = JSON.parse(fs.readFileSync(path.join(h.mafwDir, 'requests', `${goalId}.json`), 'utf-8'));
      } catch { /* ignore */ }
      return {
        title: request?.title ?? goalId,
        phase: state.phase,
        nextAction: state.nextAction,
        terminal: ['COMPLETED', 'FAILED', 'CANCELLED', 'ARCHIVED'].includes(state.nextAction),
        verdict: (state.reviewVerdict as any) ?? (state.nextAction === 'COMPLETED' ? 'PASS' : null),
        hasResultEvidence: !!(state.receiptPath || state.reviewReportPath),
        planApproval: state.planApproval ?? null,
        pendingQuestion: state.pendingQuestion
          ? { questionId: state.pendingQuestion.questionId, node: state.pendingQuestion.node, questions: state.pendingQuestion.questions }
          : null,
        nodeSession: state.nodeSession,
        lastError: state.lastError,
      };
    };

    const service = new PodGoalService({
      store,
      pods: {
        ensure: async () => ({
          pod,
          members: store.listMembers(pod.id),
          goals: store.listGoals(pod.id),
          tasks: store.listTasks(pod.id),
          sessions: store.listSessions(pod.id),
        }),
      } as any,
      startGoal: async (goalId) => {
        ensureGoalState(h.mafwDir, goalId, {
          projectDir: root,
          maxRounds: 3,
          planReview: 'manual',
        });
        h.driver.registerGoalDir(goalId, h.mafwDir);
        await h.driver.advance(goalId);
      },
      advanceGoal: async (goalId) => { await h.driver.advance(goalId); },
      resolveProjectDir: () => root,
      now: () => now,
      newId: (() => { let i = 0; return () => `pg_${++i}`; })(),
      notify: (podId) => notifications.push(podId),
      describeGoal,
    });
    h.deps.canCreateNode = () => store.getPod('pod_1')?.status !== 'paused';

    const intake = (goalId: string, title: string) => createGoalIntake({
      goalId,
      title,
      objective: `Objective for ${title}`,
      acceptance: [`${title} is verified`],
      authorization: { source: 'desktop', requestMode: 'explicit' },
    }, {
      resolveProject: () => ({ projectDir: root, mafwDir: h.mafwDir }),
      now: () => now,
      emitGoalCreated: () => {},
    });

    intake('g1', 'First');
    expect((await service.enqueueGoal('g1', root)).status).toBe('started');
    const firstSid = h.load('g1')!.nodeSession!.id;

    fs.writeFileSync(nodeArtifactPaths(h.mafwDir, 'g1', 1).waves, JSON.stringify({
      status: 'ready', taskType: 'feature',
      waves: [{ id: 'w1', title: 'w', tasks: ['a'], riskNote: 'r' }],
    }), 'utf-8');
    await h.fireIdle(firstSid);

    const firstView = () => service.views(pod.id).find((item) => item.goalId === 'g1')!;
    expect(firstView().title).toBe('First');
    expect(firstView().stage.kind).toBe('plan_approval');
    expect(buildPodAttention(service.views(pod.id))).toEqual([
      expect.objectContaining({ goalId: 'g1', kind: 'plan_approval', title: 'First' }),
    ]);

    await service.pause(pod.id);
    const approvalId = h.load('g1')!.planApproval!.id!;
    expect(await h.driver.approvePlan('g1', approvalId)).toBe(true);
    expect(h.load('g1')!.nextAction).toBe('NEXT_execute');
    expect(h.load('g1')!.nodeSession).toBeNull();

    expect(await service.resume(pod.id)).toBe(true);
    expect(h.load('g1')!.nodeSession?.phase).toBe('execute');

    // Terminal failure after the run: outcome is preserved verbatim.
    const receiptPath = nodeArtifactPaths(h.mafwDir, 'g1', 1).receipt;
    fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
    fs.writeFileSync(receiptPath, JSON.stringify({ goalId: 'g1', receipts: [] }), 'utf-8');
    h.write('g1', {
      nextAction: 'FAILED', phase: 'ARCHIVED', reviewVerdict: 'FAIL', receiptPath,
    });
    await service.onGoalArchived('g1', { verdict: 'MAX_RETRIES' });
    expect(store.getGoalByGoalId('g1')).toMatchObject({ status: 'done', verdict: 'MAX_RETRIES' });
    expect(buildPodGoalView(store.getGoalByGoalId('g1')!, describeGoal('g1'), undefined))
      .toMatchObject({ verdict: 'MAX_RETRIES', resultReady: true, stage: { kind: 'ended' } });

    intake('g2', 'Second');
    expect((await service.enqueueGoal('g2', root)).status).toBe('started');
    expect(store.getActiveGoal(pod.id)?.goalId).toBe('g2');

    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
});
