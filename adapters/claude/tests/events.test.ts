/**
 * claude 事件方言契约测试 —— SDKMessage（真型，对照 @anthropic-ai/claude-agent-sdk
 * sdk.d.ts 0.3.x 实测）→ canonical v3。
 *
 * spec: docs/superpowers/specs/2026-10-21-runtime-canonical-v3-design.md §3.3 claude 节
 * 审计事实源: 2026-10-21-runtime-canonical-v3-mapping-audit.md §2 claude 列
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { translateClaudeEvent, CLAUDE_EVENT_SOURCE, CLAUDE_EVENT_MAPPINGS, claudeTransformEvent, __resetClaudeTurnState } from '../src/events.ts';

const sid = 'ses_claude_1';

/** SDKResultSuccess 真型 */
const resultSuccess = {
  type: 'result', subtype: 'success', session_id: sid,
  result: 'the answer', is_error: false, num_turns: 2,
  duration_ms: 1500, duration_api_ms: 1200, total_cost_usd: 0.01,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
  terminal_reason: 'completed',
};

test('① system/init → session.created（model 保留）', () => {
  const out = translateClaudeEvent({ type: 'system', subtype: 'init', session_id: sid, model: 'claude-opus-4-6', tools: ['Read'], permissionMode: 'default' }, sid);
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.type, 'session.created');
  assert.equal(out[0].payload.properties.model, 'claude-opus-4-6');
  assert.equal(out[0].sessionID, sid);
});

test('② system/status compacting → session.compacting；③ compact_boundary → session.compacted', () => {
  const a = translateClaudeEvent({ type: 'system', subtype: 'status', status: 'compacting', session_id: sid }, sid);
  assert.equal(a[0].payload.type, 'session.compacting');
  const b = translateClaudeEvent({ type: 'system', subtype: 'compact_boundary', session_id: sid }, sid);
  assert.equal(b[0].payload.type, 'session.compacted');
});

test('④ result success → turn.completed（usage/tokens/cost 进 properties）', () => {
  const out = translateClaudeEvent(resultSuccess, sid);
  assert.equal(out.length, 1);
  assert.equal(out[0].payload.type, 'turn.completed');
  assert.equal(out[0].payload.properties.usage.input_tokens, 100);
  assert.equal(out[0].payload.properties.cost, 0.01);
});

test('⑤ result error_during_execution + terminal_reason aborted_streaming → turn.aborted（行序：aborted 先于 failed）', () => {
  const out = translateClaudeEvent({ ...resultSuccess, subtype: 'error_during_execution', terminal_reason: 'aborted_streaming', is_error: true, result: '' }, sid);
  assert.equal(out[0].payload.type, 'turn.aborted');
  const tools = translateClaudeEvent({ ...resultSuccess, subtype: 'error_during_execution', terminal_reason: 'aborted_tools', is_error: true }, sid);
  assert.equal(tools[0].payload.type, 'turn.aborted');
});

test('⑥ result 四个 error_* subtype → turn.failed', () => {
  for (const subtype of ['error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries']) {
    const out = translateClaudeEvent({ ...resultSuccess, subtype, is_error: true, terminal_reason: subtype === 'error_max_turns' ? 'max_turns' : 'model_error' }, sid);
    assert.equal(out[0].payload.type, 'turn.failed', subtype);
  }
});

test('⑦ assistant 拆分：message.updated(flat) + text/thinking part + tool_use → tool.call', () => {
  const out = translateClaudeEvent({
    type: 'assistant', session_id: sid, uuid: 'asst-1', parent_tool_use_id: null,
    message: {
      id: 'msg_01', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'text', text: '看一下' },
        { type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  }, sid);
  const types = out.map((e: any) => e.payload.type);
  assert.equal(types[0], 'message.updated');
  assert.equal(out[0].payload.properties.message.id, 'cla_asst-1');
  assert.equal(out[0].payload.properties.message.role, 'assistant');
  assert.equal(out[0].payload.properties.message.finish, 'tool_use');
  assert.equal(out[0].payload.properties.message.model, 'claude-opus-4-6');
  assert.ok(types.includes('part.updated'));
  const parts = out.filter((e: any) => e.payload.type === 'part.updated').map((e: any) => e.payload.properties.part);
  assert.deepEqual(parts.map((p: any) => p.type), ['reasoning', 'text']);
  const toolCall = out.find((e: any) => e.payload.type === 'tool.call');
  assert.ok(toolCall, 'tool.call emitted');
  assert.equal(toolCall.payload.properties.callID, 'toolu_01');
  assert.equal(toolCall.payload.properties.tool, 'Bash');
  assert.deepEqual(toolCall.payload.properties.input, { command: 'ls' });
});

test('⑧ user 纯文本：首条合成 turn.started + message.updated(user) + text part；result 后状态复位', () => {
  __resetClaudeTurnState();
  const first = translateClaudeEvent({
    type: 'user', session_id: sid, uuid: 'usr-1', parent_tool_use_id: null,
    message: { role: 'user', content: '帮我查一下' },
  }, sid);
  const types = first.map((e: any) => e.payload.type);
  assert.equal(types[0], 'turn.started');
  assert.ok(types.includes('message.updated'));
  assert.equal(first.find((e: any) => e.payload.type === 'message.updated').payload.properties.message.role, 'user');
  assert.equal(first.find((e: any) => e.payload.type === 'message.updated').payload.properties.message.id, 'clu_usr-1');
  const textPart = first.find((e: any) => e.payload.type === 'part.updated');
  assert.equal(textPart.payload.properties.part.type, 'text');
  assert.equal(textPart.payload.properties.part.text, '帮我查一下');

  // 同回合第二条 user 不再发 turn.started
  const second = translateClaudeEvent({ type: 'user', session_id: sid, uuid: 'usr-2', parent_tool_use_id: null, message: { role: 'user', content: '继续' } }, sid);
  assert.equal(second.some((e: any) => e.payload.type === 'turn.started'), false);

  // result 复位：下一回合首条 user 再发 turn.started
  translateClaudeEvent(resultSuccess, sid);
  const next = translateClaudeEvent({ type: 'user', session_id: sid, uuid: 'usr-3', parent_tool_use_id: null, message: { role: 'user', content: '新回合' } }, sid);
  assert.equal(next[0].payload.type, 'turn.started');
});

test('⑨ user tool_result → tool.result（callID=tool_use_id，isError 传递）', () => {
  const out = translateClaudeEvent({
    type: 'user', session_id: sid, uuid: 'usr-4', parent_tool_use_id: 'toolu_01',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'file.txt', is_error: false }] },
    tool_use_result: { output: 'file.txt' },
  }, sid);
  const res = out.find((e: any) => e.payload.type === 'tool.result');
  assert.ok(res, 'tool.result emitted');
  assert.equal(res.payload.properties.callID, 'toolu_01');
  assert.equal(res.payload.properties.output, 'file.txt');
  assert.equal(res.payload.properties.isError, false);

  const err = translateClaudeEvent({
    type: 'user', session_id: sid, uuid: 'usr-5', parent_tool_use_id: 'toolu_02',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'boom', is_error: true }] },
  }, sid);
  assert.equal(err.find((e: any) => e.payload.type === 'tool.result').payload.properties.isError, true);
});

test('⑩ stream_event 分派：text/thinking → part.delta；input_json_delta → tool.delta(kind:input)', () => {
  const text = translateClaudeEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
  }, sid);
  assert.equal(text[0].payload.type, 'part.delta');
  assert.equal(text[0].payload.properties.delta, '你好');
  assert.equal(text[0].payload.properties.field, 'text');

  const thinking = translateClaudeEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
  }, sid);
  assert.equal(thinking[0].payload.type, 'part.delta');
  assert.equal(thinking[0].payload.properties.delta, '思考');

  const json = translateClaudeEvent({
    type: 'stream_event', session_id: sid, parent_tool_use_id: 'toolu_01',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
  }, sid);
  assert.equal(json[0].payload.type, 'tool.delta');
  assert.equal(json[0].payload.properties.kind, 'input');
  assert.equal(json[0].payload.properties.text, '{"a":');
  assert.equal(json[0].payload.properties.callID, 'toolu_01');
});

test('声明面完整：eventSource/词表行/transform 逃逸口（loader 注册契约）', () => {
  assert.equal(CLAUDE_EVENT_SOURCE.typePath, '$.type');
  assert.equal(CLAUDE_EVENT_SOURCE.sessionIdPath, '$.session_id');
  assert.ok(CLAUDE_EVENT_MAPPINGS.length >= 10, 'system×3 + result×7+ 声明行');
  assert.equal(typeof claudeTransformEvent, 'function');
  // 未处理类型 → null（suppressed 语义，pi 同款）
  assert.equal(claudeTransformEvent({ type: 'task_progress' }), null);
});
