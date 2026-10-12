import { ToolPartAssembler, coerceOutput, TOOL_PRIMITIVE_TYPES } from '../../../src/runtime/tool-part-assembler';

const NOW = 1_700_000_000_000;
const mk = () => new ToolPartAssembler({ now: () => NOW });

function partOf(evts: any[]) {
  return evts[evts.length - 1]?.payload?.properties?.part;
}

describe('coerceOutput', () => {
  test('string 原样 / undefined 空串', () => {
    expect(coerceOutput('x')).toBe('x');
    expect(coerceOutput(undefined)).toBe('');
  });
  test('content-block 数组拼接 text，忽略非文本块', () => {
    expect(coerceOutput([{ type: 'text', text: 'a' }, { type: 'image', data: '...' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
  test('对象 JSON 化', () => {
    expect(coerceOutput({ ok: 1 })).toBe('{"ok":1}');
  });
});

describe('ToolPartAssembler', () => {
  test('三原语类型集', () => {
    expect([...TOOL_PRIMITIVE_TYPES].sort()).toEqual(['tool.call', 'tool.delta', 'tool.result']);
  });

  test('call 带 input → running 快照，id = toolpart_<callID>', () => {
    const a = mk();
    const evts = a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } });
    const part = partOf(evts);
    expect(part.id).toBe('toolpart_c1');
    expect(part.type).toBe('tool');
    expect(part.tool).toBe('bash');
    expect(part.callID).toBe('c1');
    expect(part.sessionID).toBe('s1');
    expect(part.state.status).toBe('running');
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.time.start).toBe(NOW);
  });

  test('call 无 input → pending', () => {
    const a = mk();
    const part = partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' }));
    expect(part.state.status).toBe('pending');
  });

  test('input delta 累积 raw 并增量 parse', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' });
    let evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'input', text: '{"comm' });
    expect(partOf(evts).state.status).toBe('pending');
    evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'input', text: 'and":"ls"}' });
    const part = partOf(evts);
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.status).toBe('running');
  });

  test('output delta 推进 running 但不产帧（默认关）', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash' });
    const evts = a.applyDelta({ sessionID: 's1', callID: 'c1', kind: 'output', text: 'chunk' });
    expect(evts).toHaveLength(0);
  });

  test('result completed → output/title/time.end', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: { command: 'ls' } });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'file.txt' }));
    expect(part.state.status).toBe('completed');
    expect(part.state.output).toBe('file.txt');
    expect(part.state.input).toEqual({ command: 'ls' });
    expect(part.state.time.end).toBe(NOW);
  });

  test('result isError → error 状态', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'boom', isError: true }));
    expect(part.state.status).toBe('error');
    expect(part.state.error).toBe('boom');
  });

  test('result 无先序 call → 合成终态（tool/input 回填）', () => {
    const a = mk();
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'cx', tool: 'read', input: { filePath: '/a' }, output: 'data' }));
    expect(part.id).toBe('toolpart_cx');
    expect(part.tool).toBe('read');
    expect(part.state.status).toBe('completed');
    expect(part.state.input).toEqual({ filePath: '/a' });
  });

  test('重复 result 后者覆盖（幂等快照语义）', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    a.applyResult({ sessionID: 's1', callID: 'c1', output: 'first' });
    const part = partOf(a.applyResult({ sessionID: 's1', callID: 'c1', output: 'second' }));
    expect(part.state.output).toBe('second');
  });

  test('缺 callID → 生成 id，不抛', () => {
    const a = mk();
    const part = partOf(a.applyCall({ sessionID: 's1', callID: '', tool: 'bash' }));
    expect(part.id).toMatch(/^toolpart_/);
  });

  test('无锚点 → 合成 assistant 消息（每 session 只发一次）+ part 挂其下', () => {
    const a = mk();
    const evts = a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    expect(evts[0].payload.type).toBe('message.updated');
    expect(evts[0].payload.properties.info.role).toBe('assistant');
    const partMsgId = partOf(evts).messageID;
    expect(partMsgId).toBe(evts[0].payload.properties.info.id);
    const evts2 = a.applyCall({ sessionID: 's1', callID: 'c2', tool: 'bash', input: {} });
    expect(evts2.every((e) => e.payload.type === 'message.part.updated')).toBe(true);
    expect(partOf(evts2).messageID).toBe(partMsgId);
  });

  test('observeAnchor 从过路事件学真实 messageID 后优先使用', () => {
    const a = mk();
    a.observeAnchor({ payload: { type: 'message.part.updated', properties: { part: { id: 'p9', messageID: 'm9', type: 'text' } } }, sessionID: 's1' } as any);
    const part = partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} }));
    expect(part.messageID).toBe('m9');
  });

  test('message.updated(assistant) 也供锚点', () => {
    const a = mk();
    a.observeAnchor({ payload: { type: 'message.updated', properties: { info: { id: 'a7', role: 'assistant' } } }, sessionID: 's1' } as any);
    expect(partOf(a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} })).messageID).toBe('a7');
  });

  test('dropSession 清理后锚点/工作区重置', () => {
    const a = mk();
    a.applyCall({ sessionID: 's1', callID: 'c1', tool: 'bash', input: {} });
    a.dropSession('s1');
    const evts = a.applyCall({ sessionID: 's1', callID: 'c2', tool: 'bash', input: {} });
    expect(evts[0].payload.type).toBe('message.updated');
  });
});
