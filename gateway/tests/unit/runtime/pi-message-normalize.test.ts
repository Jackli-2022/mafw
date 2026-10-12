import { normalizePiMessages } from '../../../src/runtime/pi/pi-message-normalize';

const T = 1_700_000_000_000;

describe('normalizePiMessages', () => {
  test('user 文本 → text part', () => {
    const out = normalizePiMessages([{ role: 'user', content: 'hi', timestamp: T }]);
    expect(out).toHaveLength(1);
    expect(out[0].info.role).toBe('user');
    expect(out[0].parts[0]).toMatchObject({ type: 'text', text: 'hi' });
  });

  test('assistant text + thinking + toolCall（有 result）→ 三 part', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '看一下' },
        { type: 'toolCall', id: 'tc1', name: 'bash', arguments: { command: 'ls' } },
      ] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'file.txt' }], isError: false, timestamp: T + 5 },
    ]);
    expect(out).toHaveLength(1);
    const parts = out[0].parts;
    expect(parts.map((p) => p.type)).toEqual(['reasoning', 'text', 'tool']);
    const tool = parts[2];
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
    expect(out[0].parts[0].state.status).toBe('running');
  });

  test('toolResult isError → error part', () => {
    const out = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [{ type: 'toolCall', id: 'tc1', name: 'bash', arguments: {} }] },
      { role: 'toolResult', toolCallId: 'tc1', toolName: 'bash', content: [{ type: 'text', text: 'boom' }], isError: true, timestamp: T + 1 },
    ]);
    expect(out[0].parts[0].state).toMatchObject({ status: 'error', error: 'boom' });
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
    expect(out[0].parts.map((p) => p.type)).toEqual(['text', 'tool', 'text', 'tool']);
  });

  test('id 稳定性：同输入同输出（幂等）', () => {
    const raw = [{ role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'x' }] }];
    expect(normalizePiMessages(raw)).toEqual(normalizePiMessages(raw));
  });
});
