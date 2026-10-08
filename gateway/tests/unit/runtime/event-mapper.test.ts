import {
  applyEventMappings, validateEventMappings, EventMappingEntry,
} from '../../../src/runtime/event-mapper';

const CANONICAL = new Set(['session.idle', 'session.updated', 'message.updated', 'message.part.updated', 'permission.asked']);
const isCanonical = (t: string) => CANONICAL.has(t);

const PI: EventMappingEntry = {
  eventSource: { typePath: '$.type', sessionIdPath: '$.sessionID' },
  eventMappings: [
    { from: ['agent_end', 'agent_settled'], to: 'session.idle' },
    { from: 'agent_start', to: 'session.updated' },
    { from: ['message_start', 'message_update'], to: 'message.part.updated',
      fields: { 'part.type': { const: 'text' }, 'part.text': { path: '$.delta', default: '' } } },
    { from: 'message_end', to: 'message.updated', fields: { 'info.role': { const: 'assistant' } } },
    { from: 'turn_end', to: 'message.part.updated',
      fields: { 'part.type': { const: 'step-finish' }, 'part.messageID': { template: 'pi_step_{$.sessionID}' } } },
    { from: 'queue_update', to: 'drop' },
  ],
};

test('纯改名 + sessionID 注入（properties 级）', () => {
  expect(applyEventMappings({ type: 'agent_end', sessionID: 's1' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'session.idle', properties: { sessionID: 's1' } }, sessionID: 's1', directory: undefined }]);
});

test('字段构造 + part 级 sessionID 注入 + path default（nullish）', () => {
  expect(applyEventMappings({ type: 'message_update', sessionID: 's1', delta: 'he' }, PI, isCanonical))
    .toEqual([{ payload: { type: 'message.part.updated', properties: { part: { type: 'text', text: 'he', sessionID: 's1' } } }, sessionID: 's1', directory: undefined }]);
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
      { from: 'x', to: 'session.idle', when: [{ path: '$.ok', equals: true }] },
      { from: 'x', to: 'session.updated' },
    ],
  };
  expect(applyEventMappings({ type: 'x', ok: false }, entry, isCanonical)[0].payload.type).toBe('session.updated');
});

test('drop + 未命中 canonical passthrough + 未知丢弃并遥测', () => {
  expect(applyEventMappings({ type: 'queue_update', sessionID: 's1' }, PI, isCanonical)).toEqual([]);
  // canonical 原生直发 → passthrough
  const raw = { type: 'session.idle', properties: { sessionID: 's1' } };
  expect(applyEventMappings(raw, PI, isCanonical)).toEqual([raw]);
  // 未知 → drop + onUnknown
  const unknown: string[] = [];
  expect(applyEventMappings({ type: 'mystery' }, PI, isCanonical, (t) => unknown.push(t))).toEqual([]);
  expect(unknown).toEqual(['mystery']);
});

test('transformEvent 逃逸口：未匹配时调用；null=丢弃，数组=扇出', () => {
  const entry: EventMappingEntry = {
    eventSource: { typePath: '$.type' },
    eventMappings: [],
    transformEvent: (raw: any) => raw.type === 'fan'
      ? [{ payload: { type: 'session.idle', properties: {} } }]
      : null,
  };
  expect(applyEventMappings({ type: 'other' }, entry, isCanonical)).toEqual([]);
  expect(applyEventMappings({ type: 'fan' }, entry, isCanonical)).toHaveLength(1);
});

test('无 top-level type（已 canonical 信封）→ 原样 passthrough', () => {
  const pushed = { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r1' } } };
  expect(applyEventMappings(pushed, PI, isCanonical)).toEqual([pushed]);
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
      eventMappings: [{ from: 'a', to: 'session.idle', fields: { 'x.y': { path: 'bad path' } } }] }, CANONICAL)).toHaveLength(1);
    expect(validateEventMappings({ eventMappings: [{ from: 'a', to: 'session.idle' }] }, CANONICAL)).toHaveLength(1);
  });
});
