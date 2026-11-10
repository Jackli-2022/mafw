import Database from 'better-sqlite3';
import type { MafwMessage } from '../../src/runtime/canonical-types';
import { LeadTopicStore } from '../../src/core/lead/lead-topic-store';
import { TopicMessageIndexStore } from '../../src/core/lead/topic-message-index';
import { LeadTopicResumeService } from '../../src/core/lead/lead-topic-resume-service';
import { compactTopic } from '../../src/core/lead/topic-summary';
import { recallTopics } from '../../src/core/lead/topic-recall';
import { selectWorkingSet } from '../../src/core/lead/working-set';
import { handleCompact, handleLeadContext } from '../../src/routes/lead-topics';

const NOW = '2026-11-10T00:00:00.000Z';

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

function seed() {
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  topics.insert({
    id: 't1', projectDir: '/p', leadSessionId: 'ses_old', title: 'SQLite 迁移',
    startMessageId: 'm1', endMessageId: 'm2', goalId: 'g1',
    ownerRole: 'tech-lead', ownerSessionId: null,
    createdAt: NOW, state: 'warm', summary: '决定：使用 SQLite',
    lastActiveAt: '2026-11-10T02:00:00.000Z', residentTokens: 20,
  });
  topics.insert({
    id: 't2', projectDir: '/p', leadSessionId: 'ses_old', title: 'UI polish',
    startMessageId: 'm3', endMessageId: 'm4', goalId: 'g2',
    ownerRole: 'tech-lead', ownerSessionId: null,
    createdAt: NOW, state: 'cold', summary: 'CSS 调整',
    lastActiveAt: '2026-11-09T00:00:00.000Z', residentTokens: 10,
  });
  const index = new TopicMessageIndexStore(db);
  index.replaceTopic('t1', [
    { topicId: 't1', messageId: 'm1', role: 'user', text: '继续 SQLite 迁移', tokenEstimate: 4, createdAt: NOW },
  ]);
  index.replaceTopic('t2', [
    { topicId: 't2', messageId: 'm3', role: 'user', text: 'UI 调整', tokenEstimate: 2, createdAt: NOW },
  ]);
  return { db, topics, index };
}

describe('Lead working set integration', () => {
  test('recall, working set, compact and resume share one topic store', async () => {
    const { topics, index } = seed();
    const inputs = topics.listByProject('/p').map((topic) => ({
      id: topic.id,
      title: topic.title,
      summary: topic.summary,
      index: index.listByTopic(topic.id),
    }));

    expect(recallTopics({ query: 'sqlite', topics: inputs }).map((c) => c.topicId)).toEqual(['t1']);
    expect(recallTopics({ query: '随便聊聊', topics: inputs })).toEqual([]);

    const ws = selectWorkingSet({
      topics: topics.listByProject('/p').map((topic) => ({
        id: topic.id,
        state: topic.state,
        summary: topic.summary,
        lastActiveAt: topic.lastActiveAt,
        goalId: topic.goalId,
        residentTokens: topic.residentTokens,
      })),
      budget: { warmTopicLimit: 5 },
    });
    expect(ws.warm).toEqual(expect.arrayContaining(['t1', 't2']));

    const broadcast = jest.fn();
    const compacted = await handleCompact({ topicId: 't1' }, {
      isLeadSession: () => true,
      projectDirForSession: () => '/p',
      topics,
      index,
      goals: () => [],
      workingSetEnabled: () => true,
      listMessages: async () => ({
        data: [
          msg('m1', 'user', '决定：使用 SQLite'),
          ...Array.from({ length: 12 }, (_, i) => msg(`f${i}`, 'assistant', 'work')),
          msg('m14', 'user', '继续'),
        ],
      }),
      broadcast,
      now: () => NOW,
    } as any);
    expect(compacted.status).toBe(200);
    expect(topics.get('t1')?.summary).toContain('决定：使用 SQLite');
    expect(topics.get('t1')?.state).toBe('warm');
    expect(index.listByTopic('t1').length).toBeGreaterThan(0);
    expect(broadcast).toHaveBeenCalledTimes(1);

    const promptAsync = jest.fn(async () => {});
    const resume = new LeadTopicResumeService({
      topics,
      index,
      sessions: {
        current: () => ({ sessionId: 'ses_old' }),
        isAlive: async () => false,
        ensure: async () => ({ sessionId: 'ses_new' }),
      },
      promptAsync,
      now: () => NOW,
      newId: () => 'topic_new',
    });
    const resumed = await resume.resume('t2');
    expect(resumed).toEqual({ sessionID: 'ses_new', resumedFrom: 't2' });
    expect(topics.get('t2')?.state).toBe('warm');
    expect(topics.listByProject('/p').some((topic) => topic.resumedFrom === 't2' && topic.state === 'resident')).toBe(true);
    expect(promptAsync.mock.calls[0][0].parts[0].text).toContain('<resumed-topic');
    expect(promptAsync.mock.calls[0][0].parts[0].text).toContain('CSS 调整');

    const context = handleLeadContext({ sessionID: 'ses_lead', query: 'sqlite' }, {
      isLeadSession: () => true,
      projectDirForSession: () => '/p',
      topics,
      index,
      goals: () => [],
      workingSetEnabled: () => true,
    } as any);
    expect(context.body.recalledTopicIds).toContain('t1');
  });

  test('the working-set kill switch empties context and blocks compaction', async () => {
    const { topics, index } = seed();
    const disabled = {
      isLeadSession: () => true,
      projectDirForSession: () => '/p',
      topics,
      index,
      goals: () => [],
      workingSetEnabled: () => false,
      listMessages: async () => ({ data: [] }),
      broadcast: jest.fn(),
    } as any;

    expect(handleLeadContext({ sessionID: 'ses_lead', query: 'sqlite' }, disabled).body)
      .toMatchObject({ blocks: [], totalTokens: 0 });
    expect((await handleCompact({ topicId: 't1' }, disabled)).status).toBe(503);
  });
});
