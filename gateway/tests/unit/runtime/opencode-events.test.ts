import { applyEventMappings } from '../../../src/runtime/event-mapper';
import { OPENCODE_EVENT_SOURCE, OPENCODE_EVENT_MAPPINGS, opencodeTransformEvent } from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
  transformEvent: opencodeTransformEvent,
};
const isCanonical = (t: string) => !!EVENT_FLOW_MATRIX[t];

const raw = (type: string, properties: Record<string, any> = {}, extra: Record<string, any> = {}) =>
  ({ directory: '/p', payload: { type, properties }, ...extra });

describe('OPENCODE_EVENT_MAPPINGS（opencode → MAFW 词汇 v2）', () => {
  it.each([
    ['session.idle', 'turn.completed'],
    ['session.error', 'turn.failed'],
    ['message.error', 'turn.failed'],
    ['message.aborted', 'turn.aborted'],
    ['message.part.updated', 'part.updated'],
    ['message.part.delta', 'part.delta'],
    ['message.part.complete', 'part.complete'],
    ['todo.updated', 'plan.updated'],
  ])('%s → %s（passProperties 保富载荷）', (from, to) => {
    const out = applyEventMappings(
      raw(from, { sessionID: 's1', part: { type: 'text', text: 'hi', messageID: 'm1' }, keep: { deep: 1 } }),
      ENTRY,
      isCanonical,
    );
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe(to);
    // 富载荷整段透传（兄弟字段保留）
    expect(out[0].payload.properties.part.text).toBe('hi');
    expect(out[0].payload.properties.keep).toEqual({ deep: 1 });
    // 信封 sessionID 多路径注入 + directory 重注入
    expect(out[0].sessionID).toBe('s1');
    expect(out[0].directory).toBe('/p');
  });

  it('同名收编词经 canonical passthrough 机制通过（不进差异行）', () => {
    for (const t of ['session.created', 'message.updated', 'permission.asked', 'question.asked', 'session.diff']) {
      const evt = raw(t, { sessionID: 's1' });
      expect(applyEventMappings(evt, ENTRY, isCanonical)).toEqual([evt]);
    }
  });

  it('session.next.* legacy 族（含词汇外成员）被 transformEvent 前缀丢弃', () => {
    for (const t of [
      'session.next.step.ended', 'session.next.reasoning.ended',
      'session.next.tool.started', 'session.next.tool.updated', 'session.next.tool.ended', 'session.next.tool.failed',
    ]) {
      expect(applyEventMappings(raw(t, { sessionID: 's1' }), ENTRY, isCanonical)).toEqual([]);
    }
  });

  it('sync 信封也被 transformEvent 丢弃（RUNTIME_NATIVE_DROPPED 之外的翻译层兜底）', () => {
    expect(applyEventMappings(raw('sync', { seq: 1 }), ENTRY, isCanonical)).toEqual([]);
  });

  it('差异行不劫持 canonical 直发：opencode 若直接发新词（未来版本）走 passthrough', () => {
    const evt = raw('turn.completed', { sessionID: 's1' });
    expect(applyEventMappings(evt, ENTRY, isCanonical)).toEqual([evt]);
  });
});
