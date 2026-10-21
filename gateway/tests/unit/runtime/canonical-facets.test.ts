import { CANONICAL_FACET_RULES, evaluateFacetRules } from '../../../src/runtime/canonical-facets';

const ev = (type: string, props: any, sid?: string) => evaluateFacetRules(CANONICAL_FACET_RULES, type, props, sid);

test('step: step-finish part（严格 part 路径，无 chain 回退）', () => {
  const r = ev('part.updated', { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  // part.sessionID 缺席时不回退 chain（现状 stepPropsFromPartUpdated 语义）
  const r2 = ev('part.updated', { part: { type: 'step-finish', messageID: 'm1' } }, 'sChain');
  expect(r2.step).toEqual({ sessionID: undefined, assistantMessageID: 'm1', finish: undefined });
});

test('step: legacy session.next.step.ended 载体已随词汇 v2 除名（不再产 step）', () => {
  expect(ev('session.next.step.ended', { assistantMessageID: 'm1' }, 's1').step).toBeNull();
});

test('step: completed assistant message', () => {
  const r = ev('message.updated', { message: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } }, 's1');
  expect(r.step).toEqual({ sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' });
  expect(ev('message.updated', { message: { role: 'user', time: { completed: 1 } } }, 's1').step).toBeNull();
});

test('chatSignal: delta 双路径（part.text 优先于 delta；空串不算）', () => {
  expect(ev('part.updated', { part: { text: 'a' }, delta: 'b' }, undefined).deltaText).toBe('a');
  expect(ev('part.updated', { part: { text: '' }, delta: 'b' }, undefined).deltaText).toBe('b');
  expect(ev('part.updated', { part: {} }, undefined).chatSignal).toBeNull();
});

test('chatSignal: turn 三元组终态（v2：broadcast 切面已删除）', () => {
  expect(ev('turn.completed', {}, 's1')).toMatchObject({ chatSignal: 'complete' });
  expect(ev('turn.failed', { error: 'x' }, 's1')).toMatchObject({ chatSignal: 'error', chatError: 'x' });
  expect(ev('turn.failed', {}, 's1').chatError).toBe('Unknown error');
  expect(ev('turn.aborted', {}, 's1').chatSignal).toBeNull(); // 保旧 message.aborted 无信号
  expect(ev('message.updated', { message: { id: 'm' } }, 's1').chatSignal).toBe('complete');
});

test('toolCommand: tool part 快照载体（v2 从 session.next.tool.* 迁移）', () => {
  const r = ev('part.updated', { part: { type: 'tool', state: { input: { command: 'npm test' }, status: 'running' } } }, 's1');
  expect(r.toolCommand).toBe('npm test');
  // 多 key 候选链：新 runtime 的 shell 工具换 key 不失明（bug 3b）
  const alt = ev('part.updated', { part: { type: 'tool', state: { input: { cmd: 'alt' }, status: 'running' } } }, 's1');
  expect(alt.toolCommand).toBe('alt');
  // 非 tool part / 无 command → 不产
  expect(ev('part.updated', { part: { type: 'text', text: 'hi' } }, 's1').toolCommand).toBeUndefined();
  expect(ev('part.updated', { part: { type: 'tool', state: { status: 'pending' } } }, 's1').toolCommand).toBeUndefined();
});

test('compaction', () => {
  expect(ev('session.compacting', {}, 's1').compaction).toBe('start');
  expect(ev('session.compacted', {}, 's1').compaction).toBe('end');
  expect(ev('turn.completed', {}, 's1').compaction).toBeNull();
});

test('approval: 双形状对齐 + 畸形不产', () => {
  const a = ev('permission.asked', { id: 'r1', permission: 'bash', patterns: ['*'] }, 's1').approval;
  expect(a).toMatchObject({ requestId: 'r1', toolName: 'bash' });
  const b = ev('permission.asked', { requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'high' }, 's1').approval;
  expect(b).toMatchObject({ requestId: 'r2', toolName: 'edit', metadata: { args: { f: 1 }, risk: 'high' } });
  expect(ev('permission.asked', { requestId: 'r3' }, 's1').approval).toBeNull(); // 缺 toolName
  expect(ev('permission.asked', { requestId: 'r4', toolName: 'bash' }, undefined).approval).toBeNull(); // 缺 chain sid
});
