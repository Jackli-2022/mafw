/**
 * 能力位清单：一个 RuntimeCapabilities key 一条。
 *
 * `requires` 是降级判定（缺任一 → 能力降级）；`unlocks` 只做展示/覆盖率。
 * 这是 validate.ts 里旧 CAPABILITY_REQUIREMENTS 的清单化版本。
 */
import type { ContractCapability } from './contract-manifest-types';

const cap = (p: ContractCapability): ContractCapability => ({ degradeRule: 'any-requires-missing', ...p });

const SESSION_CORE = [
  'session.create', 'session.promptAsync', 'session.prompt', 'session.messages', 'session.get',
  'session.delete', 'session.abort', 'session.list', 'session.todo', 'session.children', 'session.summarize',
];

export const CONTRACT_CAPABILITIES: ContractCapability[] = [
  cap({
    id: 'sessionApi', title: 'session API', domain: 'session', kind: 'feature', default: true,
    requires: SESSION_CORE, unlocks: SESSION_CORE,
    degrade: '会话/回合 API 不可用',
  }),
  cap({
    id: 'promptWhileBusy', title: 'prompt while busy', domain: 'session', kind: 'feature', default: true,
    requires: ['session.promptAsync'], unlocks: ['session.promptAsync', 'cognition.injectContext'],
    degrade: '步进注入/续聊降级',
  }),
  cap({
    id: 'eventStream', title: 'event stream', domain: 'events', kind: 'feature', default: false,
    requires: [], unlocks: [
      'plugin.eventSource', 'plugin.eventMappings', 'plugin.transformEvent',
      'events.global', 'events.envelope', 'events.turn.terminal', 'events.part.text',
      'events.part.tool', 'events.usage', 'events.compaction',
    ],
    degrade: '跳过事件订阅；无自治触发/流式 UI',
  }),
  cap({
    id: 'nativeApprovals', title: 'native approvals', domain: 'approval', kind: 'feature', default: false,
    requires: ['approval.permissionReply'],
    unlocks: ['approval.permissionReply', 'approval.permissionList', 'events.permission'],
    degrade: '审批端点 503；桌面审批卡不出现',
  }),
  cap({
    id: 'providerConfigApi', title: 'provider/config API', domain: 'provider', kind: 'feature', default: false,
    requires: ['provider.list', 'provider.app.agents', 'provider.config', 'provider.config.update'],
    unlocks: ['provider.list', 'provider.app.agents', 'provider.config', 'provider.config.update'],
    degrade: 'provider/设置端点 503',
  }),
  cap({
    id: 'perLlmCallTransform', title: 'per-LLM-call transform (informational)', domain: 'prompt', kind: 'informational', default: false,
    requires: [], unlocks: [], degrade: '信息性声明；gateway 不消费',
  }),
  cap({
    id: 'sessionStorageApi', title: 'session storage direct read', domain: 'session', kind: 'strategy', default: false,
    requires: ['session.listByDirectory'], unlocks: ['session.listByDirectory'],
    degrade: '回退 session.list + 客户端过滤',
  }),
  cap({
    id: 'agentConfigApi', title: 'agent definition install', domain: 'identity', kind: 'strategy', default: false,
    requires: ['identity.agents.install'],
    unlocks: ['identity.agents.install', 'identity.agents.remove'],
    degrade: '身份物化跳过（车道 2/3 日志）',
  }),
  cap({
    id: 'agentProcessApi', title: 'agent process lifecycle', domain: 'process', kind: 'feature', default: false,
    requires: ['process.restart'],
    unlocks: ['process.restart', 'process.spawnServe', 'process.killServe'],
    degrade: '自监管/server 拉起不可用',
  }),
  cap({
    id: 'completionApi', title: 'stateless completion', domain: 'process', kind: 'feature', default: false,
    requires: ['process.completion'], unlocks: ['process.completion'],
    degrade: 'index-scan/media 无状态通道降级',
  }),
  cap({
    id: 'sessionBranchApi', title: 'session fork/revert', domain: 'branch', kind: 'feature', default: false,
    requires: ['branch.fork', 'branch.revert'],
    unlocks: ['branch.fork', 'branch.revert'],
    degrade: '时间线/分叉/回滚不可用',
  }),
  cap({
    id: 'revertUndoApi', title: 'revert undo', domain: 'branch', kind: 'feature', default: false,
    requires: ['branch.unrevert'], unlocks: ['branch.unrevert'],
    degrade: '回滚不可撤销',
  }),
  cap({
    id: 'checkpointApi', title: 'checkpoint snapshot', domain: 'branch', kind: 'feature', default: false,
    requires: [], unlocks: ['branch.checkpoint'],
    degrade: '自动/手动检查点不可用',
    degradeRule: 'none',
  }),
  cap({
    id: 'runStateApi', title: 'turn soft suspend', domain: 'branch', kind: 'feature', default: false,
    requires: [], unlocks: ['branch.runState'],
    degrade: '回合软暂停不可用',
    degradeRule: 'none',
  }),
  cap({
    id: 'turnBudgetApi', title: 'native turn budget', domain: 'prompt', kind: 'trust', default: false,
    requires: [], unlocks: ['prompt.maxTurns', 'prompt.maxCostUsd'],
    degrade: 'BudgetGuard 兜底；声明为信任项，覆盖率标 unverified',
    degradeRule: 'none',
  }),
  cap({
    id: 'questionApi', title: 'native question API', domain: 'approval', kind: 'feature', default: false,
    requires: ['approval.question.list', 'approval.question.reply', 'approval.question.reject'],
    unlocks: ['approval.question.list', 'approval.question.reply', 'approval.question.reject', 'events.question'],
    degrade: '结构化问答 503',
  }),
  cap({
    id: 'diffApi', title: 'session diff / vcs apply', domain: 'branch', kind: 'feature', default: false,
    requires: ['branch.diff', 'branch.vcs'], unlocks: ['branch.diff', 'branch.vcs'],
    degrade: '审阅改动/工作区 patch 不可用',
  }),
  cap({
    id: 'worktreeApi', title: 'directory-scoped sessions', domain: 'session', kind: 'feature', default: false,
    requires: ['session.worktree'], unlocks: ['session.worktree'],
    degrade: 'worktree 并行隔离失效',
  }),
  cap({
    id: 'instructionsApi', title: 'per-session instruction entries', domain: 'session', kind: 'transport', default: false,
    requires: ['session.instructions.list', 'session.instructions.put', 'session.instructions.remove'],
    unlocks: ['session.instructions.list', 'session.instructions.put', 'session.instructions.remove'],
    degrade: '指令分段/压缩免疫不可用',
  }),
  cap({
    id: 'discoveryApi', title: 'command/skill discovery', domain: 'discovery', kind: 'feature', default: false,
    requires: ['discovery.list', 'discovery.loadSkill'],
    unlocks: ['discovery.list', 'discovery.loadSkill'],
    degrade: '命令/技能目录不可见',
  }),
  cap({
    id: 'mcpApi', title: 'MCP runtime management', domain: 'mcp', kind: 'feature', default: false,
    requires: ['mcp.list', 'mcp.connect', 'mcp.disconnect'],
    unlocks: ['mcp.list', 'mcp.connect', 'mcp.disconnect'],
    degrade: 'MCP 运行时管理不可用',
  }),
  cap({
    id: 'mcpConfigApi', title: 'MCP config persistence', domain: 'mcp', kind: 'strategy', default: false,
    requires: ['mcp.config.preview', 'mcp.config.apply', 'mcp.config.remove', 'mcp.config.restore'],
    unlocks: ['mcp.config.preview', 'mcp.config.apply', 'mcp.config.remove', 'mcp.config.restore'],
    degrade: 'MCP 配置写入不可用',
  }),
  cap({
    id: 'steerApi', title: 'steer delivery', domain: 'prompt', kind: 'transport', default: false,
    requires: ['prompt.delivery.steer'], unlocks: ['prompt.delivery.steer'],
    degrade: 'steer 退化为普通消息',
  }),
];
