import { normalizeOpencodeEvent, EventFacets } from '../../../src/runtime/normalize';

// —— oracle v2：MAFW 词汇的**手写参照实现**（与表驱动版独立成文）——
// 2026-10-12 v2 语义：turn 三元组终态；broadcast 切面删除；toolCommand 载体
// 迁到 tool part 快照；session.next.* legacy 载体除名。表驱动 canonical-facets.ts
// 的输出必须与这里的 if 链逐点相等——两边独立演进时此测试是语义漂移探测器。
function v2ReferenceNormalize(evt: any): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;

  // step 双载体（legacy session.next.step.ended 载体已随词汇 v2 除名）
  let step: any = null;
  if (type === 'part.updated') {
    const part = props?.part;
    if (part && part.type === 'step-finish') step = { sessionID: part.sessionID, assistantMessageID: part.messageID, finish: part.reason };
  } else if (type === 'message.updated') {
    const info = props?.info;
    if (info && info.role === 'assistant' && info.time?.completed) step = { sessionID: info.sessionID, assistantMessageID: info.id, finish: info.finish };
  }

  // chatSignal（delta 双路径：part.text 优先）
  let chatSignal: any = null;
  let deltaText: string | undefined;
  let chatError: unknown;
  if (type === 'part.updated') {
    const text = props?.part?.text || props?.delta || '';
    if (text) { deltaText = text; chatSignal = 'delta'; }
  } else if (type === 'turn.completed' || type === 'message.updated') {
    chatSignal = 'complete';
  } else if (type === 'turn.failed') {
    chatSignal = 'error'; chatError = props?.error || 'Unknown error';
  }

  // toolCommand：v2 载体 = tool part 快照 state.input.command
  const toolPart = type === 'part.updated' ? props?.part : undefined;
  const toolCommand = toolPart && toolPart.type === 'tool' && typeof toolPart?.state?.input?.command === 'string' && toolPart.state.input.command
    ? toolPart.state.input.command
    : undefined;

  const compaction: any = type === 'session.compacting' ? 'start' : type === 'session.compacted' ? 'end' : null;

  let approval: any = null;
  if (type === 'permission.asked' && sessionID) {
    const requestId = props?.requestId ?? props?.id;
    const toolName = props?.permission ?? props?.toolName;
    if (requestId && toolName) {
      approval = {
        requestId: String(requestId), toolName: String(toolName),
        patterns: Array.isArray(props?.patterns) ? props.patterns : [],
        metadata: props?.metadata ?? (props?.args !== undefined || props?.risk !== undefined ? { args: props?.args, risk: props?.risk } : undefined),
      };
    }
  }

  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, compaction, toolCommand, approval };
}

// —— fixture 语料：每条 facet 路径 + 边界样本（v2 词汇） ——
const FIXTURES: Array<[string, any]> = [
  ['step-finish part', { payload: { type: 'part.updated', properties: { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } } } }],
  ['step-finish part 缺 part.sessionID', { payload: { type: 'part.updated', properties: { part: { type: 'step-finish', messageID: 'm1' } } } }],
  ['legacy step.ended 已除名（不产 step）', { payload: { type: 'session.next.step.ended', properties: { sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' } } }],
  ['text part', { payload: { type: 'part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } } }],
  ['text part 空串 + delta 回退', { payload: { type: 'part.updated', properties: { part: { type: 'text', text: '' }, delta: 'd' } } }],
  ['part.updated 无文本', { payload: { type: 'part.updated', properties: { part: { type: 'tool-call', sessionID: 's1' } } } }],
  ['completed assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } } } }],
  ['incomplete assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', sessionID: 's1', id: 'm1' } } } }],
  ['user message.updated', { payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's1' } } } }],
  ['turn.completed', { payload: { type: 'turn.completed', properties: { sessionID: 's1' } } }],
  ['turn.failed', { payload: { type: 'turn.failed', properties: { sessionID: 's1', error: 'boom' } } }],
  ['turn.failed 无 error', { payload: { type: 'turn.failed', properties: { sessionID: 's1' } } }],
  ['turn.aborted（无 chatSignal，保旧 message.aborted）', { payload: { type: 'turn.aborted', properties: { sessionID: 's1' } } }],
  ['compacting', { payload: { type: 'session.compacting', properties: { sessionID: 's1' } } }],
  ['compacted', { payload: { type: 'session.compacted', properties: { sessionID: 's1' } } }],
  ['tool part 快照（toolCommand 新载体）', { payload: { type: 'part.updated', properties: { part: { type: 'tool', sessionID: 's1', tool: 'bash', state: { status: 'running', input: { command: 'npm test' } } } } }],
  ['tool part 无 command', { payload: { type: 'part.updated', properties: { part: { type: 'tool', sessionID: 's1', state: { status: 'pending' } } } }],
  ['非 tool part 带 command 形状不提取', { payload: { type: 'message.updated', properties: { sessionID: 's1', args: { command: 'x' }, info: { role: 'user' } } } }],
  ['text part 带 args.command 不提取', { payload: { type: 'part.updated', properties: { part: { type: 'text', text: 'hi' }, args: { command: 'x' } } } }],
  ['permission.asked opencode 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', id: 'r1', permission: 'bash', patterns: ['git *'] } } }],
  ['permission.asked pi 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'low' } } }],
  ['permission.asked v2 可选字段透传（options/suggestedRule 不进 facet）', { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r5', toolName: 'bash', options: ['once', 'always'], suggestedRule: 'bash npm *' } } }],
  ['permission.asked 畸形', { payload: { type: 'permission.asked', properties: { sessionID: 's1' } } }],
  ['permission.asked 无 sid', { payload: { type: 'permission.asked', properties: { id: 'r3', permission: 'bash' } } }],
  ['passthrough 类型', { payload: { type: 'session.created', properties: { info: { id: 's1', title: 't' } } } }],
  ['裸事件（无 payload 信封）', { type: 'turn.completed', properties: { sessionID: 's1' } }],
  ['裸事件 + 顶层 sessionID', { type: 'turn.completed', sessionID: 's9' }],
  ['空 type', { payload: { properties: {} } }],
  ['directory 透传', { directory: '/proj', payload: { type: 'session.updated', properties: { sessionID: 's1' } } }],
];

describe('oracle v2: table-driven ≡ hand-written reference', () => {
  test.each(FIXTURES)('%s', (_name, evt) => {
    expect(normalizeOpencodeEvent(evt)).toEqual(v2ReferenceNormalize(evt));
  });
});
