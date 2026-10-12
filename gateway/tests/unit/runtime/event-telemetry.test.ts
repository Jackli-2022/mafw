import {
  isKnownEventType,
  UnknownEventTracker,
} from '../../../src/runtime/event-telemetry';

describe('isKnownEventType', () => {
  it('accepts every matrix key', () => {
    // 矩阵 keys 全部已知（间接锁定已知集 ⊇ 矩阵）
    for (const t of ['turn.completed', 'part.updated', 'project_registered', 'runtime_switched', 'goal_node']) {
      expect(isKnownEventType(t)).toBe(true);
    }
  });

  it('accepts plugin: prefix family only (v2: session.next.* exemption removed — legacy family consumed by opencode transformEvent)', () => {
    expect(isKnownEventType('plugin:myplug:done')).toBe(true);
    // v2：session.next.* 不再豁免——家族成员若从翻译层漏网，会以 unknown 暴露
    // （漏网探测器语义，补 transformEvent drop 前缀即可覆盖）
    expect(isKnownEventType('session.next.tool.updated')).toBe(false);
    expect(isKnownEventType('session.next.followup.started')).toBe(false);
  });

  it('accepts runtime-native dropped types (deliberate disposal at the gateway, not unknown)', () => {
    expect(isKnownEventType('sync')).toBe(true);
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
