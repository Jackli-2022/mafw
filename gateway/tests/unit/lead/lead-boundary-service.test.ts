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

  test('dedupes the same trigger within the window', () => {
    const h = setup('observe');
    expect(h.service.observe({ ...base, text: '换个话题，聊 UI' })).not.toBeNull();
    expect(h.service.observe({ ...base, text: '换个话题，聊 DB' })).toBeNull();
    expect(h.boundaries.listByTopic('t1')).toHaveLength(1);
  });

  test('idle and goal-closed signals reach the service', () => {
    const idle = setup('observe');
    expect(idle.service.observe({
      ...base,
      text: '继续',
      lastActiveAt: '2026-11-09T23:00:00.000Z',
    })?.trigger).toBe('idle');

    const closed = setup('observe');
    expect(closed.service.observe({
      ...base,
      text: '好了',
      goalJustClosed: true,
    })?.trigger).toBe('goal_closed');
  });

  test('accept splits off a new topic instead of copying the source', () => {
    const h = setup('observe');
    h.service.observe({ ...base, text: '换个话题，聊 UI 细节' });
    const boundary = h.boundaries.listByTopic('t1')[0];

    const first = h.service.accept('t1', boundary.id);
    expect(first).toMatchObject({ status: 'accepted' });
    expect(first.toTopicId).toBeTruthy();
    expect(first.toTopicId).not.toBe('t1');

    const created = h.topics.get(first.toTopicId!)!;
    expect(created).toMatchObject({
      goalId: '',
      summary: null,
      resumedFrom: null,
      state: 'resident',
    });
    expect(created.title).toContain('聊 UI 细节');
    expect(created.startMessageId).not.toBe('m1');

    const source = h.topics.get('t1')!;
    expect(source.state).toBe('cold');
    expect(source.startMessageId).toBe('m1');
    expect(source.endMessageId).toBe('m3');
    expect(source.summary).toBe('决定：A');

    const second = h.service.accept('t1', boundary.id);
    expect(second).toEqual(first);
    expect(h.topics.listByProject('/p')).toHaveLength(2);
    expect(() => h.service.merge('t1', boundary.id)).toThrow();
    expect(() => h.service.undo('t1', boundary.id)).toThrow();
  });

  test('accept/merge/undo reject a boundary from another topic', () => {
    const h = setup('observe');
    h.service.observe({ ...base, text: '换个话题' });
    const boundary = h.boundaries.listByTopic('t1')[0];

    expect(() => h.service.accept('t2', boundary.id)).toThrow();
    expect(() => h.service.merge('t2', boundary.id)).toThrow();
    expect(() => h.service.undo('t2', boundary.id)).toThrow();
  });

  test('merge/undo only change status and never delete', () => {
    const h = setup('observe');
    h.service.observe({ ...base, text: '换个话题' });
    const boundary = h.boundaries.listByTopic('t1')[0];

    expect(h.service.merge('t1', boundary.id).status).toBe('merged');
    expect(h.boundaries.get(boundary.id)?.status).toBe('merged');
    expect(h.service.undo('t1', boundary.id).status).toBe('undone');
    expect(h.service.undo('t1', boundary.id).status).toBe('undone');
    expect(h.boundaries.get(boundary.id)?.status).toBe('undone');
    expect(h.boundaries.listByTopic('t1')).toHaveLength(1);
  });
});
