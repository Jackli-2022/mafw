import Database from 'better-sqlite3';
import { LeadTopicStore } from '../../../src/core/lead/lead-topic-store';
import { TopicBoundaryStore } from '../../../src/core/lead/topic-boundary-store';
import { LeadBoundaryService } from '../../../src/core/lead/lead-boundary-service';

const NOW = '2026-11-10T00:00:00.000Z';

function setup(mode: 'off' | 'observe' | 'on') {
  const db = new Database(':memory:');
  const topics = new LeadTopicStore(db);
  topics.insert({
    id: 't1', projectDir: '/p', leadSessionId: 's1', title: 'SQLite',
    startMessageId: 'm1', endMessageId: 'm3', goalId: 'g1',
    ownerRole: 'tech-lead', ownerSessionId: null, createdAt: NOW,
    summary: '决定：A', state: 'resident', lastActiveAt: NOW,
  });
  const boundaries = new TopicBoundaryStore(db);
  const broadcast = jest.fn();
  let seq = 0;
  const service = new LeadBoundaryService({
    boundaries,
    topics,
    mode: () => mode,
    broadcast,
    now: () => NOW,
    newId: () => `b${++seq}`,
  });
  return { topics, boundaries, broadcast, service };
}

const base = {
  projectDir: '/p',
  leadSessionId: 's1',
  fromTopicId: 't1',
  now: NOW,
  goalActive: false,
};

describe('LeadBoundaryService', () => {
  test('observe mode writes a proposal but does not notify', () => {
    const h = setup('observe');
    const proposal = h.service.observe({ ...base, text: '换个话题，聊 UI' });
    expect(proposal?.trigger).toBe('explicit');
    expect(h.boundaries.listByTopic('t1')).toHaveLength(1);
    expect(h.broadcast).not.toHaveBeenCalled();
  });

  test('on mode broadcasts one proposal; off writes nothing', () => {
    const on = setup('on');
    on.service.observe({ ...base, text: '换个话题，聊 UI' });
    expect(on.broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'topic.boundary.proposed' }));

    const off = setup('off');
    expect(off.service.observe({ ...base, text: '换个话题，聊 UI' })).toBeNull();
    expect(off.boundaries.listByTopic('t1')).toHaveLength(0);
  });

  test('active goals never produce a proposal', () => {
    const h = setup('on');
    expect(h.service.observe({ ...base, goalActive: true, text: '换个话题' })).toBeNull();
    expect(h.boundaries.listByTopic('t1')).toHaveLength(0);
  });

  test('accept creates one new topic and is idempotent', () => {
    const h = setup('observe');
    h.service.observe({ ...base, text: '换个话题，聊 UI' });
    const boundary = h.boundaries.listByTopic('t1')[0];

    const first = h.service.accept(boundary.id);
    expect(first).toMatchObject({ status: 'accepted' });
    expect(first.toTopicId).toBeTruthy();
    expect(h.topics.get(first.toTopicId!)?.title).toBe('SQLite');
    expect(h.topics.get(first.toTopicId!)?.state).toBe('resident');

    const second = h.service.accept(boundary.id);
    expect(second).toEqual(first);
    expect(h.topics.listByProject('/p')).toHaveLength(2);
  });

  test('merge/undo only change status and never delete', () => {
    const h = setup('observe');
    h.service.observe({ ...base, text: '换个话题' });
    const boundary = h.boundaries.listByTopic('t1')[0];

    expect(h.service.merge(boundary.id).status).toBe('merged');
    expect(h.boundaries.get(boundary.id)?.status).toBe('merged');
    expect(h.service.undo(boundary.id).status).toBe('undone');
    expect(h.service.undo(boundary.id).status).toBe('undone');
    expect(h.boundaries.get(boundary.id)?.status).toBe('undone');
    expect(h.boundaries.listByTopic('t1')).toHaveLength(1);
  });
});
