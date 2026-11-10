import Database from 'better-sqlite3';
import type { MafwMessage } from '../../../src/runtime/canonical-types';
import { LeadTopicStore } from '../../../src/core/lead/lead-topic-store';
import { TopicMessageIndexStore } from '../../../src/core/lead/topic-message-index';
import { LeadTopicSummaryService } from '../../../src/core/lead/lead-topic-summary-service';
import { summarizeTopic } from '../../../src/core/lead/topic-summary';

const NOW = '2026-11-10T00:00:00.000Z';

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

function setup() {
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  topics.insert({
    id: 't1', projectDir: '/p', leadSessionId: 's1', title: 'T',
    startMessageId: 'm1', endMessageId: 'm1', goalId: 'g1',
    ownerRole: 'tech-lead', ownerSessionId: null, createdAt: NOW,
  });
  const index = new TopicMessageIndexStore(db);
  const service = new LeadTopicSummaryService({
    topics, index, summarize: summarizeTopic, now: () => NOW,
  });
  return { topics, index, service };
}

describe('LeadTopicSummaryService', () => {
  test('writes summary and index in one pass', () => {
    const { topics, index, service } = setup();
    service.indexAndSummarize({
      topicId: 't1',
      messages: [msg('m1', 'user', '决定：A'), msg('m2', 'assistant', '好的')],
      createdAt: NOW,
    });

    expect(topics.get('t1')?.summary).toContain('决定：A');
    expect(topics.get('t1')?.summaryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(topics.get('t1')?.residentTokens).toBeGreaterThan(0);
    expect(index.listByTopic('t1').map((row) => row.messageId)).toEqual(['m2', 'm1']);
  });

  test('never throws when a store write fails', () => {
    const { service } = setup();
    const failing = new LeadTopicSummaryService({
      topics: {
        updateSummary: () => { throw new Error('db locked'); },
      } as any,
      index: { replaceTopic: () => { throw new Error('db locked'); } } as any,
      summarize: summarizeTopic,
      now: () => NOW,
      log: () => {},
    });

    expect(() => failing.indexAndSummarize({
      topicId: 't1', messages: [msg('m1', 'user', 'x')], createdAt: NOW,
    })).not.toThrow();
    expect(() => service.indexAndSummarize({
      topicId: 't1', messages: [msg('m1', 'user', 'x')], createdAt: NOW,
    })).not.toThrow();
  });
});
