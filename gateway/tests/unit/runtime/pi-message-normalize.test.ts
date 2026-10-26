import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';
import { isMafwMessage } from '../../../src/runtime/canonical-types';

const T = 1_700_000_000_000;

describe('normalizePiMessages（flat 输出，canonical v3）', () => {
  test('user 文本 → flat 消息 + text part content', () => {
    const out = normalizePiMessages([{ role: 'user', content: 'hi', timestamp: T }]);
    expect(out).toHaveLength(1);
    expect(isMafwMessage(out[0])).toBe(true);
    expect(out[0].role).toBe('user');
    expect(out[0].content![0]).toMatchObject({ type: 'text', text: 'hi' });
  });

  test('assistant text + thinking + toolCall（有 result）→ 三 part content', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '看一下' },
        { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } },
      ] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'file.txt' }], isError: false, timestamp: T + 5 },
    ]);
    expect(out).toHaveLength(1);
    expect(isMafwMessage(out[0])).toBe(true);
    const parts = out[0].content!;
    expect(parts.map((p) => p.type)).toEqual(['reasoning', 'text', 'tool']);
    const tool = parts[2] as any;
    expect(tool.id).toBe('toolpart_tc1');
    expect(tool.callID).toBe('tc1');
    expect(tool.tool).toBe('bash');
    expect(tool.state.status).toBe('completed');
    expect(tool.state.output).toBe('file.txt');
    expect(tool.state.input).toEqual({ command: 'ls' });
    expect(tool.state.time.end).toBe(T + 5);
  });

  test('toolCall 无 result → running（历史半截会话）', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'tc1', name: 'read', arguments: {} }] },
    ]);
    expect((out[0].content![0] as any).state.status).toBe('running');
  });

  test('toolResult isError → error part', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'tc1', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true, timestamp: T + 1 },
    ]);
    expect((out[0].content![0] as any).state).toMatchObject({ status: 'error', error: 'boom' });
  });

  test('多 tool 混杂文本保持顺序；孤儿 toolResult 丢弃', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'text', text: 'a' },
        { type: 'toolCall', id: 't1', name: 'read', arguments: {} },
        { type: 'text', text: 'b' },
        { type: 'toolCall', id: 't2', name: 'grep', arguments: {} },
      ] },
      { role: 'toolResult', toolCallId: 'orphan', toolName: 'x', content: [], isError: false, timestamp: T },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content!.map((p) => p.type)).toEqual(['text', 'tool', 'text', 'tool']);
  });

  test('assistant thinkingSignature → reasoning part.signature', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'thinking', thinking: 'opaque', thinkingSignature: 'sig-abc' },
      ] },
    ]);
    expect((out[0].content![0] as any)).toMatchObject({ type: 'reasoning', text: 'opaque', signature: 'sig-abc' });
  });

  test('redacted thinking (empty text) and tool thoughtSignature keep signature', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'thinking', thinking: '', thinkingSignature: 'sig-redacted' },
        { type: 'toolCall', id: 'tc-sig', name: 'read', arguments: {}, thoughtSignature: 'sig-tool' },
      ] },
    ]);
    expect((out[0].content![0] as any)).toMatchObject({ type: 'reasoning', text: '', signature: 'sig-redacted' });
    expect((out[0].content![1] as any)).toMatchObject({ type: 'tool', callID: 'tc-sig', signature: 'sig-tool' });
  });

  test('id 稳定性：同输入同输出（幂等）；time 为顶层字段', () => {
    const raw = [{ role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'x' }] }];
    expect(normalizePiMessages(raw)).toEqual(normalizePiMessages(raw));
    const [msg] = normalizePiMessages(raw);
    expect(msg.time).toEqual({ created: T, completed: T });
    expect(msg.id).toMatch(/^pia_\d+_\d+$/);
  });
});
