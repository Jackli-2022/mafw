import {
  TopicRevisionConflict,
  readTopicState,
  setTopicState,
} from '../../../src/recall/topic-state';

function fakeDb(currentTraceId?: string) {
  const rows = new Map<string, unknown>();
  return {
    rows,
    kvGet(scope: string, key: string) {
      return rows.get(`${scope}\0${key}`) ?? null;
    },
    kvSet(scope: string, key: string, value: unknown) {
      rows.set(`${scope}\0${key}`, value);
    },
    currentTurn(_sessionID: string) {
      return currentTraceId ? { trace_id: currentTraceId, turn_seq: 1 } : null;
    },
  };
}

describe('topic-state', () => {
  test('first set is revision 1 and same-session update is revision 2', () => {
    const db = fakeDb();
    const first = setTopicState(db, { sessionID: 's1', topic: '记忆设计' });
    const second = setTopicState(db, {
      sessionID: 's1',
      topic: '个人 Agent 记忆',
      entities: ['记忆', 'Agent'],
    });

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(readTopicState(db, 's1')).toMatchObject({
      sessionId: 's1',
      topic: '个人 Agent 记忆',
      entities: ['记忆', 'Agent'],
      revision: 2,
      active: true,
    });
  });

  test('sessions are isolated and a new session has no topic', () => {
    const db = fakeDb();
    setTopicState(db, { sessionID: 's1', topic: '主题 A' });
    setTopicState(db, { sessionID: 's2', topic: '主题 B' });

    expect(readTopicState(db, 's1')?.topic).toBe('主题 A');
    expect(readTopicState(db, 's2')?.topic).toBe('主题 B');
    expect(readTopicState(db, 'new')).toBeNull();
  });

  test('active:false keeps the row but reads as unset', () => {
    const db = fakeDb();
    setTopicState(db, { sessionID: 's1', topic: '旧主题' });
    setTopicState(db, { sessionID: 's1', active: false });

    expect(readTopicState(db, 's1')).toBeNull();
    expect(Array.from(db.rows.values())).toHaveLength(1);
    expect(Array.from(db.rows.values())[0]).toMatchObject({ active: false, revision: 2 });
  });

  test('stale expectedRevision throws TopicRevisionConflict', () => {
    const db = fakeDb();
    setTopicState(db, { sessionID: 's1', topic: '主题' });

    expect(() =>
      setTopicState(db, { sessionID: 's1', topic: '新主题', expectedRevision: 0 }),
    ).toThrow(TopicRevisionConflict);
  });

  test('gateway attaches the real current trace and ignores payload sourceTraceId', () => {
    const db = fakeDb('t1t_real');
    const state = setTopicState(db, {
      sessionID: 's1',
      topic: '主题',
      sourceTraceId: 't1t_forged',
    } as any);

    expect(state.sourceTraceId).toBe('t1t_real');
  });

  test('active set without topic on a fresh session is rejected', () => {
    const db = fakeDb();
    expect(() => setTopicState(db, { sessionID: 's1' })).toThrow(/topic/i);
  });
});
