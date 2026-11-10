import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { LeadTopicStore } from '../../src/core/lead/lead-topic-store';
import { TopicMessageIndexStore } from '../../src/core/lead/topic-message-index';
import { TopicForkStore } from '../../src/core/lead/topic-fork-store';
import { LeadHandoffService } from '../../src/core/lead/lead-handoff-service';
import { TopicBoundaryStore } from '../../src/core/lead/topic-boundary-store';
import { LeadBoundaryService } from '../../src/core/lead/lead-boundary-service';
import { planPromotions } from '../../src/core/pod/pod-scheduler';
import { planFork } from '../../src/core/lead/topic-fork';

const NOW = '2026-11-10T00:00:00.000Z';

describe('lead scheduler integration', () => {
  test('slots, COW fork and boundaries share the topic store', async () => {
    const plan = planPromotions({
      active: [{ goalId: 'human', active: true, priority: 0, enqueuedAt: NOW, humanAttention: true }],
      queued: [
        { goalId: 'q1', active: false, priority: 0, enqueuedAt: NOW, humanAttention: false },
        { goalId: 'q2', active: false, priority: 0, enqueuedAt: NOW, humanAttention: false },
        { goalId: 'q3', active: false, priority: 0, enqueuedAt: NOW, humanAttention: false },
      ],
      maxConcurrent: 2,
    });
    expect(plan.capacity).toBe(3);
    expect(plan.start).toEqual(['q1', 'q2']);
    expect(plan.waiting).toEqual(['q3']);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p2-int-'));
    const db = new Database(':memory:');
    const topics = new LeadTopicStore(db);
    topics.insert({
      id: 't1', projectDir: '/p', leadSessionId: 's1', title: 'SQLite',
      startMessageId: 'm1', endMessageId: 'm3', goalId: 'g1',
      ownerRole: 'tech-lead', ownerSessionId: null, createdAt: NOW,
      summary: '决定：A', summaryHash: 'hash', state: 'warm', lastActiveAt: NOW,
    });
    const index = new TopicMessageIndexStore(db);
    index.replaceTopic('t1', [
      { topicId: 't1', messageId: 'm1', role: 'user', text: '决定：A', tokenEstimate: 3, createdAt: NOW },
    ]);
    const forks = new TopicForkStore(db);
    const handoff = new LeadHandoffService({
      topics, index, forks,
      listMessages: async () => ({ data: [] }),
      now: () => NOW,
      newId: () => 't_new',
    });

    const forkPlan = planFork({
      topic: topics.get('t1')!,
      messages: [{ id: 'm1', role: 'user', content: [{ type: 'text', text: '决定：A' }] } as any],
      summary: '决定：A',
    });
    expect(forkPlan.handoffText).toContain('<forked-topic');
    const prepared = await handoff.buildForkForGoal({
      projectDir: '/p', goalId: 'g2', goalDir: path.join(dir, 'goals', 'g2'), title: 'Fork', sourceTopicId: 't1',
    });
    handoff.commit(prepared!);
    expect(forks.getByGoal('g2')?.sourceTopicId).toBe('t1');
    expect(topics.get('t1')?.summary).toBe('决定：A');

    const boundaries = new TopicBoundaryStore(db);
    let seq = 0;
    const boundary = new LeadBoundaryService({
      boundaries,
      topics,
      mode: () => 'on',
      broadcast: jest.fn(),
      now: () => NOW,
      newId: () => `b${++seq}`,
    });
    const proposal = boundary.observe({
      projectDir: '/p', leadSessionId: 's1', fromTopicId: 't1',
      text: '换个话题，聊 UI', now: NOW, goalActive: false,
    });
    expect(proposal?.trigger).toBe('explicit');
    const row = boundaries.listByTopic('t1')[0];
    expect(boundary.merge('t1', row.id).status).toBe('merged');
    expect(boundary.undo('t1', row.id).status).toBe('undone');
    expect(boundaries.listByTopic('t1')).toHaveLength(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
