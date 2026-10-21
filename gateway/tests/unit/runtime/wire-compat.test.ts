/**
 * wire-compat —— egress 出口转换（flat → v1 wire）契约测试。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.4
 * shim 是唯一 flat→wire 转换点；parts 原样引用直通（绝不改 part 载荷与
 * part.id）。**零换名**（ledger Task 4 修正裁决，推翻 pre-flight Row 1 的
 * model→modelID 方案）：SDK 真实形状是 UserMessage.model 为对象
 * {providerID, modelID, variant?}、AssistantMessage.modelID 为字符串——
 * 任何换名都破坏 round-trip；flat ↔ wire 是纯信封搬移，全部字段同名透传。
 */
import { MafwMessage } from '../../../src/runtime/canonical-types';
import { toWireInfo, toWireHistory } from '../../../src/runtime/wire-compat';

/** AssistantMessage 风格（modelID/providerID 扁平、cost 数字）。 */
const assistantStyle: MafwMessage = {
  id: 'm1', sessionID: 'ses_1', role: 'assistant',
  content: [{ id: 'p1', type: 'text', text: 'hi' }],
  time: { created: 1, updated: 2, completed: 3 },
  finish: 'stop', providerID: 'gateway',
  tokens: { input: 10 }, cost: 0.01, parentID: 'm0',
};

/** UserMessage 风格（model 为对象——SDK types.gen.d.ts 真实形状）。 */
const userStyle = {
  id: 'm2', sessionID: 'ses_1', role: 'user' as const,
  content: [],
  time: { created: 4 },
  agent: 'build',
  model: { providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' },
  summary: { title: 't', diffs: [] },
};

describe('wire-compat egress 转换（零换名）', () => {
  it('assistant 风格：全部字段恒等输出，cost(number)/finish/tokens 原样', () => {
    expect(toWireInfo(assistantStyle)).toEqual({
      id: 'm1', sessionID: 'ses_1', role: 'assistant',
      time: { created: 1, updated: 2, completed: 3 },
      finish: 'stop', providerID: 'gateway',
      tokens: { input: 10 }, cost: 0.01, parentID: 'm0',
    });
  });

  it('user 风格：model 对象透传不改名（换名方案会破坏 UserMessage round-trip）', () => {
    const info = toWireInfo(userStyle as unknown as MafwMessage);
    expect(info).toEqual({
      id: 'm2', sessionID: 'ses_1', role: 'user',
      time: { created: 4 },
      agent: 'build',
      model: { providerID: 'gateway', modelID: 'glm-5.3', variant: 'max' },
      summary: { title: 't', diffs: [] },
    });
  });

  it('未知附加字段透传不丢（字段保真兜底）', () => {
    const msg = { ...assistantStyle, retries: 2 } as MafwMessage;
    expect((toWireInfo(msg) as Record<string, unknown>).retries).toBe(2);
  });

  it('空 content → parts: [] 不炸（Review Focus 1）', () => {
    expect(toWireHistory([{ id: 'm2', role: 'assistant', content: [] }]))
      .toEqual([{ info: { id: 'm2', role: 'assistant' }, parts: [] }]);
  });

  it('content 缺省（事件载荷形态）→ parts: []', () => {
    expect(toWireHistory([{ role: 'user' }]))
      .toEqual([{ info: { role: 'user' }, parts: [] }]);
  });

  it('无 id 消息：info 无 id 键、不炸、不造 id（Review Focus 3）', () => {
    const info = toWireInfo({ role: 'assistant', finish: 'stop' });
    expect(info).toEqual({ role: 'assistant', finish: 'stop' });
    expect('id' in info).toBe(false);
  });

  it('透传部件：parts 原样引用直通、字段零丢失（Review Focus 2）', () => {
    const compaction = { id: 'pc1', type: 'compaction', tokensBefore: 100, summary: 's' };
    const toolPart = {
      id: 't1', type: 'tool', callID: 'c1', tool: 'bash',
      state: { status: 'completed', input: { command: 'ls' }, output: 'a\nb' },
    };
    const [out] = toWireHistory([{ id: 'm3', role: 'assistant', content: [compaction, toolPart] }]);
    expect(out.parts[0]).toBe(compaction); // 同引用直通
    expect(out.parts[1]).toBe(toolPart);
    expect((out.parts[0] as Record<string, unknown>).tokensBefore).toBe(100);
  });

  it('已是 wire 形状的项原样放行（B2 违例回退路径的防御——info+parts 键共存判定）', () => {
    const wireItem = { info: { id: 'w1', role: 'user' }, parts: [{ id: 'p', type: 'text', text: 'x' }] };
    const [out] = toWireHistory([wireItem as unknown as MafwMessage]);
    expect(out).toBe(wireItem); // 原样引用，不二次包装
  });

  it('缺省字段不输出键：最小消息 → info 仅 role 一键', () => {
    expect(toWireInfo({ role: 'user' })).toEqual({ role: 'user' });
  });

  it('批量顺序保持', () => {
    const msgs: MafwMessage[] = [
      { id: 'a', role: 'user', content: [{ id: 'p', type: 'text', text: 'q' }] },
      { id: 'b', role: 'assistant', content: [] },
    ];
    expect(toWireHistory(msgs).map((m) => (m.info as { id: string }).id)).toEqual(['a', 'b']);
  });
});
