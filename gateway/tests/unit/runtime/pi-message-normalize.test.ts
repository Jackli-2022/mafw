import { normalizePiMessages, normalizePiLiveMessage } from '../../../src/runtime/pi/pi-message-normalize';
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
    expect(msg.id).toMatch(/^pia_\d+$/);
  });

  // ---- 身份：role+timestamp，不含数组下标（live ⇄ 历史同 id） ----
  test('消息 id 与数组位置无关（同一时间戳单个消息，前后插入不改 id）', () => {
    const target = { role: 'assistant', timestamp: T + 7, content: [{ type: 'text', text: 'a' }] };
    const alone = normalizePiMessages([target]);
    const withNeighbors = normalizePiMessages([
      { role: 'user', content: 'q', timestamp: T },
      target,
      { role: 'user', content: 'q2', timestamp: T + 9 },
    ]);
    expect(alone[0].id).toBe(`pia_${T + 7}`);
    expect(withNeighbors[1].id).toBe(`pia_${T + 7}`);
    expect(alone[0].content![0].id).toBe(`pia_${T + 7}_t1`);
    expect(withNeighbors[1].content![0].id).toBe(`pia_${T + 7}_t1`);
  });

  test('user 消息 id = piu_<timestamp>（text part 为 <id>_t）', () => {
    const [msg] = normalizePiMessages([{ role: 'user', content: 'hi', timestamp: T }]);
    expect(msg.id).toBe(`piu_${T}`);
    expect(msg.content![0].id).toBe(`piu_${T}_t`);
  });

  test('同一 role+timestamp 重复 → 确定性 _2/_3 后缀（数组序）', () => {
    const raw = [
      { role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'two' }] },
      { role: 'assistant', timestamp: T, content: [{ type: 'text', text: 'three' }] },
    ];
    expect(normalizePiMessages(raw).map((m) => m.id)).toEqual([`pia_${T}`, `pia_${T}_2`, `pia_${T}_3`]);
    // 幂等：同输入同输出
    expect(normalizePiMessages(raw).map((m) => m.id)).toEqual(normalizePiMessages(raw).map((m) => m.id));
  });

  test('part id 编号跟 content 下标（text/reasoning 混排 + tool）', () => {
    const [msg] = normalizePiMessages([
      { role: 'assistant', timestamp: T, content: [
        { type: 'text', text: 'a' },
        { type: 'thinking', thinking: 'b' },
        { type: 'text', text: 'c' },
        { type: 'toolCall', id: 'tc9', name: 'bash', arguments: {} },
      ] },
    ]);
    expect(msg.content!.map((p) => p.id)).toEqual([
      `pia_${T}_t1`, `pia_${T}_r2`, `pia_${T}_t3`, 'toolpart_tc9',
    ]);
  });

  // ---- canonical 字段：model / stopReason / error ----
  test('assistant model 从 provider/model 折叠为 {providerID, modelID}', () => {
    const [msg] = normalizePiMessages([
      { role: 'assistant', timestamp: T, provider: 'xiaomi', model: 'mimo-v2.6', content: [{ type: 'text', text: 'x' }] },
    ]);
    expect(msg.model).toEqual({ providerID: 'xiaomi', modelID: 'mimo-v2.6' });
    // 缺字段不产 model（不造半空对象）
    const [bare] = normalizePiMessages([{ role: 'assistant', timestamp: T, content: [] }]);
    expect(bare.model).toBeUndefined();
  });

  test('stopReason 映射：stop/length/toolUse/error/aborted/pending/deferred', () => {
    const map = (stopReason: string) => normalizePiMessages([
      { role: 'assistant', timestamp: T, stopReason, content: [] },
    ])[0].stopReason;
    expect(map('stop')).toBe('end_turn');
    expect(map('length')).toBe('max_tokens');
    expect(map('toolUse')).toBe('tool_use');
    expect(map('error')).toBe('error');
    expect(map('aborted')).toBe('cancelled');
    expect(map('pending')).toBe('unknown');
    expect(map('deferred')).toBe('unknown');
    // 缺失 / 未知原生值
    expect(normalizePiMessages([{ role: 'assistant', timestamp: T, content: [] }])[0].stopReason).toBeUndefined();
  });

  test('error/aborted → 规范 error（provider 原文保留；abort 不渲染红卡）', () => {
    const [providerErr] = normalizePiMessages([
      { role: 'assistant', timestamp: T, stopReason: 'error', errorMessage: '  429 rate limit  ', content: [] },
    ]);
    expect(providerErr.error).toEqual({ kind: 'provider', message: '429 rate limit' });

    const [aborted] = normalizePiMessages([
      { role: 'assistant', timestamp: T, stopReason: 'aborted', content: [] },
    ]);
    expect(aborted.error).toEqual({ kind: 'abort', message: 'aborted' });

    // 非 error/aborted 不产 error
    const [ok] = normalizePiMessages([{ role: 'assistant', timestamp: T, stopReason: 'stop', content: [] }]);
    expect(ok.error).toBeUndefined();
  });

  // ---- live 形态：无 time.completed（step 结算单载体），id 与基础 id 一致 ----
  test('live 形态不写 time.completed（BudgetGuard step 不双计）', () => {
    const [msg] = normalizePiMessages(
      [{ role: 'assistant', timestamp: T, stopReason: 'stop', provider: 'p', model: 'm', content: [{ type: 'text', text: 'x' }] }],
      { live: true },
    );
    expect(msg.time).toEqual({ created: T });
    expect(msg.id).toBe(`pia_${T}`);
    expect(msg.content![0].id).toBe(`pia_${T}_t1`);
  });

  test('normalizePiLiveMessage：无 timestamp / 非 chat 角色 → null（不造假 id）', () => {
    expect(normalizePiLiveMessage({ role: 'assistant', content: [] })).toBeNull();
    expect(normalizePiLiveMessage({ role: 'toolResult', toolCallId: 'c', timestamp: T, content: [] })).toBeNull();
    expect(normalizePiLiveMessage({ role: 'user', content: 'hi', timestamp: T })?.id).toBe(`piu_${T}`);
  });
});
