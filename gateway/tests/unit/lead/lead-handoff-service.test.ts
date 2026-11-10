import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import type { MafwMessage } from '../../../src/runtime/canonical-types';
import { LeadTopicStore } from '../../../src/core/lead/lead-topic-store';
import { LeadHandoffService } from '../../../src/core/lead/lead-handoff-service';

const msg = (id: string, role: 'user' | 'assistant', text: string): MafwMessage => ({
  id,
  role,
  content: [{ type: 'text', text }],
});

function makeService(messages: MafwMessage[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  const service = new LeadHandoffService({
    topics,
    listMessages: async () => ({ data: messages }),
    now: () => '2026-11-10T00:00:00.000Z',
    newId: () => 'topic_1',
  });
  return { dir, topics, service };
}

describe('LeadHandoffService', () => {
  test('writes full handoff and topic row, returns sourceRef', async () => {
    const { dir, topics, service } = makeService([
      msg('m1', 'user', 'hello'),
      msg('m2', 'assistant', 'world'),
    ]);
    const goalDir = path.join(dir, 'goals', 'g1');
    const built = await service.buildForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g1', goalDir, title: 'T',
    });

    expect(built?.sourceRef.topicId).toBe('topic_1');
    expect(built?.sourceRef.snapshot).toContain('hello');
    expect(fs.readFileSync(path.join(goalDir, 'context', 'lead-handoff.md'), 'utf8'))
      .toContain('world');
    expect(topics.latestForProject('/p')?.goalId).toBe('g1');
  });

  test('starts after the previous topic end and keeps the full text', async () => {
    const { dir, topics, service } = makeService([
      msg('m1', 'user', 'before'),
      msg('m2', 'user', 'after'),
    ]);
    topics.insert({
      id: 'prev', projectDir: '/p', leadSessionId: 's1', title: 'prev',
      startMessageId: 'm0', endMessageId: 'm1', goalId: 'g0',
      ownerRole: 'tech-lead', ownerSessionId: null,
      createdAt: '2026-11-09T00:00:00.000Z',
    });

    const goalDir = path.join(dir, 'goals', 'g2');
    const built = await service.buildForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g2', goalDir, title: 'T2',
    });

    expect(built?.sourceRef.snapshot).toBe('User: after');
    expect(built?.sourceRef.messageRange).toEqual({ from: 'm2', to: 'm2' });
    expect(fs.readFileSync(path.join(goalDir, 'context', 'lead-handoff.md'), 'utf8'))
      .toBe('User: after');
  });

  test('returns null for an empty topic and writes nothing', async () => {
    const { dir, topics, service } = makeService([]);
    const goalDir = path.join(dir, 'goals', 'g3');
    const built = await service.buildForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g3', goalDir, title: 'T3',
    });

    expect(built).toBeNull();
    expect(topics.latestForProject('/p')).toBeNull();
    expect(fs.existsSync(path.join(goalDir, 'context', 'lead-handoff.md'))).toBe(false);
  });
});
