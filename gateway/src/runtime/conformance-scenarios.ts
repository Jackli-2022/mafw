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
  id: 'chat-roundtrip' | 'session-lifecycle' | 'cognition-observe' | 'cognition-inject' | 'identity-roundtrip';
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
  {
    id: 'cognition-observe',
    title: '认知面·观察捕获（T1）',
    description: '真实回合后 T1 应有 user_input / tool_result / assistant_reply 三类观察行（宿主 observe 动词）',
    prompt: 'Use a shell command tool to list the files in the current directory, then reply with the single word DONE.',
    timeoutMs: 120_000,
    requires: { eventStream: true },
  },
  {
    id: 'cognition-inject',
    title: '认知面·注入到达（recall + memory-guide）',
    description: '边界 recall 应触达 gateway（injectContext），模型能复述 <memory-guide> 首行（injectSystem 端到端到达）',
    prompt: 'Reply with the exact first heading line that appears inside the <memory-guide> block in your system instructions. Nothing else.',
    timeoutMs: 90_000,
    requires: { eventStream: true },
  },
  {
    id: 'identity-roundtrip',
    title: '身份层·物化+策略（S5）',
    description: 'manager 身份经物化 agent 到达模型（复述身份标题）+ 网关策略层放行 allowlist 工具 / 拒绝 file-edit',
    prompt: 'Reply with the exact first line of your system instructions. Nothing else.',
    timeoutMs: 90_000,
    requires: { eventStream: true },
  },
];

const CONTENT_TYPES = new Set(['message.part.updated', 'message.part.delta', 'message.updated']);
const TERMINAL_TYPES = new Set(['message.complete', 'session.idle', 'message.error', 'session.error']);

/** S3/S4 观测：T1 观察行 + recall 触达时间 + 模型对 guide 的回声文本。 */
export interface CognitionObservation {
  sources: string[];
  recallCalledAt?: number | null;
  guideEcho?: string;
}

/** S5 观测：模型对身份标题的回声 + 网关策略层对合成候选项的判定。 */
export interface IdentityObservation {
  identityEcho?: string;
  policy: Array<{ tool: string; action: string }>;
}

export function evaluateScenario(
  id: string,
  events: ObservedEvent[],
  apiResult?: { created: boolean; deleted: boolean },
  cognition?: CognitionObservation,
  identity?: IdentityObservation,
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
  } else if (id === 'cognition-observe') {
    const sources = new Set(cognition?.sources ?? []);
    for (const need of ['user_input', 'tool_result', 'assistant_reply']) {
      if (!sources.has(need)) failures.push(`missing T1 observation source '${need}' — host observe verb not wired for this event class`);
    }
  } else if (id === 'cognition-inject') {
    if (!cognition?.recallCalledAt) failures.push('no /api/recall/context call recorded for this session — host injectContext verb not wired');
    if (!/记忆|memory-guide/i.test(cognition?.guideEcho ?? '')) failures.push('assistant reply does not echo the <memory-guide> heading — injectSystem did not reach the model');
  } else if (id === 'identity-roundtrip') {
    if (!/MAFW|MANAGER|identity/i.test(identity?.identityEcho ?? '')) {
      failures.push('assistant reply does not echo the identity heading — materialized agent did not carry the identity system prompt (lane 1 broken)');
    }
    const edit = identity?.policy.find((p) => p.tool === 'edit');
    const web = identity?.policy.find((p) => p.tool === 'webfetch');
    const bash = identity?.policy.find((p) => p.tool === 'bash');
    if (!edit || edit.action !== 'auto-deny') failures.push('policy: edit (file-edit deny) not auto-denied — identity policy dimension not wired');
    if (!web || web.action !== 'auto-deny') failures.push('policy: webfetch (not allowlisted) not auto-denied');
    if (!bash || bash.action === 'auto-deny') failures.push('policy: bash (allowlisted) wrongly denied');
  } else {
    failures.push(`unknown scenario '${id}'`);
  }
  return { pass: failures.length === 0, failures };
}
