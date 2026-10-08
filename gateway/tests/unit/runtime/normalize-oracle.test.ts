import { normalizeOpencodeEvent, EventFacets } from '../../../src/runtime/normalize';

// —— oracle：重构前 normalizeOpencodeEvent 的逐字拷贝（2026-10-08 版本）——
function legacyNormalizeForOracle(evt: any): EventFacets {
  const payload = evt?.payload || {};
  const type = payload?.type || evt?.type || '';
  const props = payload?.properties || evt?.properties || {};
  const sessionID =
    props?.sessionID || props?.part?.sessionID || props?.info?.sessionID || payload?.sessionID || evt?.sessionID;
  let step: any = null;
  if (type === 'session.next.step.ended' && sessionID) {
    step = { sessionID, assistantMessageID: props?.assistantMessageID, finish: props?.finish };
  } else if (type === 'message.part.updated') {
    const part = props?.part;
    if (part && part.type === 'step-finish') step = { sessionID: part.sessionID, assistantMessageID: part.messageID, finish: part.reason };
  } else if (type === 'message.updated') {
    const info = props?.info;
    if (info && info.role === 'assistant' && info.time?.completed) step = { sessionID: info.sessionID, assistantMessageID: info.id, finish: info.finish };
  }
  let chatSignal: any = null;
  let deltaText: string | undefined;
  let chatError: unknown;
  if (type === 'message.part.updated') {
    const text = props?.part?.text || props?.delta || '';
    if (text) { deltaText = text; chatSignal = 'delta'; }
  } else if (type === 'session.idle' || type === 'message.updated') {
    chatSignal = 'complete';
  } else if (type === 'session.error' || type === 'message.error') {
    chatSignal = 'error'; chatError = props?.error || 'Unknown error';
  }
  const broadcast: any = type === 'session.idle' ? 'idle' : type === 'session.error' ? 'error' : 'passthrough';
  const toolArgs = props?.args || props?.info?.args || payload?.args;
  const command = typeof toolArgs?.command === 'string' ? toolArgs.command : '';
  const toolCommand = command && type.includes('tool') ? command : undefined;
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
  return { type, properties: props, sessionID, directory: evt?.directory, step, chatSignal, deltaText, chatError, broadcast, compaction, toolCommand, approval };
}

// —— fixture 语料：每条 facet 路径 + 边界样本 ——
const FIXTURES: Array<[string, any]> = [
  ['legacy step.ended', { payload: { type: 'session.next.step.ended', properties: { sessionID: 's1', assistantMessageID: 'm1', finish: 'stop' } } }],
  ['legacy step.ended 无 sid', { payload: { type: 'session.next.step.ended', properties: {} } }],
  ['step-finish part', { payload: { type: 'message.part.updated', properties: { part: { type: 'step-finish', sessionID: 's1', messageID: 'm1', reason: 'stop' } } } }],
  ['step-finish part 缺 part.sessionID', { payload: { type: 'message.part.updated', properties: { part: { type: 'step-finish', messageID: 'm1' } } } }],
  ['text part', { payload: { type: 'message.part.updated', properties: { part: { type: 'text', sessionID: 's1', text: 'hello' } } } }],
  ['text part 空串 + delta 回退', { payload: { type: 'message.part.updated', properties: { part: { type: 'text', text: '' }, delta: 'd' } } }],
  ['part.updated 无文本', { payload: { type: 'message.part.updated', properties: { part: { type: 'tool-call', sessionID: 's1' } } } }],
  ['completed assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', time: { completed: 1 }, sessionID: 's1', id: 'm1', finish: 'stop' } } } }],
  ['incomplete assistant', { payload: { type: 'message.updated', properties: { info: { role: 'assistant', sessionID: 's1', id: 'm1' } } } }],
  ['user message.updated', { payload: { type: 'message.updated', properties: { info: { role: 'user', sessionID: 's1' } } } }],
  ['session.idle', { payload: { type: 'session.idle', properties: { sessionID: 's1' } } }],
  ['session.error', { payload: { type: 'session.error', properties: { sessionID: 's1', error: 'boom' } } }],
  ['session.error 无 error', { payload: { type: 'session.error', properties: { sessionID: 's1' } } }],
  ['message.error', { payload: { type: 'message.error', properties: { sessionID: 's1', error: 'x' } } }],
  ['compacting', { payload: { type: 'session.compacting', properties: { sessionID: 's1' } } }],
  ['compacted', { payload: { type: 'session.compacted', properties: { sessionID: 's1' } } }],
  ['tool command（type includes tool）', { payload: { type: 'session.next.tool.executed', properties: { sessionID: 's1', args: { command: 'npm test' } } } }],
  ['非 tool 类型带 command 不提取', { payload: { type: 'message.updated', properties: { sessionID: 's1', args: { command: 'x' }, info: { role: 'user' } } } }],
  ['payload.args 路径', { payload: { type: 'tool.call', args: { command: 'ls' }, properties: {} } }],
  ['permission.asked opencode 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', id: 'r1', permission: 'bash', patterns: ['git *'] } } }],
  ['permission.asked pi 形状', { payload: { type: 'permission.asked', properties: { sessionID: 's1', requestId: 'r2', toolName: 'edit', args: { f: 1 }, risk: 'low' } } }],
  ['permission.asked 畸形', { payload: { type: 'permission.asked', properties: { sessionID: 's1' } } }],
  ['permission.asked 无 sid', { payload: { type: 'permission.asked', properties: { id: 'r3', permission: 'bash' } } }],
  ['passthrough 类型', { payload: { type: 'session.created', properties: { info: { id: 's1', title: 't' } } } }],
  ['裸事件（无 payload 信封）', { type: 'session.idle', properties: { sessionID: 's1' } }],
  ['裸事件 + 顶层 sessionID', { type: 'session.idle', sessionID: 's9' }],
  ['空 type', { payload: { properties: {} } }],
  ['directory 透传', { directory: '/proj', payload: { type: 'session.updated', properties: { sessionID: 's1' } } }],
];

describe('oracle: table-driven ≡ legacy if-chain', () => {
  test.each(FIXTURES)('%s', (_name, evt) => {
    expect(normalizeOpencodeEvent(evt)).toEqual(legacyNormalizeForOracle(evt));
  });
});
