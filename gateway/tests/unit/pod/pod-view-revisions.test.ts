import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  buildPodAttention,
  buildPodGoalView,
  type PodGoalDescription,
} from '../../../src/core/pod/pod-view';
import { PodStore, type PodGoalRow } from '../../../src/core/pod/pod-store';
import { PodGoalService } from '../../../src/core/pod/pod-goal-service';

function row(patch: Partial<PodGoalRow> = {}): PodGoalRow {
  return {
    id: 'pg1',
    podId: 'pod_1',
    goalId: 'g1',
    status: 'active',
    verdict: null,
    activeRevision: 1,
    priority: 0,
    enqueuedAt: '2026-11-02T00:00:00.000Z',
    startedAt: '2026-11-02T00:01:00.000Z',
    endedAt: null,
    ...patch,
  };
}

function desc(patch: Partial<PodGoalDescription> = {}): PodGoalDescription {
  return {
    title: 'Fix Pod',
    phase: 'PLANNING',
    nextAction: 'RUNNING_plan',
    terminal: false,
    verdict: null,
    hasResultEvidence: false,
    planApproval: null,
    pendingQuestion: null,
    nodeSession: null,
    lastError: null,
    ...patch,
  };
}

describe('buildPodGoalView — revision aware', () => {
  test('exposes the revision the stage describes', () => {
    expect(buildPodGoalView(row({ activeRevision: 2 }), desc({ revision: 2 }), null))
      .toMatchObject({ revision: 2, activeRevision: 2 });
    // A legacy description without a revision snapshot still reports the stored pointer.
    expect(buildPodGoalView(row({ activeRevision: 3 }), desc(), null).revision).toBe(3);
  });

  test('projects the revision status into a role-bearing stage', () => {
    const view = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 2, revisionStatus: 'reviewing' }),
      null,
    );
    expect(view).toMatchObject({ revision: 2, stage: { owner: 'team', kind: 'reviewing', role: 'reviewer' } });
    expect(buildPodAttention([view])).toEqual([]);
  });

  test('a pre-execution revision without a state file discusses instead of reporting a broken state', () => {
    // Discussing/direction_review live before any GoalState file exists by design:
    // an absent state file there is the normal shape, not a corrupted Goal.
    const discussing = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 2, revisionStatus: 'discussing', stateMissing: true, phase: null, nextAction: '' }),
      null,
    );
    expect(discussing.stage).toMatchObject({ owner: 'team', kind: 'discussing', role: 'tech_lead' });
    expect(buildPodAttention([discussing])).toEqual([]);

    // A pending direction review stays the real human gate in that window.
    const pending = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({
        revision: 2,
        revisionStatus: 'direction_review',
        directionStatus: 'pending',
        stateMissing: true,
        phase: null,
        nextAction: '',
      }),
      null,
    );
    expect(pending.stage).toMatchObject({ owner: 'person', kind: 'direction_review', role: 'tech_lead' });

    // Once the decision is recorded the same revision continues as Tech Lead work.
    const decided = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({
        revision: 2,
        revisionStatus: 'direction_review',
        directionStatus: 'decided',
        stateMissing: true,
        phase: null,
        nextAction: '',
      }),
      null,
    );
    expect(decided.stage).toMatchObject({ owner: 'team', kind: 'planning', role: 'tech_lead' });
  });

  test('a missing state file stays a blocker for revisions that must have one', () => {
    for (const revisionStatus of ['planning', 'plan_review', 'implementing', 'reviewing'] as const) {
      const view = buildPodGoalView(
        row({ activeRevision: 2 }),
        desc({ revision: 2, revisionStatus, stateMissing: true, phase: null, nextAction: '' }),
        null,
      );
      expect(view.stage).toMatchObject({ owner: 'person', kind: 'blocked' });
    }
  });

  test('a stale description from an older revision never claims another revision stage', () => {
    const view = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 1, revisionStatus: 'completed' }),
      null,
    );
    expect(view.revision).toBe(2);
    expect(view.stage.kind).not.toBe('result_notified');
    // Falls back to the node/next-action projection instead of inventing a result.
    expect(view.stage).toMatchObject({ owner: 'team', kind: 'working' });
  });

  test('pending direction review is the only person attention the revision can add', () => {
    const pending = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 2, revisionStatus: 'direction_review', directionStatus: 'pending' }),
      null,
    );
    expect(pending.stage).toMatchObject({
      owner: 'person',
      kind: 'direction_review',
      role: 'tech_lead',
    });
    expect(buildPodAttention([pending])).toEqual([
      expect.objectContaining({ goalId: 'g1', kind: 'direction_review' }),
    ]);

    const decided = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 2, revisionStatus: 'direction_review', directionStatus: 'decided' }),
      null,
    );
    expect(decided.stage).toMatchObject({ owner: 'team', kind: 'planning', role: 'tech_lead' });
    expect(buildPodAttention([decided])).toEqual([]);
  });

  test('a running probe during planning is builder work, not a fake blocker', () => {
    const view = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({ revision: 2, revisionStatus: 'planning', probeRunning: true }),
      null,
    );
    expect(view.stage).toMatchObject({ owner: 'team', kind: 'probing', role: 'builder' });
    expect(buildPodAttention([view])).toEqual([]);
  });

  test('plan approval keeps its person attention and role even inside plan_review', () => {
    const view = buildPodGoalView(
      row({ activeRevision: 2 }),
      desc({
        revision: 2,
        revisionStatus: 'plan_review',
        planApproval: { id: 'a1', status: 'pending' },
      }),
      null,
    );
    expect(view.stage).toMatchObject({ owner: 'person', kind: 'plan_approval', role: 'tech_lead' });
    expect(buildPodAttention([view])[0].action).toEqual({ type: 'open_plan_review', goalId: 'g1' });
  });

  test('terminal rows stay ended with truthful result readiness', () => {
    const done = row({ status: 'done', activeRevision: 2, verdict: 'FAIL', endedAt: '2026-11-02T00:09:00.000Z' });
    expect(buildPodGoalView(
      done,
      desc({ revision: 2, revisionStatus: 'implementing', terminal: true, verdict: 'FAIL', hasResultEvidence: false }),
      null,
    )).toMatchObject({ revision: 2, resultReady: false, stage: { owner: 'system', kind: 'ended' } });
    expect(buildPodGoalView(
      done,
      desc({ revision: 2, terminal: true, verdict: 'FAIL', hasResultEvidence: true }),
      null,
    ).resultReady).toBe(true);
  });

  test('a queued goal keeps the queue reason and never projects a revision phase', () => {
    const view = buildPodGoalView(
      row({ status: 'queued', activeRevision: 2, startedAt: null }),
      desc({ revision: 2, revisionStatus: 'implementing' }),
      'active_goal',
    );
    expect(view.stage).toMatchObject({ owner: 'team', kind: 'queued', queueReason: 'active_goal' });
  });
});

describe('PodGoalService.views — revision wiring', () => {
  const now = '2026-11-02T00:00:00.000Z';

  function makeService(stateMissing = false) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-view-rev-'));
    const db = new Database(path.join(dir, 'test.db'));
    const store = new PodStore(db);
    const pod = store.ensurePod({ id: 'pod_1', projectDir: dir, name: 'Project', now });
    const row = store.enqueueGoal({ id: 'pg1', podId: pod.id, goalId: 'g1', now });
    store.setGoalStatus(row.id, 'active', { startedAt: now });
    store.createGoalRevision({ podId: pod.id, goalId: 'g1', revision: 1, status: 'discussing', now });
    const service = new PodGoalService({
      store,
      pods: { ensure: async () => ({ pod }) } as any,
      startGoal: async () => {},
      resolveProjectDir: () => dir,
      now: () => now,
      newId: () => 'id',
      notify: () => {},
      describeGoal: (goalId) => ({
        title: `Goal ${goalId}`,
        phase: 'PLANNING',
        nextAction: 'RUNNING_plan',
        terminal: false,
        verdict: null,
        hasResultEvidence: false,
        planApproval: null,
        pendingQuestion: null,
        nodeSession: null,
        lastError: null,
        ...(stateMissing ? { stateMissing: true } : {}),
      }),
    });
    return { dir, db, store, pod, service };
  }

  test('a fresh discussion Goal without a state file keeps the discussing stage', () => {
    const { dir, db, store, pod, service } = makeService(true);
    try {
      expect(service.views(pod.id)[0].stage).toMatchObject({
        owner: 'team',
        kind: 'discussing',
        role: 'tech_lead',
      });
      expect(service.attention(pod.id)).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('projects the persisted revision status and direction attention', () => {
    const { dir, db, store, pod, service } = makeService();
    try {
      expect(service.views(pod.id)[0]).toMatchObject({
        revision: 1,
        stage: { owner: 'team', kind: 'discussing', role: 'tech_lead' },
      });
      expect(service.attention(pod.id)).toEqual([]);

      store.setGoalRevisionStatus({
        podId: pod.id,
        goalId: 'g1',
        revision: 1,
        status: 'direction_review',
        directionStatus: 'pending',
        now,
      });
      expect(service.views(pod.id)[0].stage).toMatchObject({
        owner: 'person',
        kind: 'direction_review',
        role: 'tech_lead',
      });
      expect(service.attention(pod.id)).toEqual([
        expect.objectContaining({ goalId: 'g1', kind: 'direction_review', title: 'Goal g1' }),
      ]);

      store.setGoalRevisionStatus({
        podId: pod.id,
        goalId: 'g1',
        revision: 1,
        status: 'implementing',
        now,
      });
      expect(service.views(pod.id)[0].stage).toMatchObject({
        owner: 'team',
        kind: 'implementing',
        role: 'builder',
      });
      expect(service.attention(pod.id)).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('legacy goals without a revision row keep the next-action projection', () => {
    const { dir, db, store, pod, service } = makeService();
    try {
      store.setGoalStatus(store.getGoal(pod.id, 'g1')!.id, 'active', {});
      // Drop the revision row so only the legacy state projection remains.
      db.prepare('DELETE FROM pod_goal_revisions WHERE goal_id = ?').run('g1');
      expect(service.views(pod.id)[0].stage).toMatchObject({ owner: 'team', kind: 'working' });
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
