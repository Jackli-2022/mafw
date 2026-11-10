import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { PodStore, type PodMemberRole } from '../../src/core/pod/pod-store';
import { PodSessionSupervisor } from '../../src/core/pod/pod-session-supervisor';
import { PodTechLeadService, TECH_LEAD_AGENT } from '../../src/core/pod/pod-tech-lead-service';
import { createPodGoalDirectionTool } from '../../src/mcp/handlers/pod-goal-direction';
import { renderNodePrompt } from '../../src/core/goal/node-prompts';
import { validatePlanPackage } from '../../src/core/goal/plan-package';
import { tmpGitRepo } from '../unit/worktree/tmp-git';

const NOW = '2026-11-10T00:00:00.000Z';

function member(podId: string, id: string, role: PodMemberRole) {
  return {
    id,
    podId,
    role,
    displayName: role,
    agentName: role === 'tech_lead' ? TECH_LEAD_AGENT : role,
    modelProvider: null,
    modelId: null,
    status: 'available' as const,
    configJson: null,
  };
}

const goalEval = {
  outcome: 'done',
  conditions: [{ id: 'g1', statement: 'works', required: true, evidence: 'test', method: 'test' }],
  failureConditions: [],
  constraints: [],
  nonGoals: [],
  mapping: { g1: { tasks: ['w1-t1'], probes: [], artifacts: [] } },
};

describe('goal modes: quick / standard integration', () => {
  test('Tech Lead writes quick mode; prompt and validator enforce the quick shape', async () => {
    const dir = tmpGitRepo('mafw-goal-modes-');
    const mafwDir = path.join(dir, '.mafw');
    const db = new Database(path.join(dir, 'test.db'));
    const store = new PodStore(db);
    const pod = store.ensurePod({ id: 'pod_1', projectDir: dir, name: 'proj', now: NOW });
    for (const spec of [
      member(pod.id, 'm_lead', 'lead'),
      member(pod.id, 'm_tl', 'tech_lead'),
      member(pod.id, 'm_builder', 'builder'),
      member(pod.id, 'm_review', 'reviewer'),
    ]) {
      store.upsertMember({ ...spec, now: NOW });
    }
    store.insertSession({
      id: 's_lead', podId: pod.id, memberId: 'm_lead', goalId: null,
      node: 'coordination', sessionId: 'ses_lead', status: 'active',
      transcriptRef: null, now: NOW,
    });

    let idSeq = 0;
    const runtime = {
      createSession: jest.fn(async () => 'ses_tech_lead'),
      promptAsync: jest.fn(async () => ({})),
      messages: jest.fn(async () => ({ data: [] })),
    };
    const supervisor = new PodSessionSupervisor({
      store,
      now: () => NOW,
      newId: () => `podsess_${++idSeq}`,
      runtimeName: () => 'opencode',
    });
    const service = new PodTechLeadService({
      store,
      pods: { ensure: jest.fn(async () => ({
        pod,
        members: store.listMembers(pod.id),
        goals: [],
        tasks: [],
        sessions: store.listSessions(pod.id),
      })) },
      sessions: supervisor,
      runtimeName: () => 'opencode',
      runtime,
      resolveProject: () => ({ projectDir: dir, mafwDir }),
      now: () => NOW,
      newId: () => `pg_${++idSeq}`,
      newGoalId: () => `goal-${++idSeq}`,
      registerInternalSession: jest.fn(),
      emitGoalCreated: jest.fn(),
      notify: jest.fn(),
    });

    const created = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      goalId: 'goal-quick',
      title: 'Quick',
      objective: 'O',
      createdBy: 'ses_lead',
    });

    const direction = { decide: jest.fn(() => ({ decision: null })), request: jest.fn() };
    const setGoalMode = jest.fn((goalId: string, mode: any) => service.setGoalMode(goalId, mode));
    const startPlanning = jest.fn();
    const tool = createPodGoalDirectionTool({
      techLead: { assertTechLeadSession: () => ({ revision: 1, sessionID: 'ses_tech_lead' }) },
      direction: direction as any,
      setGoalMode,
      startPlanning,
    });
    await tool.execute(
      { goalId: created.goalId, mode: 'clear', userWords: 'ok', goalMode: 'quick' },
      { sessionID: 'ses_tech_lead' },
    );

    expect(setGoalMode).toHaveBeenCalledWith(created.goalId, 'quick');
    expect(store.getGoalRevision('pod_1', created.goalId, 1)?.goalMode).toBe('quick');
    const prompt = renderNodePrompt('plan', {
      goalId: created.goalId,
      projectDir: dir,
      mafwDir,
      round: 1,
      maxRounds: 3,
      charterPath: 'charter.md',
      requestPath: 'request.json',
      goalMode: 'quick',
    });
    expect(prompt).toContain('produce exactly one task');
    expect(prompt).toContain('request no probes');

    expect(() => validatePlanPackage({
      strategy: 'quick',
      waves: [{ id: 'w1', tasks: [{ title: 'a' }, { title: 'b' }] }],
    })).toThrow(/exactly one task/);
    expect(validatePlanPackage({
      strategy: 'quick',
      waves: [{ id: 'w1', tasks: [{ title: 'a' }] }],
    }).strategy).toBe('quick');

    const standard = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      goalId: 'goal-standard',
      title: 'Standard',
      objective: 'O2',
      createdBy: 'ses_lead',
    });
    await service.setGoalMode(standard.goalId, 'standard');
    expect(store.getGoalRevision('pod_1', standard.goalId, 1)?.goalMode).toBe('standard');
    expect(validatePlanPackage({
      strategy: 'collaborative',
      waves: [{ id: 'w1', tasks: [{ title: 'a' }, { title: 'b' }] }],
      goalEval,
    }).strategy).toBe('collaborative');

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('wiring: driver consumes goalMode and index wires mode + source endpoint', () => {
    const driver = fs.readFileSync(path.join(__dirname, '../../src/core/goal/driver.ts'), 'utf8');
    expect(driver).toContain('goalMode: this.deps.goalMode?.(goalId, revision)');
    const index = [
      // D3 Task 8: composition root (class MafwScheduler) = kernel.ts.
      fs.readFileSync(path.join(__dirname, '../../src/kernel.ts'), 'utf8'),
      fs.readFileSync(path.join(__dirname, '../../src/boot.ts'), 'utf8'),
    ].join('\n');
    expect(index).toContain('goalMode: (goalId, revision)');
    expect(index).toContain('lead-handoff.md');
    expect(index).toContain('fullText');
  });
});
