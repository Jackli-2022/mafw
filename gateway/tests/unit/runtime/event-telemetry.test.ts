import {
  isKnownEventType,
  UnknownEventTracker,
} from '../../../src/runtime/event-telemetry';

describe('isKnownEventType', () => {
  it('accepts every matrix key', () => {
    // 矩阵 keys 全部已知（间接锁定已知集 ⊇ 矩阵）
    for (const t of ['session.idle', 'message.part.updated', 'project_registered', 'runtime_switched', 'session.next.tool.failed']) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('accepts prefix families (plugin namespace + legacy session.next.*)', () => {
    expect(isKnownEventType('plugin:myplug:done')).toBe(true);
    expect(isKnownEventType('session.next.tool.updated')).toBe(true);
    expect(isKnownEventType('session.next.followup.started')).toBe(true);
  });

  it('rejects unknown types', () => {
    expect(isKnownEventType('my_custom_event')).toBe(false);
    expect(isKnownEventType('session.future.thing')).toBe(false);
    expect(isKnownEventType(undefined)).toBe(true); // 无 type 不算未知（畸形另有判定）
    expect(isKnownEventType('')).toBe(true);
  });
});

describe('UnknownEventTracker', () => {
  it('counts per source+type and reports firstSeen once', () => {
    const t = new UnknownEventTracker();
    expect(t.record('my-runtime', 'weird.event')).toEqual({ firstSeen: true, total: 1 });
    expect(t.record('my-runtime', 'weird.event')).toEqual({ firstSeen: false, total: 2 });
    expect(t.record('other', 'weird.event')).toEqual({ firstSeen: true, total: 1 });
    expect(t.snapshot()).toEqual({
      'my-runtime': { 'weird.event': 2 },
      other: { 'weird.event': 1 },
    });
  });

  it('reset clears everything', () => {
    const t = new UnknownEventTracker();
    t.record('s', 'x');
    t.reset();
    expect(t.snapshot()).toEqual({});
  });

  it('caps tracked types per source (bounded memory)', () => {
    const t = new UnknownEventTracker();
    for (let i = 0; i < 150; i++) t.record('s', `t${i}`);
    expect(Object.keys(t.snapshot()['s']).length).toBeLessThanOrEqual(100);
  });
});
