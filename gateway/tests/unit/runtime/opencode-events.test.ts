import { applyEventMappings, canonicalIdentity, RUNTIME_IDENTITY_TYPES } from '../../../src/runtime/event-mapper';
import { OPENCODE_EVENT_SOURCE, OPENCODE_EVENT_MAPPINGS } from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { MAFW_RUNTIME_EVENT_NAMES } from '../../../src/runtime/mafw-vocabulary';
import { TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';

const ENTRY = {
  eventSource: OPENCODE_EVENT_SOURCE,
  eventMappings: OPENCODE_EVENT_MAPPINGS,
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

  it('同名收编词经 identity 行放行（恒等翻译，载荷 passProperties 重建）', () => {
    for (const t of ['session.created', 'message.updated', 'permission.asked', 'question.asked', 'session.diff']) {
      const out = applyEventMappings(raw(t, { sessionID: 's1', keep: 1 }), ENTRY, isCanonical);
      expect(out).toHaveLength(1);
      expect(out[0].payload.type).toBe(t);
      expect(out[0].payload.properties.keep).toBe(1);
      expect(out[0].sessionID).toBe('s1');
      expect(out[0].directory).toBe('/p');
    }
  });

  it('session.next.* legacy 族经显式 drop 行丢弃（词汇外新成员同样被拦——default-deny 漏网探测器）', () => {
    for (const t of [
      'session.next.step.ended', 'session.next.reasoning.ended',
      'session.next.tool.started', 'session.next.tool.updated', 'session.next.tool.ended', 'session.next.tool.failed',
    ]) {
      const suppressed: string[] = [];
      expect(applyEventMappings(raw(t, { sessionID: 's1' }), ENTRY, isCanonical, { onSuppressed: (x) => suppressed.push(x) })).toEqual([]);
      expect(suppressed).toEqual([t]);
    }
    // 家族新成员（未来 opencode 新增）→ unmatched 拦截 + 计数，不再静默穿过
    const unmatched: string[] = [];
    expect(applyEventMappings(raw('session.next.tool.created', {}), ENTRY, isCanonical, { onUnmatched: (x) => unmatched.push(x) })).toEqual([]);
    expect(unmatched).toEqual(['session.next.tool.created']);
  });

  it('sync 信封经 drop 行丢弃', () => {
    const suppressed: string[] = [];
    expect(applyEventMappings(raw('sync', { seq: 1 }), ENTRY, isCanonical, { onSuppressed: (x) => suppressed.push(x) })).toEqual([]);
    expect(suppressed).toEqual(['sync']);
  });

  it('词汇外新词（未来 opencode 事件）→ unmatched 拦截 + 计数（不再 transformEvent 返 raw 穿过）', () => {
    const unmatched: string[] = [];
    expect(applyEventMappings(raw('session.forked', { sessionID: 's1' }), ENTRY, isCanonical, { onUnmatched: (x) => unmatched.push(x) })).toEqual([]);
    expect(unmatched).toEqual(['session.forked']);
  });

  it('差异行不劫持 identity：opencode 直接发 canonical 词走恒等行', () => {
    const out = applyEventMappings(raw('turn.completed', { sessionID: 's1' }), ENTRY, isCanonical);
    expect(out).toHaveLength(1);
    expect(out[0].payload.type).toBe('turn.completed');
    expect(out[0].payload.properties.sessionID).toBe('s1');
  });
});

describe('canonicalIdentity 恒等行（B1 identity 声明）', () => {
  it('词汇完备性：runtime 事件词汇 ∪ 工具三原语 逐类型经 opencode 注册面全部命中', () => {
    expect([...RUNTIME_IDENTITY_TYPES]).toEqual(expect.arrayContaining([...MAFW_RUNTIME_EVENT_NAMES]));
    for (const t of ['tool.call', 'tool.delta', 'tool.result']) expect(RUNTIME_IDENTITY_TYPES).toContain(t);
    for (const t of RUNTIME_IDENTITY_TYPES) {
      const out = applyEventMappings(raw(t, { sessionID: 's1', keep: { deep: 1 } }), ENTRY, isCanonical);
      expect(out).toHaveLength(1);
      expect(out[0].payload.type).toBe(t);
      expect(out[0].payload.properties.keep).toEqual({ deep: 1 }); // passProperties 恒等重建
      expect(out[0].sessionID).toBe('s1');
    }
  });

  it('identity 行是词汇单源派生：canonicalIdentity() 逐条 from===to', () => {
    for (const m of canonicalIdentity('$.payload.properties')) {
      expect(m.from).toBe(m.to);
      expect(m.passProperties).toBe('$.payload.properties');
    }
    expect(canonicalIdentity().every((m) => m.passProperties === undefined)).toBe(true);
  });
});
