import Database from 'better-sqlite3';
import { LeadTopicStore } from '../../../src/core/lead/lead-topic-store';
import { TopicMessageIndexStore } from '../../../src/core/lead/topic-message-index';
import { LeadTopicResumeService } from '../../../src/core/lead/lead-topic-resume-service';

const NOW = '2026-11-10T00:00:00.000Z';

function setup(options: { alive: boolean; ownerSessionId?: string | null }) {
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  topics.insert({
    id: 't1', projectDir: '/p', leadSessionId: 'ses_old', title: 'SQLite 迁移',
    startMessageId: 'm1', endMessageId: 'm2', goalId: 'g1',
    ownerRole: 'tech-lead', ownerSessionId: options.ownerSessionId ?? 'ses_old',
    createdAt: NOW, state: 'resident', summary: '决定：使用 SQLite',
    lastActiveAt: '2026-11-09T22:00:00.000Z',
  });
  topics.insert({
    id: 't2', projectDir: '/p', leadSessionId: 'ses_old', title: 'Other',
    startMessageId: 'm3', endMessageId: 'm4', goalId: 'g2',
    ownerRole: 'tech-lead', ownerSessionId: 'ses_old',
    createdAt: NOW, state: 'resident',
    lastActiveAt: '2026-11-09T23:00:00.000Z',
  });
  const index = new TopicMessageIndexStore(db);
  index.replaceTopic('t1', [
    { topicId: 't1', messageId: 'm1', role: 'user', text: '继续 SQLite', tokenEstimate: 2, createdAt: NOW },
  ]);
  const promptAsync = jest.fn(async () => {});
  const ensure = jest.fn(async () => ({ sessionId: 'ses_new' }));
  const service = new LeadTopicResumeService({
    topics,
    index,
    sessions: {
      current: () => ({ sessionId: 'ses_old' }),
      isAlive: async () => options.alive,
      ensure,
    },
    promptAsync,
    now: () => NOW,
    newId: () => 't_new',
  });
  return { topics, index, promptAsync, ensure, service };
}

describe('LeadTopicResumeService', () => {
  test('alive session resumes in place and demotes other residents', async () => {
    const h = setup({ alive: true });
    const result = await h.service.resume('t1');

    expect(result).toEqual({ sessionID: 'ses_old', resumedFrom: null });
    expect(h.promptAsync).not.toHaveBeenCalled();
    expect(h.topics.get('t1')?.state).toBe('resident');
    expect(h.topics.get('t2')?.state).toBe('warm');
    expect(h.topics.latestForProject('/p')?.id).toBe('t1');
  });

  test('dead session rebuilds with provenance and leaves the old transcript alone', async () => {
    const h = setup({ alive: false });
    const result = await h.service.resume('t1');

    expect(result).toEqual({ sessionID: 'ses_new', resumedFrom: 't1' });
    expect(h.ensure).toHaveBeenCalledWith('/p');
    expect(h.promptAsync).toHaveBeenCalledWith(expect.objectContaining({
      sessionID: 'ses_new',
      parts: [expect.objectContaining({ text: expect.stringContaining('<resumed-topic') })],
    }));
    const prompt = h.promptAsync.mock.calls[0][0].parts[0].text as string;
    expect(prompt).toContain('决定：使用 SQLite');
    expect(prompt).toContain('继续 SQLite');
    expect(h.topics.get('t1')?.state).toBe('warm');
    expect(h.topics.get('t1')?.summary).toBe('决定：使用 SQLite');
    expect(h.topics.listByProject('/p').some((t) => t.resumedFrom === 't1' && t.state === 'resident')).toBe(true);
    expect(h.topics.get('t2')?.state).toBe('warm');
  });

  test('is idempotent for concurrent resumes of the same topic', async () => {
    const h = setup({ alive: false });
    const [a, b] = await Promise.all([h.service.resume('t1'), h.service.resume('t1')]);
    expect(a).toEqual(b);
    expect(h.promptAsync).toHaveBeenCalledTimes(1);
  });
});
