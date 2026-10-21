/**
 * wire-compat —— egress 出口转换（flat → v1 wire）契约测试。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.4
 * shim 是唯一 flat→wire 转换点；parts 原样引用直通（绝不改 part 载荷与
 * part.id——@v1 原生 part.id 直通不变量）；model → modelID 是唯一换名
 * （与 opencode-history 的 modelID → model 互逆，ledger pre-flight Row 1）。
 */
import { MafwMessage } from '../../../src/runtime/canonical-types';
import { toWireInfo, toWireHistory } from '../../../src/runtime/wire-compat';

const fullMessage: MafwMessage = {
  id: 'm1', sessionID: 'ses_1', role: 'assistant',
  content: [{ id: 'p1', type: 'text', text: 'hi' }],
  time: { created: 1, updated: 2, completed: 3 },
  finish: 'stop', model: 'glm-5.3', providerID: 'gateway',
  tokens: { input: 10 }, cost: { total: 0.01 }, parentID: 'm0',
};

describe('wire-compat egress 转换', () => {
  it('字段完整往返：已知字段全量输出，model 输出为 modelID（shim 侧唯一换名）', () => {
    expect(toWireInfo(fullMessage)).toEqual({
      id: 'm1', sessionID: 'ses_1', role: 'assistant',
      time: { created: 1, updated: 2, completed: 3 },
      finish: 'stop', modelID: 'glm-5.3', providerID: 'gateway',
      tokens: { input: 10 }, cost: { total: 0.01 }, parentID: 'm0',
    });
  });

  it('未知附加字段透传不丢（字段保真兜底）', () => {
    const msg = { ...fullMessage, retries: 2 } as MafwMessage;
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
