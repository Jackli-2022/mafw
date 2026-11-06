/**
 * claude 适配器物理迁移契约测试 —— 同一张 CLAUDE_EVENT_MAPPINGS 表由
 * gateway 真执行器（applyEventMappings）执行，证明 raw-event-first 声明面
 * 与旧内置迷你执行器语义等价（spec 2026-10-31 §4.6）。
 */
import { applyEventMappings, canonicalTypeSet } from '../../../src/runtime/event-mapper';
import {
  CLAUDE_EVENT_MAPPINGS,
  CLAUDE_EVENT_SOURCE,
  claudeTransformEvent,
} from '../../../../adapters/claude/src/events';

const entry = {
  eventSource: CLAUDE_EVENT_SOURCE,
  eventMappings: CLAUDE_EVENT_MAPPINGS,
  transformEvent: claudeTransformEvent,
};
const canonical = canonicalTypeSet();
const run = (raw: any) => applyEventMappings(raw, entry, (t) => canonical.has(t));
const sid = 'ses_claude_1';

const resultSuccess = {
  type: 'result', subtype: 'success', session_id: sid,
  result: 'the answer', is_error: false, num_turns: 2,
  duration_ms: 1500, duration_api_ms: 1200, total_cost_usd: 0.01,
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 },
  terminal_reason: 'completed',
};

test('system/init → session.created（info.id 契约必填 + model/directory 保留）', () => {
  const out = run({
    type: 'system', subtype: 'init', session_id: sid,
    model: 'claude-opus-4-6', permissionMode: 'default', cwd: 'C:/proj',
  });
  expect(out).toHaveLength(1);
  expect(out[0].payload.type).toBe('session.created');
  // 桌面 planSessionEvent 需要 properties.info（缺了直接 {kind:'none'}，列表不同步）
  expect(out[0].payload.properties.info.id).toBe(sid);
  expect(out[0].payload.properties.info.directory).toBe('C:/proj');
  expect(out[0].payload.properties.model).toBe('claude-opus-4-6');
  expect(out[0].sessionID).toBe(sid);
});

test('system status → compacting；compact_boundary → compacted', () => {
  expect(run({ type: 'system', subtype: 'status', status: 'compacting', session_id: sid })[0].payload.type)
    .toBe('session.compacting');
  expect(run({ type: 'system', subtype: 'compact_boundary', session_id: sid })[0].payload.type)
    .toBe('session.compacted');
});

test('result success → turn.completed（usage/cost 进 properties）', () => {
  const out = run(resultSuccess);
  expect(out).toHaveLength(1);
  expect(out[0].payload.type).toBe('turn.completed');
  expect(out[0].payload.properties.usage.input_tokens).toBe(100);
  expect(out[0].payload.properties.cost).toBe(0.01);
});

test('result aborted_* → turn.aborted（行序：aborted 先于 failed）', () => {
  expect(run({ ...resultSuccess, subtype: 'error_during_execution', terminal_reason: 'aborted_streaming', is_error: true, result: '' })[0].payload.type)
    .toBe('turn.aborted');
  expect(run({ ...resultSuccess, subtype: 'error_during_execution', terminal_reason: 'aborted_tools', is_error: true })[0].payload.type)
    .toBe('turn.aborted');
});

test('result 四个 error_* subtype → turn.failed', () => {
  for (const subtype of ['error_max_turns', 'error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries']) {
    expect(run({ ...resultSuccess, subtype, is_error: true })[0].payload.type).toBe('turn.failed');
  }
});

test('assistant 拆分：message.updated + text/thinking part + tool_use → tool.call', () => {
  const out = run({
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
  });
  const types = out.map((e: any) => e.payload.type);
  expect(types[0]).toBe('message.updated');
  expect(out[0].payload.properties.message.id).toBe('cla_asst-1');
  expect(out[0].payload.properties.message.finish).toBe('tool_use');
  const parts = out.filter((e: any) => e.payload.type === 'part.updated').map((e: any) => e.payload.properties.part);
  expect(parts.map((p: any) => p.type)).toEqual(['reasoning', 'text']);
  expect(parts[0].signature).toBe('sig_abc123');
  const toolCall = out.find((e: any) => e.payload.type === 'tool.call');
  expect(toolCall?.payload.properties.tool).toBe('Bash');
  expect(toolCall?.payload.properties.input).toEqual({ command: 'ls' });
});

test('user 文本：message.updated + text part；turn.started 归 tracker（不在映射层合成）', () => {
  const out = run({
    type: 'user', session_id: sid, uuid: 'usr-1', parent_tool_use_id: null,
    message: { role: 'user', content: '帮我查一下' },
  });
  const types = out.map((e: any) => e.payload.type);
  expect(types).not.toContain('turn.started');
  expect(types).toContain('message.updated');
  expect(types).toContain('part.updated');
  expect(out.find((e: any) => e.payload.type === 'part.updated').payload.properties.part.text).toBe('帮我查一下');
});

test('user tool_result → tool.result（callID=tool_use_id，isError 传递）', () => {
  const ok = run({
    type: 'user', session_id: sid, uuid: 'usr-4', parent_tool_use_id: 'toolu_01',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'file.txt', is_error: false }] },
  });
  const res = ok.find((e: any) => e.payload.type === 'tool.result');
  expect(res?.payload.properties.callID).toBe('toolu_01');
  expect(res?.payload.properties.isError).toBe(false);
  const err = run({
    type: 'user', session_id: sid, uuid: 'usr-5', parent_tool_use_id: 'toolu_02',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'boom', is_error: true }] },
  });
  expect(err.find((e: any) => e.payload.type === 'tool.result')?.payload.properties.isError).toBe(true);
});

test('stream_event 分派：text/thinking → part.delta；input_json_delta → tool.delta', () => {
  const text = run({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } },
  });
  expect(text[0].payload.type).toBe('part.delta');
  expect(text[0].payload.properties.field).toBe('text');
  const thinking = run({
    type: 'stream_event', session_id: sid, parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '思考' } },
  });
  expect(thinking[0].payload.type).toBe('part.delta');
  const json = run({
    type: 'stream_event', session_id: sid, parent_tool_use_id: 'toolu_01',
    event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a":' } },
  });
  expect(json[0].payload.type).toBe('tool.delta');
  expect(json[0].payload.properties.callID).toBe('toolu_01');
});

test('未知类型 → transformEvent 返回 null = 声明式压制（suppressed 计数）', () => {
  const suppressed: string[] = [];
  const out = applyEventMappings(
    { type: 'task_progress', session_id: sid },
    entry,
    (t) => canonical.has(t),
    { onSuppressed: (t) => suppressed.push(t) },
  );
  expect(out).toEqual([]);
  expect(suppressed).toEqual(['task_progress']);
});
