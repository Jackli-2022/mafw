import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodError, PodStore, type PodMemberRole } from '../../../src/core/pod/pod-store';
import { PodSessionSupervisor } from '../../../src/core/pod/pod-session-supervisor';
import { PodWorktreeService } from '../../../src/core/pod/pod-worktree-service';
import { tmpGitRepo } from '../worktree/tmp-git';
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
  let leadHandoff: { prepareForGoal: jest.Mock; buildForkForGoal: jest.Mock; commit: jest.Mock; rollback: jest.Mock };
  let service: PodTechLeadService;
  let supervisor: PodSessionSupervisor;
  let currentRuntime: string;

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
    leadHandoff = {
      prepareForGoal: jest.fn(async () => null),
      buildForkForGoal: jest.fn(async () => null),
      commit: jest.fn(),
      rollback: jest.fn(),
    };
    currentRuntime = 'opencode';
    supervisor = new PodSessionSupervisor({
      store,
      now: () => LATER,
      newId: () => 'podsess_1',
      runtimeName: () => currentRuntime,
    });
    service = new PodTechLeadService({
      store,
      pods: { ensure: jest.fn(async () => detail) },
      sessions: supervisor,
      runtimeName: () => currentRuntime,
      runtime,
      resolveProject: () => ({ projectDir: dir, mafwDir }),
      now: () => LATER,
      newId: () => 'pg_1',
      newGoalId: () => 'goal-direct-1',
      registerInternalSession,
      emitGoalCreated,
      notify,
      leadHandoff,
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

  test('writes a durable failure handoff and includes it in the next Tech Lead manifest', async () => {
    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Pod loop',
      objective: '实现协作 loop',
      createdBy: 'ses_lead',
    });
    const file = path.join(mafwDir, 'goals', created.goalId, 'context', 'tech-lead-failure.md');

    await service.notifyFailure(created.goalId, { verdict: 'PASS' });
    expect(fs.existsSync(file)).toBe(false);

    await service.notifyFailure(created.goalId, {
      verdict: 'ERROR',
      lastError: 'artifact_invalid: bad payload',
      reviewFeedback: 'fix the review block',
    });
    expect(fs.existsSync(file)).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('verdict: ERROR');
    expect(text).toContain('artifact_invalid: bad payload');
    expect(text).toContain('fix the review block');

    await service.prompt(created.goalId, '开始复盘');
    const last = runtime.promptAsync.mock.calls.at(-1)![0];
    expect(last.parts[0].text).toContain('tech-lead-failure.md');
    expect(last.parts[0].text).toContain('Tech Lead failure handoff');
  });

  test('queues a second Lead goal when maxConcurrent is one', async () => {
    let goalSeq = 0;
    let rowSeq = 0;
    let sessionSeq = 0;
    const canAdmit = jest.fn()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const busySupervisor = new PodSessionSupervisor({
      store,
      now: () => LATER,
      newId: () => `podsess_${++sessionSeq}`,
      runtimeName: () => currentRuntime,
    });
    const busyService = new PodTechLeadService({
      store,
      pods: { ensure: jest.fn(async () => detail) },
      sessions: busySupervisor,
      runtimeName: () => currentRuntime,
      runtime,
      resolveProject: () => ({ projectDir: dir, mafwDir }),
      now: () => LATER,
      newId: () => `pg_${++rowSeq}`,
      newGoalId: () => `goal-${++goalSeq}`,
      registerInternalSession,
      emitGoalCreated,
      notify,
      leadHandoff,
      canAdmit,
    });

    const first = await busyService.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'First', objective: 'A', createdBy: 'ses_lead',
    });
    const second = await busyService.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Second', objective: 'B', createdBy: 'ses_lead',
    });

    expect(first.goalId).toBe('goal-1');
    expect(second.goalId).toBe('goal-2');
    expect(store.getGoal('pod_1', 'goal-1')?.status).toBe('active');
    expect(store.getGoal('pod_1', 'goal-2')?.status).toBe('queued');
    expect(store.getPod('pod_1')?.activeGoalId).toBe('goal-1');
  });

  test('seeds the Tech Lead with the current-topic handoff', async () => {
    leadHandoff.prepareForGoal.mockResolvedValue({
      sourceRef: {
        snapshot: 'USER: hi',
        topicId: 't1',
        messageRange: { from: 'm1', to: 'm2' },
        capturedAt: NOW,
      },
      handoffPath: path.join(mafwDir, 'goals', 'goal-direct-1', 'context', 'lead-handoff.md'),
      topicId: 't1',
      messageRange: { from: 'm1', to: 'm2' },
      fullText: 'USER: hi',
      projectDir: dir,
      goalId: 'goal-direct-1',
      leadSessionId: 'ses_lead',
      title: 'Pod loop',
      startMessageId: 'm1',
      endMessageId: 'm2',
      createdAt: NOW,
    });

    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Pod loop',
      objective: 'O',
      createdBy: 'ses_lead',
      handoff: 'current-topic',
    });

    expect(leadHandoff.prepareForGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: dir,
      leadSessionId: 'ses_lead',
      goalId: 'goal-direct-1',
      title: 'Pod loop',
    }));
    expect(leadHandoff.commit).toHaveBeenCalled();
    const prompt = runtime.promptAsync.mock.calls[0][0].parts[0].text;
    expect(prompt).toContain('<lead-handoff>');
    expect(prompt).toContain('USER: hi');
    expect(JSON.parse(fs.readFileSync(created.requestPath, 'utf8')).sourceRef).toMatchObject({
      topicId: 't1',
      messageRange: { from: 'm1', to: 'm2' },
    });
  });

  test('forks from a source topic instead of the current conversation', async () => {
    leadHandoff.buildForkForGoal.mockResolvedValue({
      sourceRef: {
        snapshot: '决定：A',
        topicId: 't_new',
        messageRange: { from: 'm1', to: 'm3' },
        capturedAt: NOW,
      },
      handoffPath: path.join(mafwDir, 'goals', 'goal-direct-1', 'context', 'lead-handoff.md'),
      topicId: 't_new',
      messageRange: { from: 'm1', to: 'm3' },
      fullText: '<forked-topic sourceTopicId="t1">决定：A</forked-topic>',
      messages: [],
      projectDir: dir,
      goalId: 'goal-direct-1',
      leadSessionId: 'ses_lead',
      title: 'Fork',
      startMessageId: 'm1',
      endMessageId: 'm3',
      createdAt: NOW,
      fork: { sourceTopicId: 't1', inheritedFrom: 'm1', inheritedTo: 'm3', mode: 'reference' },
    });

    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Fork',
      objective: 'O',
      createdBy: 'ses_lead',
      forkFromTopicId: 't1',
    });

    expect(leadHandoff.buildForkForGoal).toHaveBeenCalledWith(expect.objectContaining({
      projectDir: dir,
      goalId: 'goal-direct-1',
      sourceTopicId: 't1',
    }));
    expect(leadHandoff.prepareForGoal).not.toHaveBeenCalled();
    expect(leadHandoff.commit).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(created.requestPath, 'utf8')).sourceRef).toMatchObject({
      topicId: 't_new',
      messageRange: { from: 'm1', to: 'm3' },
    });
  });

  test('falls back to the P0 handoff when the fork cannot be built', async () => {
    leadHandoff.buildForkForGoal.mockRejectedValue(new Error('source topic missing'));
    leadHandoff.prepareForGoal.mockResolvedValue({
      sourceRef: {
        snapshot: 'USER: fallback',
        topicId: 't_p0',
        messageRange: { from: 'm1', to: 'm2' },
        capturedAt: NOW,
      },
      handoffPath: path.join(mafwDir, 'goals', 'goal-direct-1', 'context', 'lead-handoff.md'),
      topicId: 't_p0',
      messageRange: { from: 'm1', to: 'm2' },
      fullText: 'USER: fallback',
      messages: [],
      projectDir: dir,
      goalId: 'goal-direct-1',
      leadSessionId: 'ses_lead',
      title: 'Fallback',
      startMessageId: 'm1',
      endMessageId: 'm2',
      createdAt: NOW,
    });

    const created = await service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Fallback', objective: 'O',
      createdBy: 'ses_lead', forkFromTopicId: 't_missing',
    });

    expect(leadHandoff.prepareForGoal).toHaveBeenCalledWith(expect.objectContaining({
      leadSessionId: 'ses_lead',
    }));
    expect(leadHandoff.commit).toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(created.requestPath, 'utf8')).sourceRef).toMatchObject({
      topicId: 't_p0',
    });
  });

  test('setGoalMode persists quick', async () => {
    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Quick',
      objective: 'O',
      createdBy: 'ses_lead',
    });
    await service.setGoalMode(created.goalId, 'quick');
    expect(store.getGoalRevision('pod_1', created.goalId, 1)?.goalMode).toBe('quick');
  });

  test('setGoalMode rejects quick when plan review is manual', async () => {
    const manual = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Manual',
      objective: 'O',
      createdBy: 'ses_lead',
      planReview: 'manual',
    });
    await expect(service.setGoalMode(manual.goalId, 'quick')).rejects.toMatchObject({ status: 400 });
    expect(store.getGoalRevision('pod_1', manual.goalId, 1)?.goalMode).toBe('standard');
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

  test('Lead identity and creator checks are runtime-scoped', async () => {
    expect(service.isLeadSession('ses_lead')).toBe(true);
    currentRuntime = 'pi';
    expect(service.isLeadSession('ses_lead')).toBe(false);
    await expect(service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('a Tech Lead lease owned by another runtime is not the bound session', async () => {
    const created = await service.createGoal({
      podId: 'pod_1', projectDir: dir, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
    });

    // No ensure has run under the new runtime yet: the opencode lease is still
    // stored, but its id cannot be used as the pi Tech Lead session.
    currentRuntime = 'pi';
    expect(() => service.assertTechLeadSession(created.goalId, 'ses_tech_lead'))
      .toThrow(PodError);
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

  test('rejects an unsafe goal id before writing outside goals', async () => {
    await expect(service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      goalId: '../../escape',
      title: 'X',
      objective: 'O',
      createdBy: 'ses_lead',
    })).rejects.toMatchObject({ status: 400 });
    expect(fs.existsSync(path.join(dir, 'escape'))).toBe(false);
    expect(leadHandoff.prepareForGoal).not.toHaveBeenCalled();
  });

  test('does not overwrite an existing Goal handoff on duplicate create', async () => {
    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Dup',
      objective: 'O',
      createdBy: 'ses_lead',
    });
    const handoffFile = path.join(created.goalDir!, 'context', 'lead-handoff.md');
    fs.mkdirSync(path.dirname(handoffFile), { recursive: true });
    fs.writeFileSync(handoffFile, 'first');
    leadHandoff.prepareForGoal.mockClear();

    await expect(service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: 'Dup2',
      objective: 'O2',
      createdBy: 'ses_lead',
    })).rejects.toMatchObject({ status: 409 });

    expect(fs.readFileSync(handoffFile, 'utf8')).toBe('first');
    expect(leadHandoff.prepareForGoal).not.toHaveBeenCalled();
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

  test('rejects a non-git project before writing discussion files', async () => {
    const nonGit = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-nongit-'));
    try {
      const withWorktrees = new PodTechLeadService({
        store,
        pods: { ensure: jest.fn(async () => detail) },
        sessions: supervisor,
        runtimeName: () => currentRuntime,
        runtime,
        worktrees: new PodWorktreeService({ store, now: () => LATER }),
        resolveProject: () => ({ projectDir: nonGit, mafwDir: path.join(nonGit, '.mafw') }),
        now: () => LATER,
        newId: () => 'pg_nongit',
        newGoalId: () => 'goal-nongit',
        registerInternalSession,
        emitGoalCreated,
        notify,
      });

      await expect(withWorktrees.createGoal({
        podId: 'pod_1', projectDir: nonGit, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
      })).rejects.toMatchObject({ status: 409 });
      expect(store.listGoals('pod_1')).toEqual([]);
      expect(fs.existsSync(path.join(nonGit, '.mafw', 'goals', 'goal-nongit'))).toBe(false);
      expect(runtime.createSession).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(nonGit, { recursive: true, force: true });
    }
  });

  test('rejects a repository subdirectory before writing discussion files', async () => {
    const repo = tmpGitRepo('mafw-pod-subdir-');
    const sub = path.join(repo, 'pkg');
    fs.mkdirSync(sub);
    try {
      const withWorktrees = new PodTechLeadService({
        store,
        pods: { ensure: jest.fn(async () => detail) },
        sessions: supervisor,
        runtimeName: () => currentRuntime,
        runtime,
        worktrees: new PodWorktreeService({ store, now: () => LATER }),
        resolveProject: () => ({ projectDir: sub, mafwDir: path.join(sub, '.mafw') }),
        now: () => LATER,
        newId: () => 'pg_subdir',
        newGoalId: () => 'goal-subdir',
        registerInternalSession,
        emitGoalCreated,
        notify,
      });

      await expect(withWorktrees.createGoal({
        podId: 'pod_1', projectDir: sub, title: 'Loop', objective: 'x', createdBy: 'ses_lead',
      })).rejects.toMatchObject({ status: 409 });
      expect(store.listGoals('pod_1')).toEqual([]);
      expect(runtime.createSession).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
