import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { LeadTopicStore } from '../../../src/core/lead/lead-topic-store';
import { TopicMessageIndexStore } from '../../../src/core/lead/topic-message-index';
import { TopicForkStore } from '../../../src/core/lead/topic-fork-store';
import { LeadHandoffService } from '../../../src/core/lead/lead-handoff-service';
import { LeadTopicSummaryService } from '../../../src/core/lead/lead-topic-summary-service';
import { summarizeTopic } from '../../../src/core/lead/topic-summary';

const NOW = '2026-11-10T00:00:00.000Z';

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fork-'));
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  topics.insert({
    id: 't1', projectDir: '/p', leadSessionId: 's1', title: 'SQLite',
    startMessageId: 'm1', endMessageId: 'm3', goalId: 'g1',
    ownerRole: 'tech-lead', ownerSessionId: null, createdAt: NOW,
    summary: '决定：A', state: 'warm', lastActiveAt: NOW,
  });
  const index = new TopicMessageIndexStore(db);
  index.replaceTopic('t1', [
    { topicId: 't1', messageId: 'm1', role: 'user', text: '决定：A', tokenEstimate: 3, createdAt: NOW },
  ]);
  const forks = new TopicForkStore(db);
  const summaryService = new LeadTopicSummaryService({
    topics,
    index,
    summarize: summarizeTopic,
    now: () => NOW,
  });
  const service = new LeadHandoffService({
    topics,
    index,
    forks,
    listMessages: async () => ({ data: [] }),
    now: () => NOW,
    newId: () => 't_new',
    onCommitted: (prepared) => summaryService.indexAndSummarize(prepared),
  });
  return { dir, topics, index, forks, service };
}

describe('LeadHandoffService fork', () => {
  test('writes a reference handoff and provenance without touching the source', async () => {
    const { dir, topics, forks, service } = setup();
    const before = JSON.stringify(topics.get('t1'));
    const goalDir = path.join(dir, 'goals', 'g2');

    const prepared = await service.buildForkForGoal({
      projectDir: '/p', goalId: 'g2', goalDir, title: 'Fork', sourceTopicId: 't1',
    });
    expect(prepared?.sourceRef.topicId).toBe('t_new');
    expect(prepared?.fullText).toContain('<forked-topic');
    expect(prepared?.fullText).not.toContain('Assistant');

    service.commit(prepared!);
    expect(topics.get('t_new')?.forkedFrom).toBe('t1');
    expect(topics.get('t_new')?.inheritedMessageRange).toEqual({ from: 'm1', to: 'm3' });
    expect(forks.getByGoal('g2')).toMatchObject({ sourceTopicId: 't1', inheritedFrom: 'm1', inheritedTo: 'm3' });
    expect(JSON.stringify(topics.get('t1'))).toBe(before);
    expect(fs.readFileSync(path.join(goalDir, 'context', 'lead-handoff.md'), 'utf8'))
      .toContain('<forked-topic');
  });

  test('indexes and summarizes the forked topic so detail and memory are not empty', async () => {
    const { dir, topics, index, service } = setup();
    const prepared = await service.buildForkForGoal({
      projectDir: '/p', goalId: 'g2', goalDir: path.join(dir, 'goals', 'g2'),
      title: 'Fork', sourceTopicId: 't1',
    });

    service.commit(prepared!);

    expect(index.listByTopic('t_new').map((row) => row.messageId)).toEqual(['m1']);
    expect(topics.get('t_new')?.summary).toBeTruthy();
    expect(topics.get('t_new')?.summaryHash).toBeTruthy();
  });

  test('uses the current Lead session and rejects another project source', async () => {
    const { dir, service } = setup();
    const prepared = await service.buildForkForGoal({
      projectDir: '/p', goalId: 'g2', goalDir: path.join(dir, 'goals', 'g2'),
      title: 'Fork', sourceTopicId: 't1', leadSessionId: 'ses_current',
    });
    expect(prepared?.sourceRef.sessionID).toBe('ses_current');
    expect(prepared?.leadSessionId).toBe('ses_current');

    expect(await service.buildForkForGoal({
      projectDir: '/other', goalId: 'g3', goalDir: path.join(dir, 'goals', 'g3'),
      title: 'Fork', sourceTopicId: 't1', leadSessionId: 'ses_current',
    })).toBeNull();
  });
});
