/**
 * 场景一致性（conformance）—— runtime 插件接入的可执行验证。
 *
 * 场景评估器是纯函数（事件序列 / API 观测 → pass/fail），
 * jest 可离线测；路由层只负责驱动真实 runtime 并收集观测。
 */
export interface ObservedEvent {
  type: string;
  sessionID?: string;
  at: number;
}

export interface ScenarioDef {
  id: 'chat-roundtrip' | 'session-lifecycle';
  title: string;
  description: string;
  prompt: string;
  /** 单场景最长等待（含 LLM 往返） */
  timeoutMs: number;
  /** 该场景需要的能力（缺失 → 场景标 fail + 说明，而非崩） */
  requires: { eventStream?: boolean };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'chat-roundtrip',
    title: '对话回合（事件序）',
    description: 'promptAsync 后应观察到内容事件（part/delta/updated）且回合有终态（complete/idle/error）',
    prompt: 'Reply with the single word: OK',
    timeoutMs: 90_000,
    requires: { eventStream: true },
  },
  {
    id: 'session-lifecycle',
    title: '会话生命周期（API）',
    description: 'create → list 可见 → delete → list 不可见',
    prompt: '',
    timeoutMs: 15_000,
    requires: {},
  },
];

const CONTENT_TYPES = new Set(['message.part.updated', 'message.part.delta', 'message.updated']);
const TERMINAL_TYPES = new Set(['message.complete', 'session.idle', 'message.error', 'session.error']);

export function evaluateScenario(
  id: string,
  events: ObservedEvent[],
  apiResult?: { created: boolean; deleted: boolean },
): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  if (id === 'chat-roundtrip') {
    const content = events.filter((e) => CONTENT_TYPES.has(e.type));
    const terminal = events.filter((e) => TERMINAL_TYPES.has(e.type));
    if (content.length === 0) failures.push('no content event observed (message.part.updated/delta/message.updated) — streaming render impossible');
    if (terminal.length === 0) failures.push('no terminal event observed (message.complete/session.idle) — turn never settles, UI stays busy');
    const errored = events.some((e) => e.type === 'message.error' || e.type === 'session.error');
    if (errored) failures.push('turn ended in error state');
  } else if (id === 'session-lifecycle') {
    if (!apiResult?.created) failures.push('created session not visible in session.list');
    if (!apiResult?.deleted) failures.push('deleted session still visible in session.list (leak)');
  } else {
    failures.push(`unknown scenario '${id}'`);
  }
  return { pass: failures.length === 0, failures };
}
