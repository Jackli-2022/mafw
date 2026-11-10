import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { PodStore, type PodMemberRole } from '../../src/core/pod/pod-store';
import { PodSessionSupervisor } from '../../src/core/pod/pod-session-supervisor';
import { PodTechLeadService, TECH_LEAD_AGENT } from '../../src/core/pod/pod-tech-lead-service';
import { LeadTopicStore } from '../../src/core/lead/lead-topic-store';
import { LeadHandoffService } from '../../src/core/lead/lead-handoff-service';
import { tmpGitRepo } from '../unit/worktree/tmp-git';
import type { MafwMessage } from '../../src/runtime/canonical-types';

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

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

describe('Lead current-topic handoff (integration)', () => {
  test('first Goal carries the topic; the second starts after the first handoff', async () => {
    const dir = tmpGitRepo('mafw-handoff-int-');
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

    let messages: MafwMessage[] = [
      msg('m1', 'user', '讨论上下文'),
      msg('m2', 'assistant', '好的'),
      { id: 'm3', role: 'user', content: [{ type: 'tool', tool: 'read' } as any] },
    ];
    let topicSeq = 0;
    let goalSeq = 0;
    const topics = new LeadTopicStore(db);
    const handoff = new LeadHandoffService({
      topics,
      listMessages: async () => ({ data: messages }),
      now: () => NOW,
      newId: () => `topic_${++topicSeq}`,
    });

    const runtime = {
      createSession: jest.fn(async () => 'ses_tech_lead'),
      promptAsync: jest.fn(async () => ({})),
      messages: jest.fn(async () => ({ data: [] })),
    };
    const supervisor = new PodSessionSupervisor({
      store,
      now: () => NOW,
      newId: () => 'podsess_1',
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
      newId: () => `pg_${++goalSeq}`,
      newGoalId: () => `goal-${++goalSeq}`,
      registerInternalSession: jest.fn(),
      emitGoalCreated: jest.fn(),
      notify: jest.fn(),
      leadHandoff: handoff,
    });

    const first = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: '首个话题',
      objective: 'O',
      createdBy: 'ses_lead',
    });
    const firstRequest = JSON.parse(fs.readFileSync(first.requestPath, 'utf8'));
    expect(firstRequest.sourceRef.topicId).toBe('topic_1');
    expect(firstRequest.sourceRef.snapshot).toContain('讨论上下文');
    expect(firstRequest.sourceRef.snapshot).not.toContain('tool');
    expect(fs.existsSync(path.join(first.goalDir!, 'context', 'lead-handoff.md'))).toBe(true);
    expect(first.sessionID).toBe('ses_tech_lead');
    expect(first.promptError).toBeUndefined();
    const firstPrompt = runtime.promptAsync.mock.calls[0][0].parts[0].text;
    expect(firstPrompt).toContain('<lead-handoff>');
    expect(firstPrompt).toContain('讨论上下文');
    expect(firstPrompt).toContain('lead-handoff.md');

    messages = [...messages, msg('m4', 'user', '第二个话题')];
    const second = await service.createGoal({
      podId: 'pod_1',
      projectDir: dir,
      title: '第二个话题',
      objective: 'O2',
      createdBy: 'ses_lead',
    });
    const secondRequest = JSON.parse(fs.readFileSync(second.requestPath, 'utf8'));
    expect(secondRequest.sourceRef.topicId).toBe('topic_2');
    expect(secondRequest.sourceRef.snapshot).toBe('User: 第二个话题');
    expect(secondRequest.sourceRef.snapshot).not.toContain('讨论上下文');

    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
