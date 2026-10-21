/**
 * @v2 方言双发零双计快照 —— 设计 §6③ 验收线的可执行证明。
 *
 * 场景：一个完整回合的**真实双发序列**（2.x serve 对同一语义同时发 legacy +
 * next 两侧 + sync 信封）经 @v2 表（映射 + transform + assembler 全链）：
 *   ① 每个语义恰产一次 canonical 事件（工具 part 恰一张、permission 恰一对、
 *      compaction 恰一对、turn.completed 恰一次、message.updated 恰一次）
 *   ② 重叠 legacy 对全部落 suppressed（显式 drop 行，非 unmatched）
 *   ③ 对照：同一序列经 @v1 表——legacy 族照常消费（两表互斥性的反向证明）
 */
import { applyEventMappings } from '../../../src/runtime/event-mapper';
import {
  OPENCODE_EVENT_SOURCE,
  OPENCODE_V1_EVENT_MAPPINGS,
  OPENCODE_V2_EVENT_MAPPINGS,
  OPENCODE_TRANSFORM_EVENT,
} from '../../../src/runtime/opencode-events';
import { EVENT_FLOW_MATRIX } from '../../../src/runtime/event-flow-matrix';
import { TOOL_PRIMITIVE_TYPES, ToolPartAssembler } from '../../../src/runtime/tool-part-assembler';
import { toWireEventPayload } from '../../../src/runtime/wire-compat';

const isCanonicalAll = (t: string) => !!EVENT_FLOW_MATRIX[t] || TOOL_PRIMITIVE_TYPES.has(t);

const ENTRY_V2 = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V2_EVENT_MAPPINGS, transformEvent: OPENCODE_TRANSFORM_EVENT };
const ENTRY_V1 = { eventSource: OPENCODE_EVENT_SOURCE, eventMappings: OPENCODE_V1_EVENT_MAPPINGS, transformEvent: OPENCODE_TRANSFORM_EVENT };

/** 一个回合的真实双发序列（2.x serve：sync + legacy/next 对 + 非 next legacy + idle）。 */
const DUAL_EMISSION_SEQUENCE: Array<Record<string, unknown>> = [
  // sync 信封（runtime 原生，双发伴随）
  { directory: '/p', payload: { type: 'sync', syncEvent: { type: 'session.1', seq: 1, aggregateID: 'a' } } },
  // 用户消息：legacy message.updated（next 族无对应——非重叠，@v2 照常消费）
  { directory: '/p', payload: { type: 'message.updated', properties: { sessionID: 's1', info: { id: 'mu_1', role: 'user', sessionID: 's1', time: { created: 1 } } } } },
  // 工具调用双发对：legacy message.part.updated(tool) + next tool.called
  { directory: '/p', payload: { type: 'message.part.updated', properties: { sessionID: 's1', part: { id: 'p_tool_legacy', type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'running', input: { command: 'ls' } } } } } },
  { directory: '/p', payload: { type: 'session.next.tool.called', properties: { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c1', tool: 'bash', input: { command: 'ls' } } } },
  // 工具输入流：next tool.input.delta（legacy 侧无逐 delta 等价——非重叠）
  { directory: '/p', payload: { type: 'session.next.tool.input.delta', properties: { sessionID: 's1', callID: 'c1', delta: '{"command":"ls"}' } } },
  // 工具结果双发对：legacy message.part.updated(completed) + next tool.success
  { directory: '/p', payload: { type: 'message.part.updated', properties: { sessionID: 's1', part: { id: 'p_tool_legacy', type: 'tool', callID: 'c1', state: { status: 'completed', output: 'file.txt' } } } } },
  { directory: '/p', payload: { type: 'session.next.tool.success', properties: { sessionID: 's1', assistantMessageID: 'ma_1', callID: 'c1', content: [{ type: 'text', text: 'file.txt' }] } } },
  // 文本流双发对：legacy message.part.delta(text) + next text.delta
  { directory: '/p', payload: { type: 'message.part.delta', properties: { sessionID: 's1', partID: 'pt_1', messageID: 'ma_1', field: 'text', delta: 'hello' } } },
  { directory: '/p', payload: { type: 'session.next.text.delta', properties: { sessionID: 's1', assistantMessageID: 'ma_1', textID: 'pt_1_next', delta: 'hello' } } },
  // 审批双发对：legacy permission.asked + permission.v2.asked
  { directory: '/p', payload: { type: 'permission.asked', properties: { sessionID: 's1', permission: 'bash', patterns: ['ls'] } } },
  { directory: '/p', payload: { type: 'permission.v2.asked', properties: { sessionID: 's1', permission: 'bash', patterns: ['ls'] } } },
  { directory: '/p', payload: { type: 'permission.replied', properties: { sessionID: 's1', requestID: 'r1', reply: 'once' } } },
  { directory: '/p', payload: { type: 'permission.v2.replied', properties: { sessionID: 's1', requestID: 'r1', reply: 'once' } } },
  // 压缩双发对：legacy session.compacted + next compaction.ended
  { directory: '/p', payload: { type: 'session.compacted', properties: { sessionID: 's1' } } },
  { directory: '/p', payload: { type: 'session.next.compaction.ended', properties: { sessionID: 's1' } } },
  // 回合终态：session.idle（next 族无终态——非重叠，@v2 照常消费）
  { directory: '/p', payload: { type: 'session.idle', properties: { sessionID: 's1' } } },
];

function runPipeline(entry: typeof ENTRY_V2) {
  const suppressed: string[] = [];
  const assembler = new ToolPartAssembler({ now: () => 1000 });
  const canonical: Array<{ payload: { type: string; properties?: any } }> = [];
  for (const raw of DUAL_EMISSION_SEQUENCE) {
    const mapped = applyEventMappings(raw, entry, isCanonicalAll, { onSuppressed: (x) => suppressed.push(x) });
    for (const e of mapped) {
      // assembler 消费三原语（同 wrapToolPartAssembly 的流内序列）
      if (TOOL_PRIMITIVE_TYPES.has(e.payload.type)) {
        const p = e.payload.properties;
        if (e.payload.type === 'tool.call') canonical.push(...assembler.applyCall(p) as any);
        else if (e.payload.type === 'tool.delta') canonical.push(...assembler.applyDelta(p) as any);
        else if (e.payload.type === 'tool.result') canonical.push(...assembler.applyResult(p) as any);
      } else {
        canonical.push(e as any);
        if (e.payload.type === 'part.updated') assembler.observeAnchor(e as any);
      }
    }
  }
  return { canonical, suppressed };
}

describe('@v2 双发零双计快照（设计 §6③ 验收线）', () => {
  const { canonical, suppressed } = runPipeline(ENTRY_V2);
  const types = canonical.map((e) => e.payload.type);

  it('① 工具语义零双计：全部快照同一身份 toolpart_c1（legacy 侧 part 被 drop），终态 completed', () => {
    const toolParts = canonical.filter((e) => e.payload.type === 'part.updated' && e.payload.properties?.part?.type === 'tool');
    expect(toolParts.length).toBeGreaterThanOrEqual(1);
    // 单一身份：全部快照 id = toolpart_c1（next 侧原语渐进：running→completed）；
    // legacy 侧 p_tool_legacy 不出现（被 drop——双计即此处暴露）
    for (const e of toolParts) {
      expect(e.payload.properties.part.id).toBe('toolpart_c1');
      expect(e.payload.properties.part.callID).toBe('c1');
    }
    const finalPart = toolParts[toolParts.length - 1].payload.properties.part;
    expect(finalPart.state.status).toBe('completed');
    expect(finalPart.state.output).toBe('file.txt');
  });

  it('① permission 恰一对（v2 名侧），legacy 侧被 drop', () => {
    expect(types.filter((t) => t === 'permission.asked')).toHaveLength(1);
    expect(types.filter((t) => t === 'permission.replied')).toHaveLength(1);
    expect(suppressed).toContain('permission.asked');
    expect(suppressed).toContain('permission.replied');
  });

  it('① compaction 恰一次、message.updated 恰一次、turn.completed 恰一次', () => {
    expect(types.filter((t) => t === 'session.compacted')).toHaveLength(1);
    expect(types.filter((t) => t === 'message.updated')).toHaveLength(1);
    expect(types.filter((t) => t === 'turn.completed')).toHaveLength(1);
    expect(types.filter((t) => t === 'part.delta')).toHaveLength(1); // next 侧文本流；legacy part.delta 被 drop
  });

  it('② 重叠 legacy 全部显式 drop（suppressed 计数），sync 亦然', () => {
    for (const legacy of [
      'message.part.updated', 'message.part.delta',
      'permission.asked', 'permission.replied',
      'session.compacted', 'sync',
    ]) {
      expect(suppressed).toContain(legacy);
    }
    // @v2 下 next 族孤儿不出现（retried 等不在序列，无需断言）
  });

  it('③ 对照 @v1：同一序列 legacy 族照常消费（两表互斥性的反向证明）', () => {
    const v1 = runPipeline(ENTRY_V1);
    const v1Types = v1.canonical.map((e) => e.payload.type);
    // @v1：legacy tool part 直通（快照组）、permission/compaction/message.updated 照常
    expect(v1Types.filter((t) => t === 'permission.asked')).toHaveLength(1);
    expect(v1Types.filter((t) => t === 'session.compacted')).toHaveLength(1);
    expect(v1Types.filter((t) => t === 'message.updated')).toHaveLength(1);
    expect(v1Types.filter((t) => t === 'turn.completed')).toHaveLength(1);
    // @v1：next 族全部 drop（suppressed）
    for (const next of ['session.next.tool.called', 'session.next.tool.success', 'session.next.text.delta', 'permission.v2.asked']) {
      expect(v1.suppressed).toContain(next);
    }
  });

  it('① 补：SSE egress 后 message.updated wire 载荷为 {info}（桌面零改动闭环）', () => {
    const msg = canonical.find((e) => e.payload.type === 'message.updated')!;
    const wire = toWireEventPayload('message.updated', msg.payload.properties);
    expect(wire.info).toMatchObject({ id: 'mu_1', role: 'user' });
    expect('message' in wire).toBe(false);
  });
});
