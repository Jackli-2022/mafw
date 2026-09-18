/**
 * P4-B Shadow Route Catalog —— gateway 全量 HTTP 端点的声明式登记（无 handler）。
 *
 * 两个来源：
 *  - SDK_FACING_ROUTES：机械转录自 packages/gateway-sdk/contract/openapi.json
 *    （path+method+operationId+tags 与 openapi 逐字一致，'{param}' → ':param'），
 *    漂移由 gateway-sdk/src/contract.test.ts 与 tests/unit/api-contract.test.ts 双向锁定。
 *  - NON_SDK_ROUTES：非 SDK 暴露面的补充登记（desktop/TUI/worker/dashboard 专用端点），
 *    operationId 自拟（ns.action 风格），tags 统一 'internal'。
 *
 * 刻意不登记：/mcp（传输端点非 REST）、/api/ws（websocket upgrade）、dashboard SPA
 * fallback 与静态资源（/index.html、/assets/*、/static/*）、dashboard 委托内部子路由
 * （/api/memory/{tier}/{id} 等，见 dashboard/api.ts）、/api/events?stream=true（与
 * /api/events 同路径，不单独登记）。P5 Wave 2 反向审计后补齐：devices/mobile 全家、
 * automations history、goals loops :n、A2A agent-card、runtime reload、permissions
 * runtime 代理、legacy singular session delete。
 */

import type { RouteDef } from './registry';

/** SDK-facing 端点（openapi.json 全量 94 条 operation，权威转录，勿手改——改请先改 openapi.json 再同步）。 */
const SDK_FACING_ROUTES: RouteDef[] = [
  { method: 'POST', path: '/api/session', operationId: 'session.create', tags: ['session'] },
  { method: 'GET', path: '/api/sessions', operationId: 'session.list', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id', operationId: 'session.get', tags: ['session'] },
  { method: 'DELETE', path: '/api/sessions/:id', operationId: 'session.delete', tags: ['session'] },
  { method: 'PATCH', path: '/api/sessions/:id', operationId: 'session.rename', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/messages', operationId: 'session.messages', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/todo', operationId: 'session.todo', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/children', operationId: 'session.children', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/trajectory', operationId: 'session.trajectory', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/token-summary', operationId: 'session.tokenSummary', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/fork', operationId: 'session.fork', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/revert', operationId: 'session.revert', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/unrevert', operationId: 'session.unrevert', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/abort', operationId: 'session.abort', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/summarize', operationId: 'session.summarize', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/prompt', operationId: 'session.prompt', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/promptAsync', operationId: 'session.promptAsync', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/command', operationId: 'session.command', tags: ['session'] },
  { method: 'GET', path: '/api/usage', operationId: 'session.usage', tags: ['session'] },
  { method: 'GET', path: '/api/usage/summary', operationId: 'session.usageSummary', tags: ['session'] },
  { method: 'GET', path: '/api/usage/plugins', operationId: 'session.usagePluginsList', tags: ['session'] },
  { method: 'POST', path: '/api/usage/plugins/reload', operationId: 'session.usagePluginsReload', tags: ['session'] },
  { method: 'POST', path: '/api/usage/plugins/create', operationId: 'session.usagePluginsCreate', tags: ['session'] },
  { method: 'GET', path: '/api/usage/plugins/:name/source', operationId: 'session.usagePluginSourceGet', tags: ['session'] },
  { method: 'PUT', path: '/api/usage/plugins/:name/source', operationId: 'session.usagePluginSourcePut', tags: ['session'] },
  { method: 'DELETE', path: '/api/usage/plugins/:name', operationId: 'session.usagePluginsDelete', tags: ['session'] },
  { method: 'POST', path: '/api/usage/plugins/:name/test', operationId: 'session.usagePluginTest', tags: ['session'] },
  { method: 'GET', path: '/command', operationId: 'command.list', tags: ['command'] },
  { method: 'GET', path: '/skill', operationId: 'skill.list', tags: ['skill'] },
  { method: 'POST', path: '/api/mafw-commands/run', operationId: 'mafwCommands.run', tags: ['mafwCommands'] },
  { method: 'GET', path: '/api/mafw-commands', operationId: 'mafwCommands.list', tags: ['mafwCommands'] },
  { method: 'GET', path: '/api/manager/session', operationId: 'manager.session', tags: ['manager'] },
  { method: 'POST', path: '/api/manager/session/rotate', operationId: 'manager.rotate', tags: ['manager'] },
  { method: 'GET', path: '/api/projects', operationId: 'project.list', tags: ['project'] },
  { method: 'GET', path: '/api/projects/current', operationId: 'project.current', tags: ['project'] },
  { method: 'POST', path: '/register', operationId: 'project.setCurrent', tags: ['project'] },
  { method: 'GET', path: '/api/events', operationId: 'event.subscribe', tags: ['event'] },
  { method: 'POST', path: '/api/events', operationId: 'event.publish', tags: ['event'] },
  { method: 'GET', path: '/api/runtime', operationId: 'runtime.get', tags: ['runtime'] },
  { method: 'POST', path: '/api/runtime/switch', operationId: 'runtime.switch', tags: ['runtime'] },
  { method: 'POST', path: '/api/runtime/restart-agent', operationId: 'runtime.restartAgent', tags: ['runtime'] },
  // runtime.reload（POST /api/runtime/reload）在下方 NON_SDK 补遗块登记（SDK 不调用 → internal）
  { method: 'GET', path: '/api/plugins', operationId: 'plugins.list', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/install', operationId: 'plugins.install', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/enable', operationId: 'plugins.enable', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/disable', operationId: 'plugins.disable', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/delete', operationId: 'plugins.delete', tags: ['plugins'] },
  { method: 'GET', path: '/api/config', operationId: 'config.get', tags: ['config'] },
  { method: 'PUT', path: '/api/config', operationId: 'config.set', tags: ['config'] },
  { method: 'GET', path: '/api/opencode-config', operationId: 'opencodeConfig.get', tags: ['opencodeConfig'] },
  { method: 'PATCH', path: '/api/opencode-config', operationId: 'opencodeConfig.update', tags: ['opencodeConfig'] },
  { method: 'GET', path: '/api/goals', operationId: 'goals.list', tags: ['goals'] },
  { method: 'GET', path: '/api/goals/:id', operationId: 'goals.get', tags: ['goals'] },
  { method: 'GET', path: '/api/goals/:id/sessions', operationId: 'goals.sessions', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/:goalId/questions/:questionId/respond', operationId: 'goals.respondQuestion', tags: ['goals'] },
  { method: 'POST', path: '/api/work/:goalId/validate', operationId: 'goals.validate', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/control', operationId: 'goals.control', tags: ['goals'] },
  { method: 'GET', path: '/api/memory/search', operationId: 'memory.search', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/merged-search', operationId: 'memory.mergedSearch', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/energy-distribution', operationId: 'memory.getEnergyDistribution', tags: ['memory'] },
  { method: 'GET', path: '/api/l5/axioms', operationId: 'memory.getL5Axioms', tags: ['memory'] },
  { method: 'DELETE', path: '/api/memory/:id', operationId: 'memory.delete', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/sticky', operationId: 'memory.listSticky', tags: ['memory'] },
  { method: 'POST', path: '/api/memory/pin', operationId: 'memory.setSticky', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/embedding-config', operationId: 'embedding.get', tags: ['embedding'] },
  { method: 'POST', path: '/api/memory/embedding-config', operationId: 'embedding.update', tags: ['embedding'] },
  { method: 'GET', path: '/api/approvals', operationId: 'approvals.list', tags: ['approvals'] },
  { method: 'POST', path: '/api/approvals/:id/respond', operationId: 'approvals.respond', tags: ['approvals'] },
  { method: 'GET', path: '/api/triage', operationId: 'triage.list', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/dismiss', operationId: 'triage.dismiss', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/confirm', operationId: 'triage.confirm', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/reject', operationId: 'triage.reject', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/propose', operationId: 'triage.propose', tags: ['triage'] },
  { method: 'GET', path: '/api/questions', operationId: 'questions.list', tags: ['questions'] },
  { method: 'POST', path: '/api/questions/:id/reply', operationId: 'questions.reply', tags: ['questions'] },
  { method: 'POST', path: '/api/questions/:id/reject', operationId: 'questions.reject', tags: ['questions'] },
  { method: 'GET', path: '/api/permissions', operationId: 'permissions.list', tags: ['permissions'] },
  { method: 'POST', path: '/api/permissions/:id/reply', operationId: 'permissions.reply', tags: ['permissions'] },
  { method: 'POST', path: '/api/chat', operationId: 'chat.send', tags: ['chat'] },
  { method: 'POST', path: '/api/chat/enriched', operationId: 'chat.sendEnriched', tags: ['chat'] },
  { method: 'GET', path: '/api/media/plugins', operationId: 'media.plugins', tags: ['media'] },
  { method: 'POST', path: '/api/media/switch', operationId: 'media.switch', tags: ['media'] },
  { method: 'POST', path: '/api/media/upload', operationId: 'media.upload', tags: ['media'] },
  { method: 'POST', path: '/api/media/upload-and-create', operationId: 'media.uploadAndCreate', tags: ['media'] },
  { method: 'POST', path: '/a2a', operationId: 'media.createTask', tags: ['media'] },
  { method: 'GET', path: '/a2a/artifacts/:id', operationId: 'media.artifact', tags: ['media'] },
  { method: 'POST', path: '/api/tts', operationId: 'tts.speak', tags: ['tts'] },
  { method: 'GET', path: '/api/tts/voices', operationId: 'tts.voices', tags: ['tts'] },
  { method: 'POST', path: '/api/tts/stream', operationId: 'tts.speakStream', tags: ['tts'] },
  { method: 'POST', path: '/api/tts/interrupt', operationId: 'tts.interrupt', tags: ['tts'] },
  { method: 'GET', path: '/api/provider', operationId: 'providers.list', tags: ['providers'] },
  { method: 'GET', path: '/api/agents', operationId: 'agents.list', tags: ['agents'] },
  { method: 'GET', path: '/api/model-config', operationId: 'models.get', tags: ['models'] },
  { method: 'POST', path: '/api/model-config', operationId: 'models.update', tags: ['models'] },
  { method: 'GET', path: '/api/automations', operationId: 'automations.list', tags: ['automations'] },
  { method: 'PUT', path: '/api/automations/:id', operationId: 'automations.toggle', tags: ['automations'] },
  { method: 'POST', path: '/api/automations/draft', operationId: 'automations.draft', tags: ['automations'] },
];

/** 非 SDK 端点补充登记（desktop/TUI/worker/dashboard 专用面），operationId 自拟，tags 'internal'。 */
const NON_SDK_ROUTES: RouteDef[] = [
  // Python 内核（§5.17）
  { method: 'POST', path: '/api/python/execute', operationId: 'python.execute', tags: ['internal'] },
  { method: 'POST', path: '/api/python/restart', operationId: 'python.restart', tags: ['internal'] },
  { method: 'GET', path: '/api/python/status', operationId: 'python.status', tags: ['internal'] },
  // 观察捕获 / 边界 recall / pinned 披露层（§5.11/§5.13）
  { method: 'POST', path: '/api/obs/capture', operationId: 'obs.capture', tags: ['internal'] },
  { method: 'GET', path: '/api/recall/context', operationId: 'recall.context', tags: ['internal'] },
  { method: 'GET', path: '/api/recall/pinned', operationId: 'recall.pinned', tags: ['internal'] },
  // 记忆补充（memory.mergedSearch 已在 SDK-facing，不重复）
  { method: 'POST', path: '/api/memory/add', operationId: 'memory.add', tags: ['internal'] },
  { method: 'GET', path: '/api/memory/get', operationId: 'memory.get', tags: ['internal'] },
  { method: 'GET', path: '/api/memory/stats', operationId: 'memory.stats', tags: ['internal'] },
  { method: 'POST', path: '/api/memory/embeddings/backfill', operationId: 'memory.embeddingsBackfill', tags: ['internal'] },
  { method: 'GET', path: '/api/l5/heuristics', operationId: 'memory.getL5Heuristics', tags: ['internal'] },
  // Goal / 编排（§5.20）
  { method: 'GET', path: '/api/goals/:id/loops', operationId: 'goals.loops', tags: ['internal'] },
  { method: 'POST', path: '/api/work/:goalId/complete', operationId: 'goals.complete', tags: ['internal'] },
  { method: 'POST', path: '/control', operationId: 'goals.controlLegacy', summary: 'MCP 兼容别名，与 /api/goals/control 同 handler', tags: ['internal'] },
  { method: 'GET', path: '/api/orchestration/outcomes', operationId: 'orchestration.outcomes', tags: ['internal'] },
  // 媒体补充（media.upload / uploadAndCreate / switch / plugins GET / a2a / artifacts GET 已在 SDK-facing）
  { method: 'POST', path: '/api/media/create-task', operationId: 'media.createTaskApi', tags: ['internal'] },
  { method: 'GET', path: '/api/media/resolve-task/:id', operationId: 'media.resolveTask', tags: ['internal'] },
  { method: 'POST', path: '/api/media/analyze-audio', operationId: 'media.analyzeAudio', tags: ['internal'] },
  { method: 'POST', path: '/api/media/plugins/reload', operationId: 'media.pluginsReload', tags: ['internal'] },
  // 用量 dashboard / 健康
  { method: 'GET', path: '/api/stats', operationId: 'dashboard.stats', tags: ['internal'] },
  { method: 'GET', path: '/api/costs/:window', operationId: 'dashboard.costs', tags: ['internal'] },
  { method: 'GET', path: '/api/alignment', operationId: 'dashboard.alignment', tags: ['internal'] },
  { method: 'POST', path: '/api/feedback', operationId: 'feedback.record', tags: ['internal'] },
  { method: 'GET', path: '/api/user-answers/:id', operationId: 'dashboard.userAnswer', tags: ['internal'] },
  { method: 'GET', path: '/api/sessions/:id/metrics', operationId: 'session.metrics', tags: ['internal'] },
  { method: 'GET', path: '/api/health', operationId: 'health.check', tags: ['internal'] },
  // Gateway 控制（goal PAUSE/ABORT 等控制面）
  { method: 'POST', path: '/api/gateway/pause', operationId: 'gateway.pause', tags: ['internal'] },
  { method: 'POST', path: '/api/gateway/resume', operationId: 'gateway.resume', tags: ['internal'] },
  { method: 'POST', path: '/api/gateway/cancel', operationId: 'gateway.cancel', tags: ['internal'] },
  { method: 'POST', path: '/api/gateway/checkpoint', operationId: 'gateway.checkpoint', tags: ['internal'] },
  { method: 'POST', path: '/api/gateway/rollback', operationId: 'gateway.rollback', tags: ['internal'] },
  // 移动端（P5 Wave 2 反向审计后全量登记）
  { method: 'POST', path: '/api/mobile/media/tasks/:id/ask', operationId: 'mobile.mediaTaskAsk', tags: ['internal'] },
  { method: 'POST', path: '/api/mobile/media/tasks', operationId: 'mobile.mediaTaskUpload', tags: ['internal'] },
  { method: 'GET', path: '/api/mobile/tts/artifacts/:id', operationId: 'mobile.ttsArtifact', tags: ['internal'] },
  { method: 'GET', path: '/api/mobile/devices', operationId: 'mobile.devicesList', tags: ['internal'] },
  { method: 'DELETE', path: '/api/mobile/devices/:id', operationId: 'mobile.devicesDelete', tags: ['internal'] },
  { method: 'POST', path: '/api/mobile/devices/register', operationId: 'mobile.devicesRegister', tags: ['internal'] },
  { method: 'GET', path: '/api/mobile/pairing-code', operationId: 'mobile.pairingCode', tags: ['internal'] },
  { method: 'POST', path: '/api/mobile/pairing/verify', operationId: 'mobile.pairingVerify', tags: ['internal'] },
  // 设备注册（mobile 的 legacy 别名族）
  { method: 'POST', path: '/api/devices', operationId: 'devices.register', tags: ['internal'] },
  { method: 'GET', path: '/api/devices', operationId: 'devices.list', tags: ['internal'] },
  { method: 'DELETE', path: '/api/devices/:id', operationId: 'devices.delete', tags: ['internal'] },
  // P5 Wave 2 反向审计补遗
  { method: 'GET', path: '/.well-known/agent-card.json', operationId: 'a2a.agentCard', tags: ['internal'] },
  { method: 'GET', path: '/api/automations/:id/history', operationId: 'automations.history', tags: ['internal'] },
  { method: 'GET', path: '/api/goals/:id/loops/:n', operationId: 'goals.loopsAt', tags: ['internal'] },
  { method: 'POST', path: '/api/runtime/reload', operationId: 'runtime.reload', tags: ['internal'] },
  { method: 'POST', path: '/api/runtime/dry-event', operationId: 'runtime.dryEvent', tags: ['internal'] },
  { method: 'POST', path: '/api/sessions/:sid/permissions/:rid', operationId: 'permissions.replyRuntime', tags: ['internal'] },
  { method: 'DELETE', path: '/api/session/:id', operationId: 'session.deleteLegacy', tags: ['internal'] },
  // Eval / LLM 压缩
  { method: 'POST', path: '/api/eval/chat/completions', operationId: 'eval.chatCompletions', tags: ['internal'] },
  { method: 'POST', path: '/api/llm/compress', operationId: 'llm.compress', tags: ['internal'] },
  // 跨 worktree 记忆融合（§5.3）
  { method: 'POST', path: '/api/merge-memory', operationId: 'memory.merge', tags: ['internal'] },
  // 根健康检查（dashboard/桌面探测用）
  { method: 'GET', path: '/health', operationId: 'health.root', tags: ['internal'] },
];

/** gateway 全量 HTTP 端点 shadow 登记（无 handler；Phase 3 逐条挂 handler 前不参与 dispatch）。
 *  每次调用返回全新 def 对象（浅拷贝）——attachHandler 会原地改写 def.handler，
 *  共享模块级常量会让第二次 build 的 registry 带上一次的 handler（测试已抓过）。 */
export function buildRouteCatalog(): RouteDef[] {
  return [...SDK_FACING_ROUTES, ...NON_SDK_ROUTES].map((d) => ({ ...d }));
}
