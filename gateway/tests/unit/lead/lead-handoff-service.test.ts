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

function makeService(messages: MafwMessage[], onCommitted?: (prepared: any) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handoff-'));
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  let seq = 0;
  const service = new LeadHandoffService({
    topics,
    listMessages: async () => ({ data: messages }),
    now: () => '2026-11-10T00:00:00.000Z',
    newId: () => `topic_${++seq}`,
    onCommitted,
  });
  return { dir, topics, service };
}

describe('LeadHandoffService', () => {
  test('prepares in memory, commits file and topic row', async () => {
    const { dir, topics, service } = makeService([
      msg('m1', 'user', 'hello'),
      msg('m2', 'assistant', 'world'),
    ]);
    const goalDir = path.join(dir, 'goals', 'g1');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g1', goalDir, title: 'T',
    });

    expect(prepared?.sourceRef.topicId).toBe('topic_1');
    expect(prepared?.sourceRef.snapshot).toContain('hello');
    expect(fs.existsSync(path.join(goalDir, 'context', 'lead-handoff.md'))).toBe(false);

    service.commit(prepared!);
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
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g2', goalDir, title: 'T2',
    });

    expect(prepared?.sourceRef.snapshot).toBe('User: after');
    expect(prepared?.sourceRef.messageRange).toEqual({ from: 'm2', to: 'm2' });
    service.commit(prepared!);
    expect(fs.readFileSync(path.join(goalDir, 'context', 'lead-handoff.md'), 'utf8'))
      .toBe('User: after');
  });

  test('returns null for an empty topic and writes nothing', async () => {
    const { dir, topics, service } = makeService([]);
    const goalDir = path.join(dir, 'goals', 'g3');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g3', goalDir, title: 'T3',
    });

    expect(prepared).toBeNull();
    expect(topics.latestForProject('/p')).toBeNull();
    expect(fs.existsSync(path.join(goalDir, 'context', 'lead-handoff.md'))).toBe(false);
  });

  test('selects an explicit topicId and returns null when it is unknown', async () => {
    const { dir, topics, service } = makeService([
      msg('m1', 'user', 'one'),
      msg('m2', 'user', 'two'),
      msg('m3', 'user', 'three'),
    ]);
    topics.insert({
      id: 't1', projectDir: '/p', leadSessionId: 's1', title: 't1',
      startMessageId: 'm0', endMessageId: 'm1', goalId: 'g0',
      ownerRole: 'tech-lead', ownerSessionId: null,
      createdAt: '2026-11-09T00:00:00.000Z',
    });
    topics.insert({
      id: 't2', projectDir: '/p', leadSessionId: 's1', title: 't2',
      startMessageId: 'm2', endMessageId: 'm2', goalId: 'g1',
      ownerRole: 'tech-lead', ownerSessionId: null,
      createdAt: '2026-11-09T01:00:00.000Z',
    });
    const goalDir = path.join(dir, 'goals', 'g4');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g4', goalDir, title: 'T4', topicId: 't1',
    });
    expect(prepared?.sourceRef.snapshot).toContain('two');
    expect(prepared?.sourceRef.snapshot).toContain('three');

    const missing = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g4', goalDir, title: 'T4', topicId: 'nope',
    });
    expect(missing).toBeNull();
  });

  test('untilMessageId caps the snapshot inclusively', async () => {
    const { dir, service } = makeService([
      msg('m1', 'user', 'one'),
      msg('m2', 'user', 'two'),
      msg('m3', 'user', 'three'),
    ]);
    const goalDir = path.join(dir, 'goals', 'g5');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g5', goalDir, title: 'T5',
      untilMessageId: 'm2',
    });

    expect(prepared?.sourceRef.snapshot).toBe('User: one\n\nUser: two');
    expect(prepared?.sourceRef.messageRange).toEqual({ from: 'm1', to: 'm2' });
  });

  test('rollback removes the topic row and the full text file', async () => {
    const { dir, topics, service } = makeService([msg('m1', 'user', 'hi')]);
    const goalDir = path.join(dir, 'goals', 'g6');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g6', goalDir, title: 'T6',
    });
    service.commit(prepared!);
    expect(topics.get(prepared!.topicId)).not.toBeNull();
    expect(fs.existsSync(prepared!.handoffPath)).toBe(true);

    service.rollback(prepared!.topicId, prepared!.handoffPath);
    expect(topics.get(prepared!.topicId)).toBeNull();
    expect(fs.existsSync(prepared!.handoffPath)).toBe(false);
  });

  test('commit exposes the scoped messages to the summary/index hook', async () => {
    const onCommitted = jest.fn();
    const { dir, service } = makeService([
      msg('m1', 'user', '决定：A'),
      msg('m2', 'assistant', '好的'),
      msg('m3', 'user', '待办：B'),
    ], onCommitted);
    const goalDir = path.join(dir, 'goals', 'g7');
    const prepared = await service.prepareForGoal({
      projectDir: '/p', leadSessionId: 's1', goalId: 'g7', goalDir, title: 'T7',
    });
    service.commit(prepared!);

    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({
      topicId: prepared!.topicId,
      messages: [
        expect.objectContaining({ id: 'm1' }),
        expect.objectContaining({ id: 'm2' }),
        expect.objectContaining({ id: 'm3' }),
      ],
    }));
  });
});
