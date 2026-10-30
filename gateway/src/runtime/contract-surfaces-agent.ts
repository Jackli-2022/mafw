/**
 * 契约面：prompt / events / tools / approval / identity / discovery /
 * mcp / cognition / media / usage。
 */
import type { ContractSurface, PresetId } from './contract-manifest-types';

const ALL: PresetId[] = ['core', 'conversation', 'autonomous', 'desktop'];
const CONV: PresetId[] = ['conversation', 'autonomous', 'desktop'];
const AUTO: PresetId[] = ['autonomous', 'desktop'];
const DESK: PresetId[] = ['desktop'];
const NONE: PresetId[] = [];

type Row = Omit<ContractSurface, 'direction'> & { direction?: ContractSurface['direction'] };

function row(p: Row): ContractSurface {
  return { direction: 'gateway->runtime', ...p } as ContractSurface;
}

export const AGENT_SURFACES: ContractSurface[] = [
  // ── prompt inputs / result ───────────────────────────────────────────
  row({
    id: 'prompt.parts.text', title: 'prompt parts (text)', domain: 'prompt',
    obligation: 'required', verification: 'presence', implementation: 'SessionPromptOpts.parts (text)',
    probe: ['session', 'prompt'], consumer: 'session prompt', impact: '回合无输入', presets: ALL,
  }),
  row({
    id: 'prompt.parts.file', title: 'prompt parts (file: image/video/audio)', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.parts (file)',
    behavior: 'prompt-parts-file', consumer: 'media attachments', impact: '媒体附件被静默丢弃', presets: DESK,
  }),
  row({
    id: 'prompt.agent', title: 'prompt.agent', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.agent',
    behavior: 'prompt-agent', consumer: 'identity binding', impact: 'per-prompt agent 不生效', presets: DESK,
  }),
  row({
    id: 'prompt.model', title: 'prompt.model', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.model',
    behavior: 'prompt-model', consumer: 'model override', impact: 'per-prompt 模型不生效', presets: DESK,
  }),
  row({
    id: 'prompt.variant', title: 'prompt.variant', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.variant',
    behavior: 'prompt-variant', consumer: 'model variant', impact: 'variant 不生效', presets: DESK,
  }),
  row({
    id: 'prompt.system', title: 'prompt.system', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.system',
    behavior: 'prompt-system', consumer: 'system override', impact: 'system 覆盖不生效', presets: DESK,
  }),
  row({
    id: 'prompt.thinkingLevel', title: 'prompt.thinkingLevel', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.thinkingLevel',
    behavior: 'prompt-thinking-level', consumer: 'reasoning effort', impact: '推理档位不生效', presets: DESK,
  }),
  row({
    id: 'prompt.delivery.steer', title: 'prompt.delivery=steer', domain: 'prompt',
    obligation: 'gated', capability: 'steerApi', verification: 'conformance',
    implementation: 'SessionPromptOpts.delivery', conformance: ['chat-roundtrip'],
    consumer: 'busy steer', impact: 'busy 纠偏退化为普通消息', presets: AUTO,
  }),
  row({
    id: 'prompt.expectReply', title: 'prompt.expectReply', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.expectReply',
    behavior: 'prompt-expect-reply', consumer: 'noReply semantics', impact: '免回复通知可能触发回复', presets: DESK,
  }),
  row({
    id: 'prompt.maxTurns', title: 'prompt.maxTurns', domain: 'prompt',
    obligation: 'gated', capability: 'turnBudgetApi', verification: 'attested',
    implementation: 'SessionPromptOpts.maxTurns', consumer: 'BudgetGuard',
    impact: '原生预算不生效；gateway BudgetGuard 兜底', presets: AUTO,
  }),
  row({
    id: 'prompt.maxCostUsd', title: 'prompt.maxCostUsd', domain: 'prompt',
    obligation: 'gated', capability: 'turnBudgetApi', verification: 'attested',
    implementation: 'SessionPromptOpts.maxCostUsd', consumer: 'BudgetGuard',
    impact: '原生预算不生效；gateway BudgetGuard 兜底', presets: AUTO,
  }),
  row({
    id: 'prompt.outputSchema', title: 'prompt.outputSchema', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'SessionPromptOpts.outputSchema',
    behavior: 'prompt-output-schema', consumer: 'structured output', impact: '结构化交卷不校验', presets: DESK,
  }),
  row({
    id: 'prompt.result.finish', title: 'prompt result.finish', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'PromptResultEnvelope.finish',
    behavior: 'prompt-result-finish', consumer: 'turn classification', impact: '终态分类缺失', presets: CONV,
  }),
  row({
    id: 'prompt.result.stopReason', title: 'prompt result.stopReason', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'PromptResultEnvelope.stopReason',
    behavior: 'prompt-result-stop-reason', consumer: 'retry/degrade', impact: '无法区分拒答/截断/预算停', presets: CONV,
  }),
  row({
    id: 'prompt.result.usage', title: 'prompt result.usage', domain: 'prompt',
    obligation: 'optional', verification: 'behavior', implementation: 'PromptResultEnvelope.usage',
    behavior: 'prompt-result-usage', consumer: 'TrajectoryStore / UsageDock', impact: '成本/用量不可见', presets: CONV,
  }),

  // ── events ───────────────────────────────────────────────────────────
  row({
    id: 'events.global', title: 'global.event', domain: 'events',
    obligation: 'required', requiredWhen: { capabilities: ['eventStream'] },
    verification: 'presence', implementation: 'global.event', probe: ['global', 'event'],
    consumer: 'event wiring', impact: '无事件流', presets: CONV,
  }),
  row({
    id: 'events.envelope', title: 'event envelope shape', domain: 'events',
    obligation: 'optional', verification: 'behavior', implementation: 'GlobalEvent { payload: { type, properties } }',
    behavior: 'event-envelope', consumer: 'normalize', impact: '事件畸形/被拦', presets: CONV,
  }),
  row({
    id: 'events.turn.terminal', title: 'turn terminal triad', domain: 'events',
    obligation: 'optional', verification: 'conformance', implementation: 'turn.completed/failed/aborted',
    conformance: ['chat-roundtrip'], consumer: 'goal driver / memory drain / UI',
    impact: 'UI 永远 busy / 回合不结算', presets: CONV,
  }),
  row({
    id: 'events.part.text', title: 'text part stream', domain: 'events',
    obligation: 'optional', verification: 'conformance', implementation: 'part.updated / part.delta (text)',
    conformance: ['chat-roundtrip'], consumer: 'ChatPane / TUI', impact: '不能流式渲染', presets: CONV,
  }),
  row({
    id: 'events.part.tool', title: 'tool part stream', domain: 'events',
    obligation: 'optional', verification: 'conformance', implementation: 'part.updated (tool part / tool primitives)',
    conformance: ['tool-visibility'], consumer: 'tool cards', impact: '工具调用不可见', presets: DESK,
  }),
  row({
    id: 'events.usage', title: 'usage.updated', domain: 'events',
    obligation: 'optional', verification: 'conformance', implementation: 'usage.updated',
    conformance: ['chat-roundtrip'], consumer: 'UsageDock', impact: '用量只靠 prompt result', presets: CONV,
  }),
  row({
    id: 'events.compaction', title: 'compaction events', domain: 'events',
    obligation: 'optional', verification: 'conformance', implementation: 'session.compacting / session.compacted',
    conformance: ['chat-roundtrip'], consumer: 'turnCompress flush', impact: '压缩 flush 延迟', presets: CONV,
  }),
  row({
    id: 'events.permission', title: 'permission events', domain: 'events',
    obligation: 'gated', capability: 'nativeApprovals', verification: 'conformance',
    implementation: 'permission.asked / permission.replied', conformance: ['chat-roundtrip'],
    consumer: 'approval cards', impact: '审批卡不出现', presets: AUTO,
  }),
  row({
    id: 'events.question', title: 'question events', domain: 'events',
    obligation: 'gated', capability: 'questionApi', verification: 'conformance',
    implementation: 'question.asked / question.replied / question.rejected', conformance: ['chat-roundtrip'],
    consumer: 'AskCard', impact: '问答卡不出现', presets: AUTO,
  }),

  // ── tools ────────────────────────────────────────────────────────────
  row({
    id: 'tools.registerTools', title: 'tools.registerTools', domain: 'tools',
    obligation: 'required', verification: 'presence', implementation: 'tools.registerTools',
    probe: ['tools', 'registerTools'], consumer: 'activateRuntimeTools', impact: '六件套无路可达模型', presets: ALL,
  }),
  row({
    id: 'tools.nativeTools', title: 'tools.nativeTools', domain: 'tools',
    obligation: 'required', verification: 'presence', implementation: 'tools.nativeTools',
    probe: ['tools', 'nativeTools'], consumer: 'tool class overlay', impact: '工具类别回退并集表', presets: ALL,
  }),
  row({
    id: 'tools.annotations', title: 'tool annotations', domain: 'tools',
    obligation: 'optional', verification: 'behavior', implementation: 'MafwToolRegistration.annotations',
    behavior: 'tool-annotations', consumer: 'approval / UI', impact: '失去风险提示', presets: DESK,
  }),
  row({
    id: 'tools.structuredResult', title: 'structured tool result', domain: 'tools',
    obligation: 'optional', verification: 'conformance', implementation: 'outputSchema / structuredContent',
    conformance: ['tool-visibility'], consumer: 'tool result', impact: '工具结果只能是文本', presets: DESK,
  }),
  row({
    id: 'tools.normalizeMessages', title: 'session.normalizeMessages', domain: 'tools',
    obligation: 'optional', verification: 'conformance', implementation: 'session.normalizeMessages',
    conformance: ['session-lifecycle'], consumer: 'history rendering', impact: '历史工具卡不渲染', presets: DESK,
  }),
  row({
    id: 'tools.outOfProcess', title: 'out-of-process tools channel', domain: 'tools', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'POST /api/tools/execute',
    conformance: ['tool-visibility'], consumer: 'out-of-process runtime', impact: '进程外 runtime 无法用六件套', presets: DESK,
  }),

  // ── approval ─────────────────────────────────────────────────────────
  row({
    id: 'approval.permissionReply', title: 'session.permissionReply', domain: 'approval',
    obligation: 'gated', capability: 'nativeApprovals', verification: 'presence',
    implementation: 'session.permissionReply', probe: ['session', 'permissionReply'],
    consumer: 'POST /api/sessions/:id/permissions/:rid', impact: '审批决定无法回传', presets: AUTO,
  }),
  row({
    id: 'approval.permissionList', title: 'session.permissionList', domain: 'approval',
    obligation: 'gated', capability: 'nativeApprovals', verification: 'presence',
    implementation: 'session.permissionList', probe: ['session', 'permissionList'],
    consumer: 'GET /api/permissions', impact: '审批轮询为空', presets: AUTO,
  }),
  row({
    id: 'approval.question', title: 'session.question', domain: 'approval',
    obligation: 'gated', capability: 'questionApi', verification: 'presence',
    implementation: 'session.question.{list,reply,reject}', probe: ['session', 'question'],
    consumer: 'question routes', impact: '结构化问答不可用', presets: AUTO,
  }),

  // ── identity ─────────────────────────────────────────────────────────
  row({
    id: 'identity.agents.install', title: 'agents.install', domain: 'identity',
    obligation: 'gated', capability: 'agentConfigApi', verification: 'presence',
    implementation: 'agents.install', probe: ['agents', 'install'],
    consumer: 'materializeIdentities', impact: 'manager/curator 不物化', presets: DESK,
  }),
  row({
    id: 'identity.agents.remove', title: 'agents.remove', domain: 'identity',
    obligation: 'gated', capability: 'agentConfigApi', verification: 'presence',
    implementation: 'agents.remove', probe: ['agents', 'remove'],
    consumer: 'identity cleanup', impact: '物化残留', presets: DESK,
  }),
  row({
    id: 'identity.prompt.agent', title: 'prompt.agent binding', domain: 'identity',
    obligation: 'optional', verification: 'conformance', implementation: 'SessionPromptOpts.agent',
    conformance: ['identity-roundtrip'], consumer: 'identity binding', impact: '身份选择不生效', presets: DESK,
  }),

  // ── discovery ────────────────────────────────────────────────────────
  row({
    id: 'discovery.list', title: 'discovery.list', domain: 'discovery',
    obligation: 'gated', capability: 'discoveryApi', verification: 'presence',
    implementation: 'discovery.list', probe: ['discovery', 'list'],
    consumer: 'DiscoveryService', impact: '命令/技能目录不可见', presets: DESK,
  }),
  row({
    id: 'discovery.loadSkill', title: 'discovery.loadSkill', domain: 'discovery',
    obligation: 'gated', capability: 'discoveryApi', verification: 'presence',
    implementation: 'discovery.loadSkill', probe: ['discovery', 'loadSkill'],
    consumer: 'skill content route', impact: '技能正文不可读', presets: DESK,
  }),

  // ── mcp ──────────────────────────────────────────────────────────────
  row({
    id: 'mcp.list', title: 'mcp.list', domain: 'mcp',
    obligation: 'gated', capability: 'mcpApi', verification: 'presence',
    implementation: 'mcp.list', probe: ['mcp', 'list'],
    consumer: 'GET /api/mcp/servers', impact: 'MCP 状态不可见', presets: DESK,
  }),
  row({
    id: 'mcp.connect', title: 'mcp.connect', domain: 'mcp',
    obligation: 'gated', capability: 'mcpApi', verification: 'presence',
    implementation: 'mcp.connect', probe: ['mcp', 'connect'],
    consumer: 'POST /api/mcp/:name/connect', impact: 'MCP 连接不可用', presets: DESK,
  }),
  row({
    id: 'mcp.disconnect', title: 'mcp.disconnect', domain: 'mcp',
    obligation: 'gated', capability: 'mcpApi', verification: 'presence',
    implementation: 'mcp.disconnect', probe: ['mcp', 'disconnect'],
    consumer: 'POST /api/mcp/:name/disconnect', impact: 'MCP 断开不可用', presets: DESK,
  }),
  row({
    id: 'mcp.config.preview', title: 'mcp.config.preview', domain: 'mcp',
    obligation: 'gated', capability: 'mcpConfigApi', verification: 'presence',
    implementation: 'mcp.config.preview', probe: ['mcp', 'config', 'preview'],
    consumer: 'POST /api/mcp/config/preview', impact: 'MCP 配置预览不可用', presets: DESK,
  }),
  row({
    id: 'mcp.config.apply', title: 'mcp.config.apply', domain: 'mcp',
    obligation: 'gated', capability: 'mcpConfigApi', verification: 'presence',
    implementation: 'mcp.config.apply', probe: ['mcp', 'config', 'apply'],
    consumer: 'POST /api/mcp/config/apply', impact: 'MCP 配置写入不可用', presets: DESK,
  }),
  row({
    id: 'mcp.config.remove', title: 'mcp.config.remove', domain: 'mcp',
    obligation: 'gated', capability: 'mcpConfigApi', verification: 'presence',
    implementation: 'mcp.config.remove', probe: ['mcp', 'config', 'remove'],
    consumer: 'DELETE /api/mcp/config/servers/:name', impact: 'MCP 配置删除不可用', presets: DESK,
  }),
  row({
    id: 'mcp.config.restore', title: 'mcp.config.restore', domain: 'mcp',
    obligation: 'gated', capability: 'mcpConfigApi', verification: 'presence',
    implementation: 'mcp.config.restore', probe: ['mcp', 'config', 'restore'],
    consumer: 'POST /api/mcp/config/restore', impact: 'MCP 配置恢复不可用', presets: DESK,
  }),

  // ── cognition（runtime -> gateway）────────────────────────────────────
  row({
    id: 'cognition.observe', title: 'observe', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'POST /api/obs/capture',
    conformance: ['cognition-observe'], consumer: 'TurnPipeline', impact: '记忆蒸馏空转', presets: CONV,
  }),
  row({
    id: 'cognition.injectContext', title: 'injectContext', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'GET /api/recall/context',
    conformance: ['cognition-inject'], consumer: 'boundary recall', impact: 'recall 不注入', presets: CONV,
  }),
  row({
    id: 'cognition.injectSystem', title: 'injectSystem', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'GET /api/recall/pinned + memory-guide',
    conformance: ['cognition-inject'], consumer: 'system transform', impact: 'pinned/guide 不到模型', presets: CONV,
  }),
  row({
    id: 'cognition.tools', title: 'cognition tools', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance',
    implementation: 'POST /api/memory/add /api/python/* /api/tts /a2a',
    conformance: ['tool-visibility'], consumer: 'agent tools', impact: '六件套不可达', presets: CONV,
  }),
  row({
    id: 'cognition.gate', title: 'gate', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'POST /api/cognition/gate',
    conformance: ['cognition-observe'], consumer: 'cognition gate', impact: '无工具前门控', presets: NONE,
  }),
  row({
    id: 'cognition.rewrite', title: 'rewrite', domain: 'cognition', direction: 'runtime->gateway',
    obligation: 'optional', verification: 'conformance', implementation: 'POST /api/cognition/rewrite',
    conformance: ['cognition-observe'], consumer: 'tool output rewrite', impact: '无输出改写', presets: NONE,
  }),

  // ── media / usage ────────────────────────────────────────────────────
  row({
    id: 'media.tools', title: 'mafw_media_* via registerTools', domain: 'media',
    obligation: 'optional', verification: 'conformance', implementation: 'mafw_media_* via registerTools',
    conformance: ['tool-visibility'], consumer: 'media agent', impact: '媒体工具不可达', presets: DESK,
  }),
  row({
    id: 'usage.prompt', title: 'prompt usage', domain: 'usage',
    obligation: 'optional', verification: 'behavior', implementation: 'PromptResultEnvelope.usage',
    behavior: 'usage-prompt', consumer: 'TrajectoryStore', impact: '成本/用量不可见', presets: CONV,
  }),
  row({
    id: 'usage.event', title: 'usage.updated event', domain: 'usage',
    obligation: 'optional', verification: 'conformance', implementation: 'usage.updated',
    conformance: ['chat-roundtrip'], consumer: 'UsageDock', impact: '用量事件缺失', presets: CONV,
  }),
];
