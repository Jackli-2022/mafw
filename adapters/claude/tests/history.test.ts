/**
 * claude 历史 normalize —— SDK getSessionMessages → flat MafwMessage 契约测试。
 * 与 Plan 1 pi-message-normalize 同构（toolCallId 关联合并单 ToolPart、
 * toolpart_<tool_use_id> id 方案——live/历史同 id 去重）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClaudeHistory } from '../src/history.ts';

test('user 文本（string content）→ flat 消息 + text part', () => {
  const out = normalizeClaudeHistory([
    { uuid: 'u1', role: 'user', content: '帮我查一下' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'clu_u1');
  assert.equal(out[0].role, 'user');
  assert.deepEqual(out[0].content?.map((p: any) => ({ type: p.type, text: p.text })), [{ type: 'text', text: '帮我查一下' }]);
});

test('assistant text+thinking → 对应 parts；finish/model/tokens 透传', () => {
  const out = normalizeClaudeHistory([
    {
      uuid: 'a1', role: 'assistant', model: 'claude-opus-4-6', stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'sig_hist9' },
        { type: 'text', text: '答案' },
      ],
    },
  ]);
  assert.equal(out[0].id, 'cla_a1');
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].finish, 'end_turn');
  assert.equal(out[0].model, 'claude-opus-4-6');
  // P0-3: thinking signature passthrough
  const rPart = out[0].content.find((x: any) => x.type === 'reasoning');
  assert.equal(rPart?.signature, 'sig_hist9');
  assert.deepEqual(out[0].content?.map((p: any) => p.type), ['reasoning', 'text']);
  assert.deepEqual(out[0].tokens, { input_tokens: 10, output_tokens: 5 });
});

test('assistant tool_use + 后随 user tool_result（tool_use_id 关联）→ toolpart 合并 completed', () => {
  const out = normalizeClaudeHistory([
    { uuid: 'a2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_01', name: 'Bash', input: { command: 'ls' } }] },
    { uuid: 'u2', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_01', content: 'file.txt', is_error: false }] },
  ]);
  // tool_result 被消费不产顶层条目（pi 同构）
  assert.equal(out.length, 1);
  const tool = out[0].content?.[0] as any;
  assert.equal(tool.id, 'toolpart_toolu_01');
  assert.equal(tool.type, 'tool');
  assert.equal(tool.tool, 'Bash');
  assert.equal(tool.callID, 'toolu_01');
  assert.equal(tool.state.status, 'completed');
  assert.equal(tool.state.output, 'file.txt');
  assert.deepEqual(tool.state.input, { command: 'ls' });
});

test('tool_result is_error → error part；无 result 的 tool_use → running（半截会话）', () => {
  const out = normalizeClaudeHistory([
    { uuid: 'a3', role: 'assistant', content: [
      { type: 'tool_use', id: 'toolu_02', name: 'Bash', input: {} },
      { type: 'tool_use', id: 'toolu_03', name: 'Read', input: {} },
    ] },
    { uuid: 'u3', role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_02', content: 'boom', is_error: true }] },
  ]);
  const parts = out[0].content as any[];
  assert.equal(parts[0].state.status, 'error');
  assert.equal(parts[0].state.error, 'boom');
  assert.equal(parts[1].state.status, 'running'); // toolu_03 无 result
});

test('块数组 content 的 user 文本与 tool_result 混合：text 入消息，tool_result 仅配对', () => {
  const out = normalizeClaudeHistory([
    { uuid: 'a4', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_04', name: 'Bash', input: {} }] },
    { uuid: 'u4', role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_04', content: 'ok', is_error: false },
      { type: 'text', text: '继续' },
    ] },
  ]);
  // text 块单独成 user 消息（tool_result 已被 a4 消费）
  assert.equal(out.length, 2);
  assert.equal(out[1].id, 'clu_u4');
  assert.equal(out[1].content?.[0].type, 'text');
  assert.equal((out[1].content?.[0] as any).text, '继续');
});

test('未知/畸形条目跳过不炸（fail-open）', () => {
  const out = normalizeClaudeHistory([null, { foo: 1 }, { uuid: 'x', role: 'system', content: [] }]);
  assert.equal(out.length, 0);
});
