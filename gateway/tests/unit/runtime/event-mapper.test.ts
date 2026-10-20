import {
  applyEventMappings, validateEventMappings, EventMappingEntry,
} from '../../../src/runtime/event-mapper';

const CANONICAL = new Set(['turn.completed', 'session.updated', 'message.updated', 'part.updated', 'permission.asked']);
const isCanonical = (t: string) => CANONICAL.has(t);

const PI: EventMappingEntry = {
  eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
  eventMappings: [
    { from: ['agent_end', 'agent_settled'], to: 'turn.completed' },
    { from: 'agent_start', to: 'session.updated' },
    { from: ['message_start', 'message_update'], to: 'part.updated',
      fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
    { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
    { from: 'turn_end', to: 'part.updated',
      fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
    { from: 'queue_update', to: 'drop' },
  ],
};

test('纯改名 + sessionID 注入（properties 级）', () => {
  expect(applyEventMappings({ type: 'agent_end', sessionID: 's1' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'turn.completed', properties: { sessionID: 's1' } }, sessionID: 's1', directory: undefined }]);
});

test('字段构造 + part 级 sessionID 注入 + path default（nullish）', () => {
  expect(applyEventMappings({ type: 'message_update', sessionID: 's1', delta: 'he' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'part.updated', properties: { part: { type: 'text', text: 'he', sessionID: 's1' } } }, sessionID: 's1', directory: undefined }]);
  // delta 缺席 → default ''
  const out = applyEventMappings({ type: 'message_update', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties.part.text).toBe('');
});

test('template ID 物化（turn_end → part.messageID）', () => {
  const out = applyEventMappings({ type: 'turn_end', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties.part).toEqual({
    type: 'step-finish', messageID: 'pi_step_s1', sessionID: 's1',
  });
});

test('when 条件不满足 → 跳过该行', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [
      { from: 'x', to: 'turn.completed', when: [{ path: '$.ok', equals: true }] },
      { from: 'x', to: 'session.updated' },
    ],
  };
  expect(applyEventMappings({ type: 'x', ok: false }, entry, isCanonical)[0].payload.type).toBe('session.updated');
});

test('drop 行计 suppressed；canonical 形状未注册 → 拦截（default-deny）；未知 → 拦截 + onUnmatched', () => {
  const suppressed: string[] = [];
  expect(applyEventMappings({ type: 'queue_update', sessionID: 's1' }, PI, isCanonical, { onSuppressed: (t) => suppressed.push(t) })).toEqual([]);
  expect(suppressed).toEqual(['queue_update']);
  // default-deny：canonical 形状但无注册翻译（PI 无 identity 行）→ 不再透传
  const unmatched: string[] = [];
  expect(applyEventMappings({ type: 'turn.completed', properties: { sessionID: 's1' } }, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(applyEventMappings({ type: 'mystery' }, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(unmatched).toEqual(['turn.completed', 'mystery']);
});

test('transformEvent 逃逸口：未匹配时调用；null=suppressed 丢弃，数组=扇出', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [],
    transformEvent: (raw: any) => raw.type === 'fan'
      ? [{ payload: { type: 'session.idle', properties: {} } }]
      : null,
  };
  const suppressed: string[] = [];
  expect(applyEventMappings({ type: 'other' }, entry, isCanonical, { onSuppressed: (t) => suppressed.push(t) })).toEqual([]);
  expect(suppressed).toEqual(['other']);
  expect(applyEventMappings({ type: 'fan' }, entry, isCanonical)).toHaveLength(1);
});

test('信封形态：canonical 类型放行（pi 已翻译流）；未知类型入口拦截；畸形透传给下游诊断', () => {
  const pushed = { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r1' } } };
  expect(applyEventMappings(pushed, PI, isCanonical)).toEqual([pushed]);
  const bad = { payload: { type: 'not.a.type', properties: {} } };
  const unmatched: string[] = [];
  expect(applyEventMappings(bad, PI, isCanonical, { onUnmatched: (t) => unmatched.push(t) })).toEqual([]);
  expect(unmatched).toEqual(['not.a.type']);
  const malformed = { foo: 1 };
  expect(applyEventMappings(malformed, PI, isCanonical)).toEqual([malformed]);
});

test('passProperties：整段拷贝 properties + fields 覆写（兄弟字段保留）', () => {
  const entry: EventMappingEntry = {
    eventSource: {
      typePath: '$.payload.type',
      sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'],
      directoryPath: '$.directory',
    },
    eventMappings: [
      { from: 'message.part.updated', to: 'message.part.updated',
        passProperties: '$.payload.properties',
        fields: { 'part.type': { const: 'step-finish' } } },
    ],
  };
  const out = applyEventMappings({
    directory: '/proj',
    payload: {
      type: 'message.part.updated',
      properties: { part: { type: 'text', text: 'hi', messageID: 'm1' }, keep: 1 },
    },
  }, entry, isCanonical);
  expect(out).toEqual([{
    payload: {
      type: 'message.part.updated',
      properties: { part: { type: 'step-finish', text: 'hi', messageID: 'm1' }, keep: 1 },
    },
    sessionID: undefined,
    directory: '/proj',
  }]);
});

test('sessionIdPath 数组多路径回退（取首个 truthy）', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.payload.type', sessionIdPath: ['$.payload.sessionID', '$.payload.properties.sessionID'] },
    eventMappings: [{ from: 'session.idle', to: 'turn.completed' }],
  };
  // sessionID 在 properties 里（第二路径命中）
  const out = applyEventMappings({ payload: { type: 'session.idle', properties: { sessionID: 's9' } } }, entry, isCanonical);
  expect((out[0] as any).sessionID).toBe('s9');
  expect((out[0] as any).payload.properties.sessionID).toBe('s9');
  // sessionID 在 payload 顶层（第一路径命中，优先）
  const out2 = applyEventMappings({ payload: { type: 'session.idle', sessionID: 'top', properties: {} } }, entry, isCanonical);
  expect((out2[0] as any).sessionID).toBe('top');
});

test('passProperties 路径不存在 → 空对象起步（不抛）', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [{ from: 'x', to: 'turn.completed', passProperties: '$.missing.deep' }],
  };
  const out = applyEventMappings({ type: 'x' }, entry, isCanonical);
  expect(out[0].payload.properties).toEqual({});
});

test('校验：passProperties 坏路径 + sessionIdPath 数组成员坏路径', () => {
  const issues = validateEventMappings({
    eventSource: { typePath: '$.type', sessionIdPath: ['$.ok', 'bad.path'] },
    eventMappings: [{ from: 'x', to: 'turn.completed', passProperties: 'no-dollar' }],
  }, CANONICAL);
  expect(issues.some((i) => i.includes("sessionIdPath: bad path 'bad.path'"))).toBe(true);
  expect(issues.some((i) => i.includes('passProperties') && i.includes('no-dollar'))).toBe(true);
});

test('message_end 精确形状（properties.sessionID + info 无 sessionID）', () => {
  const out = applyEventMappings({ type: 'message_end', sessionID: 's1' }, PI, isCanonical);
  expect((out[0] as any).payload.properties).toEqual({ sessionID: 's1', info: { role: 'assistant' } });
});

describe('validateEventMappings', () => {
  test('未知 canonical to → issue', () => {
    const issues = validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'not.a.type' }] }, CANONICAL);
    expect(issues.some((i) => i.includes('not.a.type'))).toBe(true);
  });
  test('drop 合法；非法路径 → issue；缺 eventSource.typePath → issue', () => {
    expect(validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'drop' }] }, CANONICAL)).toEqual([]);
    expect(validateEventMappings({ eventSource: { typePath: '$.type' },
      eventMappings: [{ from: 'a', to: 'turn.completed', fields: { 'x.y': { path: 'bad path' } } }] }, CANONICAL)).toHaveLength(1);
    expect(validateEventMappings({ eventMappings: [{ from: 'a', to: 'turn.completed' }] }, CANONICAL)).toHaveLength(1);
  });
});

describe('B2 transformEvent 守卫', () => {
  const entry = (fn: any): EventMappingEntry => ({ eventSource: { typePath: '$.type' }, eventMappings: [], transformEvent: fn });

  test('抛错 → drop + onTranslationError，不断流', () => {
    const errs: string[] = [];
    const out = applyEventMappings({ type: 'x' }, entry(() => { throw new Error('boom'); }), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) });
    expect(out).toEqual([]);
    expect(errs[0]).toContain('boom');
  });

  test('返回字符串（非法形状）→ drop + onTranslationError', () => {
    const errs: string[] = [];
    expect(applyEventMappings({ type: 'x' }, entry(() => 'garbage'), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) })).toEqual([]);
    expect(errs[0]).toContain('malformed');
  });

  test('数组含非对象成员 → drop + onTranslationError', () => {
    const errs: string[] = [];
    expect(applyEventMappings({ type: 'x' }, entry(() => [{ payload: { type: 'session.updated', properties: {} } }, 42]), isCanonical, { onTranslationError: (_r, reason) => errs.push(reason) })).toEqual([]);
    expect(errs).toHaveLength(1);
  });

  test('合法输出（裸事件/信封/数组）照常通过', () => {
    expect(applyEventMappings({ type: 'x' }, entry(() => ({ type: 'session.updated' })), isCanonical)).toHaveLength(1);
    expect(applyEventMappings({ type: 'x' }, entry(() => [{ payload: { type: 'session.updated', properties: {} } }]), isCanonical)).toHaveLength(1);
  });
});
