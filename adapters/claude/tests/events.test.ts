/**
 * claude 事件方言测试 —— transformEvent 纯函数 + 声明面完整性。
 * 表执行语义（system/result 行、缺失类型拦截）在 gateway 真执行器契约测试里钉：
 * gateway/tests/unit/runtime/claude-adapter-mappings.test.ts。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAUDE_EVENT_SOURCE,
  CLAUDE_EVENT_MAPPINGS,
  claudeTransformEvent,
  isClaudeTerminal,
  isClaudeTurnStart,
} from '../src/events.ts';

const sid = 'ses_claude_1';

test('assistant 拆分：message.updated(flat) + text/thinking part + tool_use → tool.call', () => {
  const out = claudeTransformEvent({
    type: 'assistant', session_id: sid, uuid: 'asst-1', parent_tool_use_id: null,
    message: {
      id: 'msg_01', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'sig_abc123' },
        { type: 'text', text: '看一下' },
        { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  }) as any[];
  const types = out.map((e) => e.payload.type);
  assert.equal(types[0], 'message.updated');
  assert.equal(out[0].payload.properties.message.id, 'cla_asst-1');
  assert.equal(out[0].payload.properties.message.role, 'assistant');
  assert.equal(out[0].payload.properties.message.finish, 'tool_use');
  assert.equal(out[0].payload.properties.message.model, 'claude-opus-4-6');
  const parts = out.filter((e) => e.payload.type === 'part.updated').map((e) => e.payload.properties.part);
  assert.deepEqual(parts.map((p) => p.type), ['reasoning', 'text']);
  assert.equal(parts[0].signature, 'sig_abc123');
  const toolCall = out.find((e) => e.payload.type === 'tool.call');
  assert.ok(toolCall, 'tool.call emitted');
  assert.equal(toolCall!.payload.properties.callID, 'toolu_01');
  assert.equal(toolCall!.payload.properties.tool, 'Bash');
  assert.deepEqual(toolCall!.payload.properties.input, { command: 'ls' });
});

test('user 纯文本：message.updated(user) + text part；不合成 turn.started', () => {
  const out = claudeTransformEvent({
    type: 'user', session_id: sid, uuid: 'usr-1', parent_tool_use_id: null,
    message: { role: 'user', content: '帮我查一下' },
  }) as any[];
  const types = out.map((e) => e.payload.type);
  assert.ok(!types.includes('turn.started'));
  assert.ok(types.includes('message.updated'));
  assert.equal(out.find((e) => e.payload.type === 'message.updated').payload.properties.message.role, 'user');
  assert.equal(out.find((e) => e.payload.type === 'message.updated').payload.properties.message.id, 'clu_usr-1');
  const textPart = out.find((e) => e.payload.type === 'part.updated');
  assert.equal(textPart.payload.properties.part.type, 'text');
  assert.equal(textPart.payload.properties.part.text, '帮我查一下');
});

test('user tool_result → tool.result（callID=tool_use_id，isError 传递）', () => {
  const out = claudeTransformEvent({
    type: 'user', session_id: sid, uuid: 'usr-4', parent_tool_use_id: 'toolu_01',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'file.txt', is_error: false }] },
  }) as any[];
  const res = out.find((e) => e.payload.type === 'tool.result');
  assert.ok(res, 'tool.result emitted');
  assert.equal(res!.payload.properties.callID, 'toolu_01');
  assert.equal(res!.payload.properties.output, 'file.txt');
  assert.equal(res!.payload.properties.isError, false);

  const err = claudeTransformEvent({
    type: 'user', session_id: sid, uuid: 'usr-5', parent_tool_use_id: 'toolu_02',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'boom', is_error: true }] },
  }) as any[];
  assert.equal(err.find((e) => e.payload.type === 'tool.result')!.payload.properties.isError, true);
});

test('stream_event 分派：text/thinking → part.delta；input_json_delta → tool.delta(kind:input)', () => {
  const text = claudeTransformEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
  }) as any[];
  assert.equal(text[0].payload.type, 'part.delta');
  assert.equal(text[0].payload.properties.delta, '你好');
  assert.equal(text[0].payload.properties.field, 'text');

  const thinking = claudeTransformEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
  }) as any[];
  assert.equal(thinking[0].payload.type, 'part.delta');
  assert.equal(thinking[0].payload.properties.delta, '思考');

  const json = claudeTransformEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: 'toolu_01',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
  }) as any[];
  assert.equal(json[0].payload.type, 'tool.delta');
  assert.equal(json[0].payload.properties.kind, 'input');
  assert.equal(json[0].payload.properties.text, '{"a":');
  assert.equal(json[0].payload.properties.callID, 'toolu_01');
});

test('声明面完整：eventSource/词表行/transform 逃逸口/turn 谓词', () => {
  assert.equal(CLAUDE_EVENT_SOURCE.typePath, '$.type');
  assert.equal(CLAUDE_EVENT_SOURCE.sessionIdPath, '$.session_id');
  assert.ok(CLAUDE_EVENT_MAPPINGS.length >= 10, 'system×3 + result×7+ 声明行');
  assert.equal(typeof claudeTransformEvent, 'function');
  // turn 边界谓词（runtime-kit tracker 依赖）
  assert.equal(isClaudeTurnStart({ type: 'user' }), true);
  assert.equal(isClaudeTurnStart({ type: 'assistant' }), false);
  assert.equal(isClaudeTerminal({ type: 'result' }), true);
  assert.equal(isClaudeTerminal({ type: 'user' }), false);
  // 未处理类型 → null（suppressed 语义）
  assert.equal(claudeTransformEvent({ type: 'task_progress' }), null);
});
