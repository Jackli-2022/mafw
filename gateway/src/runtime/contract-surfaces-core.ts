/**
 * 契约面：meta / session / branch / process / provider。
 *
 * 每行一个可独立验证的面；`presets` 是 ContractPreset.requiredSurfaces 的
 * 反向索引（Task 4 会做双向一致性校验）。
 */
import type { ContractSurface, PresetId } from './contract-manifest-types';

const ALL: PresetId[] = ['core', 'conversation', 'autonomous', 'desktop'];
const CONV: PresetId[] = ['conversation', 'autonomous', 'desktop'];
const DESK: PresetId[] = ['desktop'];
const NONE: PresetId[] = [];

type Row = Omit<ContractSurface, 'direction'> & { direction?: ContractSurface['direction'] };

function row(p: Row): ContractSurface {
  return { direction: 'gateway->runtime', ...p } as ContractSurface;
}

export const CORE_SURFACES: ContractSurface[] = [
  // ── meta / declaration ────────────────────────────────────────────────
  row({
    id: 'plugin.name', title: 'module.exports.name', direction: 'declaration', domain: 'meta',
    obligation: 'required', verification: 'presence', implementation: 'module.exports.name',
    probe: ['plugin', 'name'], consumer: 'RuntimePluginLoader.scan', impact: '插件被 loader 拒绝', presets: ALL,
  }),
  row({
    id: 'plugin.createRuntime', title: 'module.exports.createRuntime', direction: 'declaration', domain: 'meta',
    obligation: 'required', verification: 'presence', implementation: 'module.exports.createRuntime',
    probe: ['plugin', 'createRuntime'], consumer: 'activatePluginRuntime', impact: '插件无法创建 runtime', presets: ALL,
  }),
  row({
    id: 'plugin.capabilities', title: 'module.exports.capabilities', direction: 'declaration', domain: 'meta',
    obligation: 'required', verification: 'presence', implementation: 'module.exports.capabilities',
    probe: ['plugin', 'capabilities'], consumer: 'loader/validate', impact: '能力按 minimal 默认，功能大幅缩水', presets: ALL,
  }),
  row({
    id: 'plugin.eventSource', title: 'module.exports.eventSource', direction: 'declaration', domain: 'meta',
    obligation: 'gated', capability: 'eventStream', verification: 'presence',
    implementation: 'module.exports.eventSource', probe: ['declaration', 'eventSource'],
    consumer: 'wrapGlobalEventStream', impact: '无法解析原生事件类型', presets: CONV,
  }),
  row({
    id: 'plugin.eventMappings', title: 'module.exports.eventMappings', direction: 'declaration', domain: 'meta',
    obligation: 'gated', capability: 'eventStream', verification: 'presence',
    implementation: 'module.exports.eventMappings', probe: ['declaration', 'eventMappings'],
    consumer: 'applyEventMappings', impact: 'default-deny 拦截原生事件流', presets: CONV,
  }),
  row({
    id: 'plugin.transformEvent', title: 'module.exports.transformEvent', direction: 'declaration', domain: 'meta',
    obligation: 'gated', capability: 'eventStream', verification: 'presence',
    implementation: 'module.exports.transformEvent', probe: ['declaration', 'transformEvent'],
    consumer: 'applyEventMappings', impact: '无 1→N / 状态机逃逸', presets: CONV,
  }),

  // ── session core（11 个 required）─────────────────────────────────────
  row({
    id: 'session.create', title: 'session.create', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.create',
    probe: ['session', 'create'], consumer: 'POST /api/session', impact: '无法创建会话', presets: ALL,
  }),
  row({
    id: 'session.promptAsync', title: 'session.promptAsync', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.promptAsync',
    probe: ['session', 'promptAsync'], consumer: 'POST /api/session/:id/promptAsync', impact: '无法发送回合', presets: ALL,
  }),
  row({
    id: 'session.prompt', title: 'session.prompt', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.prompt',
    probe: ['session', 'prompt'], consumer: 'goal driver / media', impact: '无同步回合', presets: ALL,
  }),
  row({
    id: 'session.messages', title: 'session.messages', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.messages',
    probe: ['session', 'messages'], consumer: 'GET /api/sessions/:id/messages', impact: '历史不可读', presets: ALL,
  }),
  row({
    id: 'session.get', title: 'session.get', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.get',
    probe: ['session', 'get'], consumer: 'GET /api/sessions/:id', impact: '会话详情不可读', presets: ALL,
  }),
  row({
    id: 'session.delete', title: 'session.delete', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.delete',
    probe: ['session', 'delete'], consumer: 'DELETE /api/sessions/:id', impact: '无法删除会话', presets: ALL,
  }),
  row({
    id: 'session.abort', title: 'session.abort', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.abort',
    probe: ['session', 'abort'], consumer: 'POST /api/sessions/:id/abort', impact: '无法中止回合', presets: ALL,
  }),
  row({
    id: 'session.list', title: 'session.list', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.list',
    probe: ['session', 'list'], consumer: 'GET /api/sessions', impact: '会话列表不可用', presets: ALL,
  }),
  row({
    id: 'session.todo', title: 'session.todo', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.todo',
    probe: ['session', 'todo'], consumer: 'plan.updated / TaskList', impact: '计划列表不可用', presets: ALL,
  }),
  row({
    id: 'session.children', title: 'session.children', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.children',
    probe: ['session', 'children'], consumer: 'subagent UI', impact: '子会话不可见', presets: ALL,
  }),
  row({
    id: 'session.summarize', title: 'session.summarize', domain: 'session',
    obligation: 'required', verification: 'presence', implementation: 'session.summarize',
    probe: ['session', 'summarize'], consumer: 'compaction / worker rotation', impact: '压缩与 worker 轮换降级', presets: ALL,
  }),

  // ── session optional / gated ─────────────────────────────────────────
  row({
    id: 'session.delete.persisted', title: 'session.delete persistence', domain: 'session',
    obligation: 'optional', verification: 'behavior', implementation: 'session.delete', behavior: 'delete-persisted',
    consumer: 'session lifecycle', impact: '只删内存，会话在 list/get 复活', presets: NONE,
  }),
  row({
    id: 'session.update', title: 'session.update (rename)', domain: 'session',
    obligation: 'optional', verification: 'presence', implementation: 'session.update',
    probe: ['session', 'update'], consumer: 'PATCH /api/sessions/:id', impact: '改名 503', presets: DESK,
  }),
  row({
    id: 'session.listByDirectory', title: 'session.listByDirectory', domain: 'session',
    obligation: 'gated', capability: 'sessionStorageApi', verification: 'presence',
    implementation: 'session.listByDirectory', probe: ['session', 'listByDirectory'],
    consumer: 'session list by project', impact: '回退全量拉取 + 客户端过滤', presets: DESK,
  }),
  row({
    id: 'session.worktree', title: 'session.worktree (directory-scoped)', domain: 'session',
    obligation: 'gated', capability: 'worktreeApi', verification: 'conformance',
    implementation: 'session.create({ directory })', conformance: ['session-lifecycle'],
    consumer: 'worktree sessions', impact: 'worktree 并行会话隔离失效', presets: DESK,
  }),
  row({
    id: 'session.switchAgent', title: 'session.switchAgent', domain: 'session',
    obligation: 'optional', verification: 'presence', implementation: 'session.switchAgent',
    probe: ['session', 'switchAgent'], consumer: 'POST /api/sessions/:id/agent', impact: '会话内切换 agent 503', presets: DESK,
  }),
  row({
    id: 'session.switchModel', title: 'session.switchModel', domain: 'session',
    obligation: 'optional', verification: 'presence', implementation: 'session.switchModel',
    probe: ['session', 'switchModel'], consumer: 'POST /api/sessions/:id/model', impact: '会话内切换模型 503', presets: DESK,
  }),
  row({
    id: 'session.setThinkingLevel', title: 'session.setThinkingLevel', domain: 'session',
    obligation: 'optional', verification: 'presence', implementation: 'session.setThinkingLevel',
    probe: ['session', 'setThinkingLevel'], consumer: 'POST /api/sessions/:id/thinking', impact: '推理档位切换 503', presets: DESK,
  }),
  row({
    id: 'session.shell', title: 'session.shell', domain: 'session',
    obligation: 'optional', verification: 'presence', implementation: 'shell.{create,get,output,remove}',
    probe: ['shell'], consumer: 'background shell', impact: '后台 shell 不可用', presets: NONE,
  }),
  row({
    id: 'session.instructions', title: 'session.instructions', domain: 'session',
    obligation: 'gated', capability: 'instructionsApi', verification: 'presence',
    implementation: 'session.instructions.{list,put,remove}', probe: ['session', 'instructions'],
    consumer: 'InstructionSyncService', impact: '指令分段/压缩免疫不可用', presets: DESK,
  }),

  // ── branch ───────────────────────────────────────────────────────────
  row({
    id: 'branch.fork', title: 'session.fork', domain: 'branch',
    obligation: 'gated', capability: 'sessionBranchApi', verification: 'presence',
    implementation: 'session.fork', probe: ['session', 'fork'],
    consumer: 'timeline fork', impact: '时间线/分叉不可用', presets: DESK,
  }),
  row({
    id: 'branch.revert', title: 'session.revert', domain: 'branch',
    obligation: 'gated', capability: 'sessionBranchApi', verification: 'presence',
    implementation: 'session.revert', probe: ['session', 'revert'],
    consumer: 'timeline rewind', impact: '回滚不可用', presets: DESK,
  }),
  row({
    id: 'branch.unrevert', title: 'session.unrevert', domain: 'branch',
    obligation: 'gated', capability: 'revertUndoApi', verification: 'presence',
    implementation: 'session.unrevert', probe: ['session', 'unrevert'],
    consumer: 'timeline unrevert', impact: '回滚不可撤销', presets: DESK,
  }),
  row({
    id: 'branch.diff', title: 'session.diff', domain: 'branch',
    obligation: 'gated', capability: 'diffApi', verification: 'presence',
    implementation: 'session.diff', probe: ['session', 'diff'],
    consumer: 'ChangesDock / per-turn diff', impact: '审阅改动不可用', presets: DESK,
  }),
  row({
    id: 'branch.vcs', title: 'vcs.diff / vcs.apply', domain: 'branch',
    obligation: 'gated', capability: 'diffApi', verification: 'presence',
    implementation: 'session.vcs.diff / session.vcs.apply', probe: ['session', 'vcs', 'apply'],
    consumer: 'hunk revert / workspace patch', impact: '工作区 patch 不可用', presets: DESK,
  }),
  row({
    id: 'branch.checkpoint', title: 'checkpoint', domain: 'branch',
    obligation: 'gated', capability: 'checkpointApi', verification: 'attested',
    implementation: 'snapshot tree + staged revert', consumer: 'CheckpointService',
    impact: '时间线检查点不可用', presets: DESK,
  }),
  row({
    id: 'branch.runState', title: 'runState', domain: 'branch',
    obligation: 'gated', capability: 'runStateApi', verification: 'attested',
    implementation: 'session.abort + messages', consumer: 'RunCoordinator',
    impact: '回合软暂停不可用', presets: DESK,
  }),

  // ── process ──────────────────────────────────────────────────────────
  row({
    id: 'process.getBaseUrl', title: 'getBaseUrl', domain: 'process',
    obligation: 'advisory', verification: 'presence', implementation: 'getBaseUrl',
    probe: ['getBaseUrl'], consumer: 'reverse proxy', impact: '反代回退到配置 URL', presets: NONE,
  }),
  row({
    id: 'process.healthCheck', title: 'healthCheck', domain: 'process',
    obligation: 'advisory', verification: 'presence', implementation: 'healthCheck',
    probe: ['healthCheck'], consumer: 'serve watchdog', impact: '健康探测缺失', presets: NONE,
  }),
  row({
    id: 'process.restart', title: 'agentProcess.restart', domain: 'process',
    obligation: 'gated', capability: 'agentProcessApi', verification: 'presence',
    implementation: 'agentProcess.restart', probe: ['agentProcess', 'restart'],
    consumer: 'POST /api/runtime/restart-agent', impact: '自监管重启不可用', presets: NONE,
  }),
  row({
    id: 'process.spawnServe', title: 'agentProcess.spawnServe', domain: 'process',
    obligation: 'gated', capability: 'agentProcessApi', verification: 'presence',
    implementation: 'agentProcess.spawnServe', probe: ['agentProcess', 'spawnServe'],
    consumer: 'serve supervisor', impact: 'server 拉起不可用', presets: NONE,
  }),
  row({
    id: 'process.killServe', title: 'agentProcess.killServe', domain: 'process',
    obligation: 'gated', capability: 'agentProcessApi', verification: 'presence',
    implementation: 'agentProcess.killServe', probe: ['agentProcess', 'killServe'],
    consumer: 'serve recovery', impact: '端口清场不可用', presets: NONE,
  }),
  row({
    id: 'process.resolveEventEntry', title: 'resolveEventEntry', domain: 'process',
    obligation: 'optional', verification: 'conformance', implementation: 'resolveEventEntry',
    conformance: ['chat-roundtrip'], consumer: 'dialect wiring', impact: '方言感知退化为静态表', presets: NONE,
  }),
  row({
    id: 'process.activeDialect', title: 'activeDialect', domain: 'process',
    obligation: 'optional', verification: 'conformance', implementation: 'activeDialect',
    conformance: ['chat-roundtrip'], consumer: 'GET /api/runtime', impact: '方言标签缺失', presets: NONE,
  }),

  row({
    id: 'process.completion', title: 'completion.complete', domain: 'process',
    obligation: 'gated', capability: 'completionApi', verification: 'presence',
    implementation: 'completion.complete', probe: ['completion', 'complete'],
    consumer: 'index-scan / media', impact: '无状态补全通道降级', presets: DESK,
  }),
  row({
    id: 'process.credentials', title: 'credentials.getApiKey', domain: 'process',
    obligation: 'optional', verification: 'presence', implementation: 'credentials.getApiKey',
    probe: ['credentials', 'getApiKey'], consumer: 'media/auth', impact: '凭据回退 auth.json', presets: NONE,
  }),

  // ── provider ─────────────────────────────────────────────────────────
  row({
    id: 'provider.list', title: 'provider.list', domain: 'provider',
    obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] },
    verification: 'presence', implementation: 'provider.list', probe: ['provider', 'list'],
    consumer: 'GET /api/provider', impact: 'provider/模型设置不可用', presets: DESK,
  }),
  row({
    id: 'provider.app.agents', title: 'app.agents', domain: 'provider',
    obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] },
    verification: 'presence', implementation: 'app.agents', probe: ['app', 'agents'],
    consumer: 'GET /api/agents', impact: 'runtime agent 列表不可用', presets: DESK,
  }),
  row({
    id: 'provider.config', title: 'config.get / config.update', domain: 'provider',
    obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] },
    verification: 'presence', implementation: 'config.get / config.update', probe: ['config'],
    consumer: 'GET/PATCH /api/runtime-config', impact: 'runtime 配置读写不可用', presets: DESK,
  }),
  row({
    id: 'provider.config.update', title: 'config.update', domain: 'provider',
    obligation: 'required', requiredWhen: { capabilities: ['providerConfigApi'] },
    verification: 'presence', implementation: 'config.update', probe: ['config', 'update'],
    consumer: 'PATCH /api/runtime-config', impact: 'runtime 配置写入不可用', presets: DESK,
  }),
];
