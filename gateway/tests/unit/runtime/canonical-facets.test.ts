import { CANONICAL_FACET_RULES, evaluateFacetRules } from '../../../src/runtime/canonical-facets';

const ev = (type: string, props: any, sid?: string) => evaluateFacetRules(CANONICAL_FACET_RULES, type, props, sid);

test('step: legacy session.next.step.ended（chain sessionID 回退 + 必须）', () => {
  expect(ev('session.next.step.ended', { assistantMessageID: 'm1' }, 's1').step)
    .toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: undefined });
  expect(ev('session.next.step.ended', {}, undefined).step).toBeNull();
});

test('step: step-finish part（严格 part 路径，无 chain 回退）', () => {
  const r = ev('message.part.updated', { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  // part.sessionID 缺席时不回退 chain（现状 stepPropsFromPartUpdated 语义）
  const r2 = ev('message.part.updated', { part: { type: 'step-finish', messageID: 'm1' } }, 'sChain');
  expect(r2.step).toEqual({ sessionID: undefined, assistantMessageID: 'm1', finish: undefined });
});

test('step: completed assistant message', () => {
  const r = ev('message.updated', { info: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  expect(ev('message.updated', { info: { role: 'user', time: { completed: 1 } } }, 's1').step).toBeNull();
});

test('chatSignal: delta 双路径（part.text 优先于 delta；空串不算）', () => {
  expect(ev('message.part.updated', { part: { text: 'a' }, delta: 'b' }, undefined).deltaText).toBe('a');
  expect(ev('message.part.updated', { part: { text: '' }, delta: 'b' }, undefined).deltaText).toBe('b');
  expect(ev('message.part.updated', { part: {} }, undefined).chatSignal).toBeNull();
});

test('chatSignal: complete/error + broadcast', () => {
  expect(ev('session.idle', {}, 's1')).toMatchObject({ chatSignal: 'complete', broadcast: 'idle' });
  expect(ev('session.error', { error: 'x' }, 's1')).toMatchObject({ chatSignal: 'error', chatError: 'x', broadcast: 'error' });
  expect(ev('message.error', {}, 's1')).toMatchObject({ chatSignal: 'error', chatError: 'Unknown error', broadcast: 'passthrough' });
  expect(ev('session.created', {}, 's1').broadcast).toBe('passthrough');
});

test('compaction', () => {
  expect(ev('session.compacting', {}, 's1').compaction).toBe('start');
  expect(ev('session.compacted', {}, 's1').compaction).toBe('end');
  expect(ev('session.idle', {}, 's1').compaction).toBeNull();
});

test('approval: 双形状对齐 + 畸形不产', () => {
  const a = ev('permission.asked', { id: 'r1', permission: 'bash', patterns: ['*'] }, 's1').approval;
  expect(a).toMatchObject({ requestId: 'r1', toolName: 'bash' });
  const b = ev('permission.asked', { requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'high' }, 's1').approval;
  expect(b).toMatchObject({ requestId: 'r2', toolName: 'edit', metadata: { args: { f: 1 }, risk: 'high' } });
  expect(ev('permission.asked', { requestId: 'r3' }, 's1').approval).toBeNull(); // 缺 toolName
  expect(ev('permission.asked', { requestId: 'r4', toolName: 'bash' }, undefined).approval).toBeNull(); // 缺 chain sid
});
