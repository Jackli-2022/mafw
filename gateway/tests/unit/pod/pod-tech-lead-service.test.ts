import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore, type PodMemberRole } from '../../../src/core/pod/pod-store';
import { PodSessionSupervisor } from '../../../src/core/pod/pod-session-supervisor';
import type { PodDetail } from '../../../src/core/pod/pod-service';
import {
  PodTechLeadService,
  TECH_LEAD_AGENT,
} from '../../../src/core/pod/pod-tech-lead-service';

const NOW = '2026-11-03T00:00:00.000Z';
const LATER = '2026-11-03T00:10:00.000Z';

function member(id: string, role: PodMemberRole) {
  return {
    id,
    podId: 'pod_1',
    role,
    displayName: role,
    agentName: role === 'tech_lead' ? TECH_LEAD_AGENT : role,
    modelProvider: null,
    modelId: null,
    status: 'available' as const,
    configJson: null,
  };
}

describe('PodTechLeadService', () => {
  let dir: string;
  let mafwDir: string;
  let db: Database.Database;
  let store: PodStore;
  let detail: PodDetail;
  let runtime: {
    createSession: jest.Mock;
    promptAsync: jest.Mock;
    messages: jest.Mock;
  };
  let registerInternalSession: jest.Mock;
  let emitGoalCreated: jest.Mock;
  let notify: jest.Mock;
  let service: PodTechLeadService;
  let supervisor: PodSessionSupervisor;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-tech-lead-'));
    mafwDir = path.join(dir, '.mafw');
    db = new Database(path.join(dir, 'test.db'));
    store = new PodStore(db);
    const pod = store.ensurePod({ id: 'pod_1', projectDir: dir, name: 'proj', now: NOW });
    for (const spec of [
      member('m_lead', 'lead'),
      member('m_tl', 'tech_lead'),
      member('m_builder', 'builder'),
      member('m_review', 'reviewer'),
    ]) {
      store.upsertMember({ ...spec, now: NOW });
    }
    store.insertSession({
      id: 's_lead',
      podId: pod.id,
      memberId: 'm_lead',
      goalId: null,
      node: 'coordination',
      sessionId: 'ses_lead',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });
    store.insertSession({
      id: 's_builder',
      podId: pod.id,
      memberId: 'm_builder',
      goalId: null,
      node: 'implementation',
      sessionId: 'ses_builder',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });
    detail = {
      pod,
      members: store.listMembers(pod.id),
      goals: [],
      tasks: [],
      sessions: store.listSessions(pod.id),
    };

    runtime = {
      createSession: jest.fn(async () => 'ses_tech_lead'),
      promptAsync: jest.fn(async () => ({})),
      messages: jest.fn(async () => ({ data: [{ id: 'msg_1' }], nextCursor: 'c1' })),
    };
    registerInternalSession = jest.fn();
    emitGoalCreated = jest.fn();
    notify = jest.fn();
    supervisor = new PodSessionSupervisor({
      store,
      now: () => LATER,
      newId: () => 'podsess_1',
    });
    service = new PodTechLeadService({
      store,
      pods: { ensure: jest.fn(async () => detail) },
      sessions: supervisor,
      runtime,
      resolveProject: () => ({ projectDir: dir, mafwDir }),
      now: () => LATER,
      newId: () => 'pg_1',
      newGoalId: () => 'goal-direct-1',
      registerInternalSession,
      emitGoalCreated,
      notify,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('creates a discussing goal, hidden Tech Lead session, and the first manifest prompt', async () => {
    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Pod loop',
      objective: '实现协作 loop',
      createdBy: 'ses_lead',
    });

    expect(created).toMatchObject({
      podId: 'pod_1',
      goalId: 'goal-direct-1',
      revision: 1,
      stage: 'discussing',
      status: 'discussing',
      sessionID: 'ses_tech_lead',
    });
    expect(created.requestPath).toBe(path.join(mafwDir, 'goals', 'goal-direct-1', 'request.json'));
    expect(JSON.parse(fs.readFileSync(created.requestPath, 'utf-8'))).toMatchObject({
      layout: 'goal-dir',
      discussion: true,
      authorization: { source: 'lead' },
    });

    expect(store.getGoal('pod_1', 'goal-direct-1')).toMatchObject({ status: 'active', activeRevision: 1 });
    expect(store.getPod('pod_1')).toMatchObject({ status: 'active', activeGoalId: 'goal-direct-1' });
    expect(store.getGoalRevision('pod_1', 'goal-direct-1', 1)).toMatchObject({ status: 'discussing' });
    expect(runtime.createSession).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: dir,
      goalId: 'goal-direct-1',
      revision: 1,
    }));
    expect(registerInternalSession).toHaveBeenCalledWith('ses_tech_lead', 'tech_lead', TECH_LEAD_AGENT);
    expect(runtime.promptAsync).toHaveBeenCalledTimes(1);
    expect(runtime.promptAsync.mock.calls[0][0]).toMatchObject({
      sessionID: 'ses_tech_lead',
      agent: TECH_LEAD_AGENT,
    });
    expect(runtime.promptAsync.mock.calls[0][0].parts[0].text).toContain('[CONTEXT MANIFEST]');
    expect(runtime.promptAsync.mock.calls[0][0].parts[0].text).toContain('实现协作 loop');
    // The listener must never see a goal_created event for a discussing revision.
    expect(emitGoalCreated).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('pod_1', 'goal');

    await service.prompt(created.goalId, '先调研现有 Pod');
    expect(runtime.promptAsync).toHaveBeenCalledTimes(2);
    const second = runtime.promptAsync.mock.calls[1][0];
    expect(second.sessionID).toBe('ses_tech_lead');
    expect(second.parts[0].text).toContain('[CONTEXT MANIFEST]');
    expect(second.parts[0].text).toContain('先调研现有 Pod');
  });

  test('ensureSession reuses the scoped discussion session and history reads it', async () => {
    const created = await service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    });

    await expect(service.ensureSession(created.goalId)).resolves.toBe('ses_tech_lead');
    await expect(service.ensureSession(created.goalId)).resolves.toBe('ses_tech_lead');
    expect(runtime.createSession).toHaveBeenCalledTimes(1);

    const history = await service.history(created.goalId, 20);
    expect(history).toMatchObject({
      goalId: created.goalId,
      revision: 1,
      sessionID: 'ses_tech_lead',
      messages: [{ id: 'msg_1' }],
      nextCursor: 'c1',
    });
    expect(runtime.messages).toHaveBeenCalledWith({ sessionID: 'ses_tech_lead', limit: 20 });
  });

  test('only the bound Tech Lead session may act on the Goal', async () => {
    const created = await service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    });

    expect(service.assertTechLeadSession(created.goalId, 'ses_tech_lead')).toMatchObject({ revision: 1 });
    for (const sessionID of ['ses_lead', 'ses_builder', 'ses_other', '']) {
      expect(() => service.assertTechLeadSession(created.goalId, sessionID))
        .toThrow(PodError);
    }
    expect(service.isLeadSession('ses_lead')).toBe(true);
    expect(service.isLeadSession('ses_builder')).toBe(false);
  });

  test('rejects a non-Lead creator and a pod mismatch before writing any goal', async () => {
    await expect(service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_builder',
    })).rejects.toMatchObject({ status: 403 });
    await expect(service.createGoal({
      podId: 'pod_other', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    })).rejects.toMatchObject({ status: 400 });

    // A Lead of another Pod cannot create a goal in this Pod.
    store.ensurePod({ id: 'pod_2', projectDir: path.join(dir, 'other'), name: 'other', now: NOW });
    store.upsertMember({ ...member('m_lead_2', 'lead'), podId: 'pod_2', now: NOW });
    store.insertSession({
      id: 's_lead_2',
      podId: 'pod_2',
      memberId: 'm_lead_2',
      goalId: null,
      node: 'coordination',
      sessionId: 'ses_lead_2',
      status: 'active',
      transcriptRef: null,
      now: NOW,
    });
    await expect(service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead_2',
    })).rejects.toMatchObject({ status: 403 });

    expect(store.listGoals('pod_1')).toHaveLength(0);
    expect(emitGoalCreated).not.toHaveBeenCalled();
  });

  test('refuses to mint discussion files for an advanced Goal id', async () => {
    store.enqueueGoal({ id: 'pg_adv', podId: 'pod_1', goalId: 'goal-adv', now: NOW });
    store.createGoalRevision({
      podId: 'pod_1', goalId: 'goal-adv', revision: 1, status: 'completed', now: NOW,
    });

    await expect(service.createGoal({
      podId: 'pod_1', projectDir: dir, goalId: 'goal-adv', title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    })).rejects.toMatchObject({ status: 409 });
    expect(fs.existsSync(path.join(mafwDir, 'goals', 'goal-adv'))).toBe(false);
  });

  test('a runtime failure keeps the goal discussing and reports the session error', async () => {
    runtime.createSession.mockRejectedValueOnce(new Error('serve unavailable'));

    const created = await service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    });

    expect(created.sessionID).toBeNull();
    expect(created.sessionError).toContain('serve unavailable');
    expect(store.getGoalRevision('pod_1', created.goalId, 1)).toMatchObject({ status: 'discussing' });
    expect(runtime.promptAsync).not.toHaveBeenCalled();

    // A later ensure retries and succeeds with the same created Goal.
    await expect(service.ensureSession(created.goalId)).resolves.toBe('ses_tech_lead');
  });
});
