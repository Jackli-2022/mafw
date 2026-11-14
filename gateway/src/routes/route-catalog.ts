/**
 * P4-B Shadow Route Catalog —— gateway 全量 HTTP 端点的声明式登记（无 handler）。
 *
 * 单一事实源是**本文件**：`scripts/emit-openapi.ts` 把 catalog 投影成
 * `packages/gateway-sdk/contract/gateway-paths.json`，再由 SDK `gen:api`
 * 合并 overrides 生成 `openapi.json` / `api-schema.gen.ts`。新增/修改路由的正确顺序是
 * 「改这里 → (gateway) emit:openapi → (sdk) gen:api」，不要手改生成物
 * （`api-contract.test.ts` 的新鲜度与 phantom 扫描会打红）。
 *
 * 两个来源：
 *  - SDK_FACING_ROUTES：`@mafw/sdk` 直接调用的端点（path+method+operationId+tags；
 *    `:param` 是 catalog 形态，emit 时转成 `{param}`）。漂移由
 *    gateway-sdk/src/contract.test.ts 与 tests/unit/api-contract.test.ts 双向锁定。
 *  - NON_SDK_ROUTES：非 SDK 暴露面的补充登记（desktop/TUI/worker/dashboard 专用端点），
 *    operationId 自拟（ns.action 风格），tags 统一 'internal'。
 *
 * 刻意不登记：/mcp（传输端点非 REST）、/api/ws（websocket upgrade）、dashboard SPA
 * fallback 与静态资源（/index.html、/assets/*、/static/*）、dashboard 委托内部子路由
 * （/api/memory/{tier}/{id} 等，见 subsystems/dashboard-legacy.ts）、/api/events?stream=true（与
 * /api/events 同路径，不单独登记）。P5 Wave 2 反向审计后补齐：devices/mobile 全家、
 * automations history、goals loops :n、A2A agent-card、runtime reload、permissions
 * runtime 代理、legacy singular session delete。
 */

import type { RouteDef } from './registry';
import { SessionListResponse, SessionMessagesResponse, SessionSchema } from './schemas/session';
import {
  AttentionListResponse,
  DecisionListResponse,
  GoalViewSchema,
  PresenceResponse,
  ProjectListResponse,
  UsageSummaryResponse,
} from './schemas/read-models';
import { KernelStatsResponse } from './schemas/resources';
import { EventReplayResponse } from './schemas/events';
import {
  PodCostResponse,
  PodDetailResponse,
  PodEventsResponse,
  PodGoalResultResponse,
  PodGoalRevisionsResponse,
  PodGoalsResponse,
  PodMessagesResponse,
  PodProbesResponse,
  PodReviewItemsResponse,
  PodTasksResponse,
  PodTechLeadHistoryResponse,
  PodTranscriptResponse,
  PodWorktreeDiffResponse,
} from './schemas/pods';
import {
  GoalListResponse,
  GoalPlanResponse,
  GoalSessionsResponse,
  GoalSourceResponse,
  GoalTimelineResponse,
} from './schemas/goals';
import {
  AllowlistListResponse,
  ApprovalListResponse,
  PermissionListResponse,
  PermissionModeResponse,
  PermissionRulesListResponse,
  QuestionListResponse,
  TriageListResponse,
} from './schemas/human-gate';
import { WorkOverviewResponse } from './schemas/work';
import { MemoryGetResponse, MemorySearchResponse } from './schemas/memory';
import {
  MemoryEnergyDistributionResponse,
  MemoryL5AxiomsResponse,
  MemoryMergedSearchResponse,
  MemoryStickyResponse,
} from './schemas/memory-extra';
import {
  RecallContextResponse,
  RecallInstructionsResponse,
  RecallPinnedResponse,
  RecallPriorsResponse,
} from './schemas/recall';
import { LeadContextResponse, LeadRecallResponse, LeadWorkingSetResponse } from './schemas/lead';
import { MemoryStatsResponse } from './schemas/memory-stats';
import { HumanTokenRotateResponse } from './schemas/human-token';
import {
  SessionCheckpointsResponse,
  SessionChildrenResponse,
  SessionConfigResponse,
  SessionDiffResponse,
  SessionQueueListResponse,
  SessionSubagentsResponse,
  SessionTodoResponse,
  SessionTokenSummaryResponse,
} from './schemas/session-read';
import {
  AgentListResponse,
  ConfigGetResponse,
  McpServersResponse,
  PluginsListResponse,
  ProviderListResponse,
  SchedulerStatusResponse,
  SkillsListResponse,
  ToolsListResponse,
} from './schemas/meta';
import { TaskGetResponse, TaskListResponse, TaskOutputResponse } from './schemas/tasks';
import {
  SessionDiscoveryResponse,
  SessionDiscoverySkillResponse,
  SessionRunResponse,
  SessionStructuredResponse,
  SessionTrajectoryResponse,
} from './schemas/session-runtime';
import { CognitionRulesResponse, ExperienceActionsResponse } from './schemas/experience';
import { BackgroundJobOutputResponse, BackgroundJobsListResponse } from './schemas/background';
import { TerminalListResponse } from './schemas/terminal';
import {
  SessionUsageResponse,
  UsagePluginSourceResponse,
  UsagePluginsListResponse,
} from './schemas/usage';
import {
  FileHistoryListResponse,
  MafwCommandsListResponse,
  ManagerSessionResponse,
  ProjectCurrentResponse,
} from './schemas/project-meta';
import {
  PluginsClientResponse,
  RuntimeConfigGetResponse,
  RuntimeContractResponse,
  RuntimeGetResponse,
} from './schemas/runtime-surface';
import {
  AgentCapabilitiesResponse,
  EmbeddingGetResponse,
  MediaPluginsResponse,
  MediaResolveTaskResponse,
  ModelConfigGetResponse,
  PythonStatusResponse,
  TtsVoicesResponse,
  VoiceStatusResponse,
} from './schemas/media-voice';

/**
 * SDK-facing 端点（catalog → gateway-paths → openapi 单向生成；**在此新增**后必须重跑
 * `emit:openapi` + `gen:api`，不要反向手改 openapi.json）。
 */
const SDK_FACING_ROUTES: RouteDef[] = [
  { method: 'GET', path: '/api/presence', operationId: 'presence.get', tags: ['presence'], response: PresenceResponse },
  { method: 'GET', path: '/api/pods/:podId/events', operationId: 'pod.events.list', tags: ['pod'], response: PodEventsResponse },
  { method: 'POST', path: '/api/pods/:podId/events/:id/seen', operationId: 'pod.events.seen', tags: ['pod'] },
  { method: 'POST', path: '/api/pods/:podId/events/seen', operationId: 'pod.events.seenAll', tags: ['pod'] },
  { method: 'POST', path: '/api/session', operationId: 'session.create', tags: ['session'] },
  { method: 'POST', path: '/api/cognition/gate', operationId: 'cognition.gate', tags: ['cognition'] },
  { method: 'POST', path: '/api/cognition/rewrite', operationId: 'cognition.rewrite', tags: ['cognition'] },
  { method: 'GET', path: '/api/cognition/rules', operationId: 'cognition.rules', tags: ['cognition'], response: CognitionRulesResponse },
  { method: 'GET', path: '/api/session/:id/queue', operationId: 'session.queue.list', tags: ['session'], response: SessionQueueListResponse },
  { method: 'GET', path: '/api/session/:id/config', operationId: 'session.config', tags: ['session'], response: SessionConfigResponse },
  { method: 'POST', path: '/api/session/:id/config', operationId: 'session.config.set', tags: ['session'] },
  { method: 'DELETE', path: '/api/session/:id/queue', operationId: 'session.queue.clear', tags: ['session'] },
  { method: 'DELETE', path: '/api/session/:id/queue/:itemId', operationId: 'session.queue.cancel', tags: ['session'] },
  // code-first 试点：response schema 是唯一来源（emit:openapi 直接投影，不经 overrides）。
  { method: 'GET', path: '/api/sessions', operationId: 'session.list', tags: ['session'], response: SessionListResponse },
  { method: 'GET', path: '/api/sessions/:id', operationId: 'session.get', tags: ['session'], response: SessionSchema },
  { method: 'DELETE', path: '/api/sessions/:id', operationId: 'session.delete', tags: ['session'] },
  { method: 'PATCH', path: '/api/sessions/:id', operationId: 'session.rename', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/messages', operationId: 'session.messages', summary: 'Session message history (MAFW flat DTO)', tags: ['session'], response: SessionMessagesResponse },
  { method: 'GET', path: '/api/sessions/:id/todo', operationId: 'session.todo', tags: ['session'], response: SessionTodoResponse },
  { method: 'GET', path: '/api/sessions/:id/children', operationId: 'session.children', tags: ['session'], response: SessionChildrenResponse },
  { method: 'GET', path: '/api/sessions/:id/structured', operationId: 'session.structured', tags: ['session'], response: SessionStructuredResponse },
  { method: 'POST', path: '/api/sessions/:id/agent', operationId: 'session.switchAgent', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/model', operationId: 'session.switchModel', tags: ['session'] },
  { method: 'POST', path: '/api/structured/submit', operationId: 'structured.submit', tags: ['session'] },
  { method: 'POST', path: '/api/tasks', operationId: 'tasks.submit', tags: ['task'] },
  { method: 'GET', path: '/api/tasks', operationId: 'tasks.list', tags: ['task'], response: TaskListResponse },
  { method: 'GET', path: '/api/tasks/:id', operationId: 'tasks.get', tags: ['task'], response: TaskGetResponse },
  { method: 'POST', path: '/api/tasks/:id/cancel', operationId: 'tasks.cancel', tags: ['task'] },
  { method: 'POST', path: '/api/tasks/:id/message', operationId: 'tasks.message', tags: ['task'] },
  { method: 'GET', path: '/api/tasks/:id/output', operationId: 'tasks.output', tags: ['task'], response: TaskOutputResponse },
  { method: 'GET', path: '/api/sessions/:id/trajectory', operationId: 'session.trajectory', tags: ['session'], response: SessionTrajectoryResponse },
  { method: 'GET', path: '/api/sessions/:id/token-summary', operationId: 'session.tokenSummary', tags: ['session'], response: SessionTokenSummaryResponse },
  { method: 'POST', path: '/api/sessions/:id/fork', operationId: 'session.fork', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/revert', operationId: 'session.revert', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/unrevert', operationId: 'session.unrevert', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/diff', operationId: 'session.diff', tags: ['session'], response: SessionDiffResponse },
  { method: 'POST', path: '/api/sessions/:id/diff/revert', operationId: 'session.revertDiff', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/checkpoint', operationId: 'session.checkpoint', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/checkpoints', operationId: 'session.checkpoints', tags: ['session'], response: SessionCheckpointsResponse },
  { method: 'POST', path: '/api/sessions/:id/checkpoints/:checkpointId/restore', operationId: 'session.restoreCheckpoint', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/suspend', operationId: 'session.suspend', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/resume', operationId: 'session.resume', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/run', operationId: 'session.run', tags: ['session'], response: SessionRunResponse },
  { method: 'POST', path: '/api/sessions/:id/run/discard', operationId: 'session.discardRun', tags: ['session'] },
  { method: 'POST', path: '/api/sessions/:id/data', operationId: 'session.data', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/discovery', operationId: 'session.discovery', tags: ['session'], response: SessionDiscoveryResponse },
  { method: 'POST', path: '/api/sessions/:id/discovery/refresh', operationId: 'session.discoveryRefresh', tags: ['session'] },
  { method: 'GET', path: '/api/sessions/:id/discovery/skills/:key', operationId: 'session.discoverySkill', tags: ['session'], response: SessionDiscoverySkillResponse },
{ method: 'POST', path: '/api/sessions/:id/discovery/skills/:key/invoke', operationId: 'session.discoverySkillInvoke', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/abort', operationId: 'session.abort', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/summarize', operationId: 'session.summarize', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/prompt', operationId: 'session.prompt', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/promptAsync', operationId: 'session.promptAsync', tags: ['session'] },
  // Task 16：SDK `sessions.background` 一直在调这个端点，但 catalog 漏登记（route→surface
  // 守卫在验收批暴露的契约洞）。surface = session.background。
  { method: 'POST', path: '/api/session/:id/background', operationId: 'session.background', tags: ['session'] },
  { method: 'POST', path: '/api/session/:id/command', operationId: 'session.command', tags: ['session'] },
  { method: 'GET', path: '/api/experience/actions', operationId: 'experience.actions', tags: ['experience'], response: ExperienceActionsResponse },
  // Task 3：三源统一的后台作业 façade（MafwBackgroundJob / MafwBackgroundOutput）
  { method: 'GET', path: '/api/background/jobs', operationId: 'background.jobs.list', tags: ['background'], response: BackgroundJobsListResponse },
  { method: 'GET', path: '/api/background/jobs/:id/output', operationId: 'background.jobs.output', tags: ['background'], response: BackgroundJobOutputResponse },
  { method: 'POST', path: '/api/background/jobs/:id/cancel', operationId: 'background.jobs.cancel', tags: ['background'] },
  // Task 4：中性 terminal PTY（mafw-terminal/1；WS 升级不登记，同 /api/ws）
  { method: 'GET', path: '/api/terminal/sessions', operationId: 'terminal.list', tags: ['terminal'], response: TerminalListResponse },
  { method: 'POST', path: '/api/terminal/sessions', operationId: 'terminal.create', tags: ['terminal'] },
  { method: 'DELETE', path: '/api/terminal/sessions/:id', operationId: 'terminal.remove', tags: ['terminal'] },
  { method: 'POST', path: '/api/terminal/sessions/:id/connect-ticket', operationId: 'terminal.connectTicket', tags: ['terminal'] },
  { method: 'GET', path: '/api/usage', operationId: 'session.usage', tags: ['session'], response: SessionUsageResponse },
  { method: 'GET', path: '/api/usage/summary', operationId: 'session.usageSummary', tags: ['session'], response: UsageSummaryResponse },
  { method: 'GET', path: '/api/usage/plugins', operationId: 'session.usagePluginsList', tags: ['session'], response: UsagePluginsListResponse },
  { method: 'POST', path: '/api/usage/plugins/reload', operationId: 'session.usagePluginsReload', tags: ['session'] },
  { method: 'POST', path: '/api/usage/plugins/create', operationId: 'session.usagePluginsCreate', tags: ['session'] },
  { method: 'GET', path: '/api/usage/plugins/:name/source', operationId: 'session.usagePluginSourceGet', tags: ['session'], response: UsagePluginSourceResponse },
  { method: 'PUT', path: '/api/usage/plugins/:name/source', operationId: 'session.usagePluginSourcePut', tags: ['session'] },
  { method: 'DELETE', path: '/api/usage/plugins/:name', operationId: 'session.usagePluginsDelete', tags: ['session'] },
  { method: 'POST', path: '/api/usage/plugins/:name/test', operationId: 'session.usagePluginTest', tags: ['session'] },
  { method: 'GET', path: '/api/mcp/servers', operationId: 'mcp.servers', tags: ['mcp'], response: McpServersResponse },
  { method: 'POST', path: '/api/mcp/:name/connect', operationId: 'mcp.connect', tags: ['mcp'] },
  { method: 'POST', path: '/api/mcp/:name/disconnect', operationId: 'mcp.disconnect', tags: ['mcp'] },
  { method: 'POST', path: '/api/mcp/config/preview', operationId: 'mcp.configPreview', tags: ['mcp'] },
  { method: 'POST', path: '/api/mcp/config/preview-remove', operationId: 'mcp.configPreviewRemove', tags: ['mcp'] },
  { method: 'POST', path: '/api/mcp/config/apply', operationId: 'mcp.configApply', tags: ['mcp'] },
  { method: 'POST', path: '/api/mcp/config/restore', operationId: 'mcp.configRestore', tags: ['mcp'] },
  { method: 'DELETE', path: '/api/mcp/config/servers/:name', operationId: 'mcp.configRemove', tags: ['mcp'] },
  { method: 'POST', path: '/api/mafw-commands/run', operationId: 'mafwCommands.run', tags: ['mafwCommands'] },
  { method: 'GET', path: '/api/mafw-commands', operationId: 'mafwCommands.list', tags: ['mafwCommands'], response: MafwCommandsListResponse },
  { method: 'GET', path: '/api/manager/session', operationId: 'manager.session', tags: ['manager'], response: ManagerSessionResponse },
  { method: 'POST', path: '/api/manager/session/rotate', operationId: 'manager.rotate', tags: ['manager'] },
  { method: 'GET', path: '/api/projects', operationId: 'project.list', tags: ['project'], response: ProjectListResponse },
  { method: 'GET', path: '/api/projects/current', operationId: 'project.current', tags: ['project'], response: ProjectCurrentResponse },
  { method: 'POST', path: '/register', operationId: 'project.setCurrent', tags: ['project'] },
  { method: 'POST', path: '/api/file-history/snapshot', operationId: 'fileHistory.snapshot', tags: ['internal'] },
  { method: 'GET', path: '/api/file-history', operationId: 'fileHistory.list', tags: ['internal'], response: FileHistoryListResponse },
  { method: 'POST', path: '/api/file-history/restore', operationId: 'fileHistory.restore', tags: ['internal'] },
  { method: 'GET', path: '/api/events', operationId: 'event.subscribe', tags: ['event'] },
  { method: 'POST', path: '/api/events', operationId: 'event.publish', tags: ['event'] },
  { method: 'GET', path: '/api/runtime', operationId: 'runtime.get', tags: ['runtime'], response: RuntimeGetResponse },
  { method: 'GET', path: '/api/runtime/contract', operationId: 'runtime.contract', tags: ['runtime'], response: RuntimeContractResponse },
  { method: 'POST', path: '/api/runtime/switch', operationId: 'runtime.switch', tags: ['runtime'] },
  { method: 'POST', path: '/api/runtime/restart-agent', operationId: 'runtime.restartAgent', tags: ['runtime'] },
  // runtime.reload（POST /api/runtime/reload）在下方 NON_SDK 补遗块登记（SDK 不调用 → internal）
  { method: 'GET', path: '/api/plugins', operationId: 'plugins.list', tags: ['plugins'], response: PluginsListResponse },
  { method: 'GET', path: '/api/plugins/client', operationId: 'plugins.client', tags: ['plugins'], response: PluginsClientResponse },
  { method: 'POST', path: '/api/plugins/install', operationId: 'plugins.install', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/packages/install', operationId: 'plugins.installPackage', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/check', operationId: 'plugins.check', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/enable', operationId: 'plugins.enable', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/disable', operationId: 'plugins.disable', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/delete', operationId: 'plugins.delete', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/:name/apply', operationId: 'plugins.apply', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/:name/reload', operationId: 'plugins.reload', tags: ['plugins'] },
  { method: 'POST', path: '/api/plugins/:name/actions/:action', operationId: 'plugins.invoke', tags: ['plugins'] },
  // Plugin web surfaces (spec 2026-11-09 §5.5): the desktop main process mints
  // the package-bound ticket through the SDK; asset/events stay browser-only
  // (internal, see NON_SDK_ROUTES).
  { method: 'POST', path: '/api/plugins/:name/web-ticket', operationId: 'plugins.webTicket', tags: ['plugins'] },
  { method: 'GET', path: '/api/config', operationId: 'config.get', tags: ['config'], response: ConfigGetResponse },
  { method: 'PUT', path: '/api/config', operationId: 'config.set', tags: ['config'] },
  { method: 'GET', path: '/api/runtime-config', operationId: 'runtime.config.get', tags: ['runtime'], response: RuntimeConfigGetResponse },
  { method: 'PATCH', path: '/api/runtime-config', operationId: 'runtime.config.update', tags: ['runtime'] },
  { method: 'GET', path: '/api/goals', operationId: 'goals.list', tags: ['goals'], response: GoalListResponse },
  { method: 'GET', path: '/api/goals/:id', operationId: 'goals.get', tags: ['goals'], response: GoalViewSchema },
  { method: 'GET', path: '/api/goals/:id/plan', operationId: 'goals.plan', tags: ['goals'], response: GoalPlanResponse },
  { method: 'POST', path: '/api/goals/:id/plan-approval', operationId: 'goals.planApproval', tags: ['goals'] },
  { method: 'GET', path: '/api/goals/:id/sessions', operationId: 'goals.sessions', tags: ['goals'], response: GoalSessionsResponse },
  { method: 'GET', path: '/api/goals/:id/timeline', operationId: 'goals.timeline', tags: ['goals'], response: GoalTimelineResponse },
  { method: 'GET', path: '/api/goals/:id/source', operationId: 'goals.source', tags: ['goals'], response: GoalSourceResponse },
  { method: 'GET', path: '/api/lead/context', operationId: 'lead.context', tags: ['internal'], response: LeadContextResponse },
  { method: 'GET', path: '/api/attention', operationId: 'attention.list', tags: ['internal'], response: AttentionListResponse },
  { method: 'GET', path: '/api/decisions', operationId: 'decisions.list', tags: ['internal'], response: DecisionListResponse },
  { method: 'POST', path: '/api/decisions', operationId: 'decisions.draft', tags: ['internal'] },
  { method: 'POST', path: '/api/decisions/:id/confirm', operationId: 'decisions.confirm', tags: ['internal'] },
  { method: 'POST', path: '/api/decisions/:id/shelve', operationId: 'decisions.shelve', tags: ['internal'] },
  { method: 'POST', path: '/api/decisions/:id/reopen', operationId: 'decisions.reopen', tags: ['internal'] },
  { method: 'GET', path: '/api/scheduler/status', operationId: 'scheduler.status', tags: ['internal'], response: SchedulerStatusResponse },
  { method: 'POST', path: '/api/goals/:id/pause', operationId: 'goals.pause', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/:id/resume', operationId: 'goals.resume', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/:id/stop', operationId: 'goals.stop', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/:id/retry', operationId: 'goals.retry', tags: ['goals'] },
  { method: 'GET', path: '/api/lead/topics/:id/boundaries', operationId: 'lead.boundaries.list', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/topics/:id/boundaries/:bid/accept', operationId: 'lead.boundaries.accept', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/topics/:id/boundaries/:bid/merge', operationId: 'lead.boundaries.merge', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/topics/:id/boundaries/:bid/undo', operationId: 'lead.boundaries.undo', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/boundaries/observe', operationId: 'lead.boundaries.observe', tags: ['internal'] },
  { method: 'GET', path: '/api/event-sources', operationId: 'events.sources.list', tags: ['events'] },
  { method: 'POST', path: '/api/event-sources', operationId: 'events.sources.create', tags: ['events'] },
  { method: 'PATCH', path: '/api/event-sources/:id', operationId: 'events.sources.patch', tags: ['events'] },
  { method: 'GET', path: '/api/event-threads', operationId: 'events.threads.list', tags: ['events'] },
  { method: 'GET', path: '/api/event-threads/:id/triggers', operationId: 'events.threads.triggers', tags: ['events'] },
  { method: 'POST', path: '/api/event-threads/:id/close', operationId: 'events.threads.close', tags: ['events'] },
  { method: 'GET', path: '/api/event-threads/:id/subscriptions', operationId: 'events.threads.subscriptions.list', tags: ['events'] },
  { method: 'POST', path: '/api/event-threads/:id/subscriptions', operationId: 'events.threads.subscriptions.create', tags: ['events'] },
  { method: 'DELETE', path: '/api/event-subscriptions/:id', operationId: 'events.subscriptions.delete', tags: ['events'] },
  { method: 'GET', path: '/api/event-deliveries', operationId: 'events.deliveries.list', tags: ['events'] },
  { method: 'POST', path: '/api/event-sources/:id/webhook', operationId: 'events.webhook.receive', tags: ['internal'] },
  { method: 'GET', path: '/api/standing-goals', operationId: 'standingGoals.list', tags: ['standing'] },
  { method: 'POST', path: '/api/standing-goals', operationId: 'standingGoals.create', tags: ['standing'] },
  { method: 'PATCH', path: '/api/standing-goals/:id', operationId: 'standingGoals.update', tags: ['standing'] },
  { method: 'GET', path: '/api/standing-goals/:id/runs', operationId: 'standingGoals.runs', tags: ['standing'] },
  { method: 'POST', path: '/api/standing-goals/:id/pause', operationId: 'standingGoals.pause', tags: ['standing'] },
  { method: 'POST', path: '/api/standing-goals/:id/resume', operationId: 'standingGoals.resume', tags: ['standing'] },
  { method: 'POST', path: '/api/standing-goals/:id/stop', operationId: 'standingGoals.stop', tags: ['standing'] },
  { method: 'POST', path: '/api/standing-goals/:id/run', operationId: 'standingGoals.run', tags: ['standing'] },
  { method: 'POST', path: '/api/goal-runs/:id/approve', operationId: 'goalRuns.approve', tags: ['standing'] },
  { method: 'GET', path: '/api/lead/topics', operationId: 'lead.topics.list', tags: ['lead'] },
  { method: 'GET', path: '/api/lead/topics/:id', operationId: 'lead.topics.get', tags: ['lead'] },
  { method: 'GET', path: '/api/lead/working-set', operationId: 'lead.workingSet', tags: ['lead'], response: LeadWorkingSetResponse },
  { method: 'GET', path: '/api/lead/recall', operationId: 'lead.recall', tags: ['lead'], response: LeadRecallResponse },
  { method: 'POST', path: '/api/lead/compact', operationId: 'lead.compact', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/topics/:id/resume', operationId: 'lead.topics.resume', tags: ['lead'] },
  { method: 'POST', path: '/api/lead/topics/:id/fork', operationId: 'lead.topics.fork', tags: ['lead'] },
  { method: 'POST', path: '/api/goals/:id/nodes/:runId/retry', operationId: 'goals.retryNode', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/:goalId/questions/:questionId/respond', operationId: 'goals.respondQuestion', tags: ['goals'] },
  { method: 'POST', path: '/api/work/:goalId/validate', operationId: 'goals.validate', tags: ['goals'] },
  { method: 'POST', path: '/api/goals/control', operationId: 'goals.control', tags: ['goals'] },
  { method: 'GET', path: '/api/memory/search', operationId: 'memory.search', tags: ['memory'], response: MemorySearchResponse },
  { method: 'GET', path: '/api/memory/merged-search', operationId: 'memory.mergedSearch', tags: ['memory'], response: MemoryMergedSearchResponse },
  { method: 'GET', path: '/api/memory/energy-distribution', operationId: 'memory.getEnergyDistribution', tags: ['memory'], response: MemoryEnergyDistributionResponse },
  { method: 'GET', path: '/api/l5/axioms', operationId: 'memory.getL5Axioms', tags: ['memory'], response: MemoryL5AxiomsResponse },
  { method: 'DELETE', path: '/api/memory/:id', operationId: 'memory.delete', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/sticky', operationId: 'memory.listSticky', tags: ['memory'], response: MemoryStickyResponse },
  { method: 'POST', path: '/api/memory/pin', operationId: 'memory.setSticky', tags: ['memory'] },
  { method: 'GET', path: '/api/memory/embedding-config', operationId: 'embedding.get', tags: ['embedding'], response: EmbeddingGetResponse },
  { method: 'POST', path: '/api/memory/embedding-config', operationId: 'embedding.update', tags: ['embedding'] },
  { method: 'GET', path: '/api/approvals', operationId: 'approvals.list', tags: ['approvals'], response: ApprovalListResponse },
  { method: 'POST', path: '/api/approvals/:id/respond', operationId: 'approvals.respond', tags: ['approvals'] },
  { method: 'GET', path: '/api/triage', operationId: 'triage.list', tags: ['triage'], response: TriageListResponse },
  { method: 'POST', path: '/api/triage/:id/dismiss', operationId: 'triage.dismiss', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/confirm', operationId: 'triage.confirm', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/reject', operationId: 'triage.reject', tags: ['triage'] },
  { method: 'POST', path: '/api/triage/:id/propose', operationId: 'triage.propose', tags: ['triage'] },
  { method: 'POST', path: '/api/skills/:name/deopt', operationId: 'skills.deopt', tags: ['internal'] },
  { method: 'GET', path: '/api/skills', operationId: 'skills.list', tags: ['internal'], response: SkillsListResponse },
  { method: 'GET', path: '/api/questions', operationId: 'questions.list', tags: ['questions'], response: QuestionListResponse },
  { method: 'POST', path: '/api/questions/:id/reply', operationId: 'questions.reply', tags: ['questions'] },
  { method: 'POST', path: '/api/questions/:id/reject', operationId: 'questions.reject', tags: ['questions'] },
  { method: 'GET', path: '/api/permissions', operationId: 'permissions.list', tags: ['permissions'], response: PermissionListResponse },
  { method: 'POST', path: '/api/permissions/:id/reply', operationId: 'permissions.reply', tags: ['permissions'] },
  { method: 'GET', path: '/api/sessions/:sid/permission-mode', operationId: 'permissions.getMode', tags: ['permissions'], response: PermissionModeResponse },
  { method: 'POST', path: '/api/sessions/:sid/permission-mode', operationId: 'permissions.setMode', tags: ['permissions'] },
  { method: 'GET', path: '/api/approvals/allowlist', operationId: 'permissions.listAllowlist', tags: ['permissions'], response: AllowlistListResponse },
  { method: 'POST', path: '/api/approvals/allowlist', operationId: 'permissions.addAllowlist', tags: ['permissions'] },
  { method: 'DELETE', path: '/api/approvals/allowlist', operationId: 'permissions.removeAllowlist', tags: ['permissions'] },
  { method: 'GET', path: '/api/approvals/rules', operationId: 'permissions.listRules', tags: ['permissions'], response: PermissionRulesListResponse },
  { method: 'POST', path: '/api/approvals/rules', operationId: 'permissions.addRule', tags: ['permissions'] },
  { method: 'DELETE', path: '/api/approvals/rules', operationId: 'permissions.removeRule', tags: ['permissions'] },
  { method: 'POST', path: '/api/chat', operationId: 'chat.send', tags: ['chat'] },
  { method: 'POST', path: '/api/chat/enriched', operationId: 'chat.sendEnriched', tags: ['chat'] },
  { method: 'GET', path: '/api/media/plugins', operationId: 'media.plugins', tags: ['media'], response: MediaPluginsResponse },
  { method: 'POST', path: '/api/media/switch', operationId: 'media.switch', tags: ['media'] },
  { method: 'POST', path: '/api/media/upload', operationId: 'media.upload', tags: ['media'] },
  { method: 'POST', path: '/api/media/upload-and-create', operationId: 'media.uploadAndCreate', tags: ['media'] },
  { method: 'POST', path: '/a2a', operationId: 'media.createTask', tags: ['media'] },
  { method: 'GET', path: '/a2a/artifacts/:id', operationId: 'media.artifact', tags: ['media'] },
  { method: 'POST', path: '/api/tts', operationId: 'tts.speak', tags: ['tts'] },
  { method: 'GET', path: '/api/tts/voices', operationId: 'tts.voices', tags: ['tts'], response: TtsVoicesResponse },
  { method: 'POST', path: '/api/tts/stream', operationId: 'tts.speakStream', tags: ['tts'] },
  { method: 'POST', path: '/api/tts/interrupt', operationId: 'tts.interrupt', tags: ['tts'] },
  { method: 'GET', path: '/api/voice/status', operationId: 'voice.status', tags: ['voice'], response: VoiceStatusResponse },
  { method: 'GET', path: '/api/provider', operationId: 'providers.list', tags: ['providers'], response: ProviderListResponse },
  { method: 'GET', path: '/api/agents', operationId: 'agents.list', tags: ['agents'], response: AgentListResponse },
  { method: 'GET', path: '/api/model-config', operationId: 'models.get', tags: ['models'], response: ModelConfigGetResponse },
  { method: 'POST', path: '/api/model-config', operationId: 'models.update', tags: ['models'] },
  { method: 'GET', path: '/api/automations', operationId: 'automations.list', tags: ['automations'] },
  { method: 'PUT', path: '/api/automations/:id', operationId: 'automations.toggle', tags: ['automations'] },
  { method: 'DELETE', path: '/api/automations/:id', operationId: 'automations.remove', tags: ['automations'] },
  { method: 'POST', path: '/api/automations/draft', operationId: 'automations.draft', tags: ['automations'] },
  { method: 'GET', path: '/api/projects/:projectId/work', operationId: 'work.overview', tags: ['work'], response: WorkOverviewResponse },
  { method: 'GET', path: '/api/projects/:projectId/pod', operationId: 'pods.ensure', tags: ['pods'] },
  { method: 'GET', path: '/api/projects/:projectId/pod/lookup', operationId: 'pods.lookup', tags: ['pods'], response: PodDetailResponse },
  { method: 'POST', path: '/api/projects/:projectId/pod', operationId: 'pods.create', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId', operationId: 'pods.get', tags: ['pods'], response: PodDetailResponse },
  { method: 'PATCH', path: '/api/pods/:podId', operationId: 'pods.update', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/lead/ensure', operationId: 'pods.lead.ensure', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/tasks', operationId: 'pods.tasks.list', tags: ['pods'], response: PodTasksResponse },
  { method: 'POST', path: '/api/pods/:podId/tasks', operationId: 'pods.tasks.create', tags: ['pods'] },
  { method: 'PATCH', path: '/api/pods/:podId/tasks/:taskId', operationId: 'pods.tasks.update', tags: ['pods'] },
  { method: 'DELETE', path: '/api/pods/:podId/tasks/:taskId', operationId: 'pods.tasks.delete', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/messages', operationId: 'pods.messages.list', tags: ['pods'], response: PodMessagesResponse },
  { method: 'POST', path: '/api/pods/:podId/messages', operationId: 'pods.messages.create', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/messages/:messageId/read', operationId: 'pods.messages.read', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/messages/:messageId/delivery/retry', operationId: 'pods.messages.delivery.retry', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/messages/:messageId/delivery/dismiss', operationId: 'pods.messages.delivery.dismiss', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/wake', operationId: 'pods.wake', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/sleep', operationId: 'pods.sleep', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/cost', operationId: 'pods.cost', tags: ['pods'], response: PodCostResponse },
  { method: 'GET', path: '/api/pods/:podId/goals', operationId: 'pods.goals', tags: ['pods'], response: PodGoalsResponse },
  { method: 'POST', path: '/api/pods/:podId/goals', operationId: 'pods.goals.create', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/handoff', operationId: 'pods.goals.handoff', tags: ['pods'] },
  { method: 'DELETE', path: '/api/pods/:podId/goals/:goalId', operationId: 'pods.goals.cancel', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/result', operationId: 'pods.goals.result', tags: ['pods'], response: PodGoalResultResponse },
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/review-items', operationId: 'pods.goals.reviewItems', tags: ['pods'], response: PodReviewItemsResponse },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/review-items', operationId: 'pods.goals.reviewItems.create', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/review-items/:itemId/resolve', operationId: 'pods.goals.reviewItems.resolve', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/review-items/:itemId/reopen', operationId: 'pods.goals.reviewItems.reopen', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/accept', operationId: 'pods.goals.accept', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/worktree/diff', operationId: 'pods.goals.worktree.diff', tags: ['pods'], response: PodWorktreeDiffResponse },
  { method: 'GET', path: '/api/pods/:podId/sessions/:sessionId/transcript', operationId: 'pods.transcript', tags: ['pods'], response: PodTranscriptResponse },
  { method: 'GET', path: '/api/pods/:podId/memory', operationId: 'pods.memory.get', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/memory', operationId: 'pods.memory.write', tags: ['pods'] },
  // Task 18：直接讨论 Goal 的协作面（Tech Lead 会话 / 方向裁定 / Spike / 打回 / revision）
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/tech-lead', operationId: 'pods.goals.techLead', tags: ['pods'], response: PodTechLeadHistoryResponse },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/tech-lead/messages', operationId: 'pods.goals.techLead.messages', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/direction-decision', operationId: 'pods.goals.direction', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/probes', operationId: 'pods.goals.probes', tags: ['pods'], response: PodProbesResponse },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/probes', operationId: 'pods.goals.probes.create', tags: ['pods'] },
  { method: 'POST', path: '/api/pods/:podId/goals/:goalId/reject', operationId: 'pods.goals.reject', tags: ['pods'] },
  { method: 'GET', path: '/api/pods/:podId/goals/:goalId/revisions', operationId: 'pods.goals.revisions', tags: ['pods'], response: PodGoalRevisionsResponse },
];

/** 非 SDK 端点补充登记（desktop/TUI/worker/dashboard 专用面），operationId 自拟，tags 'internal'。 */
const NON_SDK_ROUTES: RouteDef[] = [
  // Pod A2A endpoint（协议内部面，不进 SDK 契约）
  { method: 'POST', path: '/a2a/pods/:podId', operationId: 'pods.a2a', tags: ['internal'] },
  { method: 'GET', path: '/a2a/pods/:podId/.well-known/agent-card.json', operationId: 'pods.a2aCard', tags: ['internal'] },
  { method: 'GET', path: '/a2a/pods/:podId/artifacts/:artifactId', operationId: 'pods.a2aArtifact', tags: ['internal'] },
  // Python 内核（§5.17）
  { method: 'POST', path: '/api/python/execute', operationId: 'python.execute', tags: ['internal'] },
  { method: 'POST', path: '/api/python/restart', operationId: 'python.restart', tags: ['internal'] },
  { method: 'GET', path: '/api/python/status', operationId: 'python.status', tags: ['internal'], response: PythonStatusResponse },
  // 观察捕获 / 边界 recall / pinned 披露层（§5.11/§5.13）
  { method: 'POST', path: '/api/obs/capture', operationId: 'obs.capture', tags: ['internal'] },
  { method: 'GET', path: '/api/recall/context', operationId: 'recall.context', tags: ['internal'], response: RecallContextResponse },
  { method: 'GET', path: '/api/recall/pinned', operationId: 'recall.pinned', tags: ['internal'], response: RecallPinnedResponse },
  // Task B3：T2-4 fallback 面 / W1 常驻先验块（plugin / pi host extension 消费；
  // 非 SDK 端点 → 与兄弟 NON_SDK 条目一致用 tags ['internal']，SDK 死契约检查据此豁免）
  { method: 'GET', path: '/api/recall/instructions', operationId: 'recall.instructions', tags: ['internal'], response: RecallInstructionsResponse },
  { method: 'GET', path: '/api/recall/priors', operationId: 'recall.priors', tags: ['internal'], response: RecallPriorsResponse },
  // 记忆补充（memory.mergedSearch 已在 SDK-facing，不重复）
  { method: 'POST', path: '/api/memory/add', operationId: 'memory.add', tags: ['internal'] },
  { method: 'GET', path: '/api/memory/get', operationId: 'memory.get', tags: ['internal'], response: MemoryGetResponse },
  { method: 'GET', path: '/api/memory/stats', operationId: 'memory.stats', tags: ['internal'], response: MemoryStatsResponse },
  { method: 'POST', path: '/api/memory/embeddings/backfill', operationId: 'memory.embeddingsBackfill', tags: ['internal'] },
  // Goal / 编排（§5.20）
  { method: 'POST', path: '/api/work/:goalId/complete', operationId: 'goals.complete', tags: ['internal'] },
  { method: 'POST', path: '/control', operationId: 'goals.controlLegacy', summary: 'MCP 兼容别名，与 /api/goals/control 同 handler', tags: ['internal'] },
  { method: 'GET', path: '/api/orchestration/outcomes', operationId: 'orchestration.outcomes', tags: ['internal'] },
  // 媒体补充（media.upload / uploadAndCreate / switch / plugins GET / a2a / artifacts GET 已在 SDK-facing）
  { method: 'POST', path: '/api/media/create-task', operationId: 'media.createTaskApi', tags: ['internal'] },
  { method: 'GET', path: '/api/media/resolve-task/:id', operationId: 'media.resolveTask', tags: ['internal'], response: MediaResolveTaskResponse },
  { method: 'POST', path: '/api/media/analyze-audio', operationId: 'media.analyzeAudio', tags: ['internal'] },
  { method: 'POST', path: '/api/media/plugins/reload', operationId: 'media.pluginsReload', tags: ['internal'] },
  // 用量 dashboard（/api/stats 由 routes/dashboard.ts 挂 handler；其余旧 dashboard
  // 形状在 E3-1 清理：costs/alignment/feedback/userAnswer/session.metrics/health.check
  // 与 gateway.* 控制面只在已删除的死模块 src/dashboard/api.ts 里有实现，从不可达）。
  { method: 'GET', path: '/api/stats', operationId: 'dashboard.stats', tags: ['internal'] },
  // E4-8 内核资源账本快照（internal：desktop/运维诊断面，不进 @mafw/sdk 调用面）。
  {
    method: 'GET',
    path: '/api/kernel/stats',
    operationId: 'kernel.stats',
    summary: 'resource ledger snapshot',
    tags: ['internal'],
    response: KernelStatsResponse,
  },
  // E5b-1：event_log 升序分页恢复源（mobile 重连补齐 / 运维诊断面；internal）。
  // 与 /api/events（SSE，newest-window）互补，不进 @mafw/sdk 调用面。
  {
    method: 'GET',
    path: '/api/events/replay',
    operationId: 'event.replay',
    summary: 'event_log paginated recovery',
    tags: ['internal'],
    response: EventReplayResponse,
  },
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
  // E11-1：human token 轮换。只有 CLI（bin/mafw.js）与运维脚本直接打这个端点，
  // @mafw/sdk 不暴露（raw HTTP + 旧凭据证明占有）→ SDK 死契约门按 operationId
  // 显式豁免（packages/gateway-sdk/src/contract.test.ts 的 NON_SDK_EXEMPT）。
  // 只接受 method === 'human-token' 的 human principal（device/service/loopback 一律 403）。
  {
    method: 'POST',
    path: '/api/human-token/rotate',
    operationId: 'humanToken.rotate',
    summary: 'Rotate the human token and bind it live',
    tags: ['auth'],
    response: HumanTokenRotateResponse,
  },
  // P5 Wave 2 反向审计补遗
  { method: 'GET', path: '/.well-known/agent-card.json', operationId: 'a2a.agentCard', tags: ['internal'] },
  // Task C1：单规则详情 GET /api/automations/:id 未进 @mafw/sdk 调用面
  // （SDK 只有 list/toggle/remove/draft）→ 与 automations.history 同放
  // NON_SDK 并标 internal，SDK 死契约门据此豁免。
  { method: 'GET', path: '/api/automations/:id', operationId: 'automations.get', tags: ['internal'] },
  { method: 'GET', path: '/api/automations/:id/history', operationId: 'automations.history', tags: ['internal'] },
  { method: 'POST', path: '/api/runtime/reload', operationId: 'runtime.reload', tags: ['internal'] },
  { method: 'POST', path: '/api/runtime/dry-event', operationId: 'runtime.dryEvent', tags: ['internal'] },
  { method: 'POST', path: '/api/runtime/conformance', operationId: 'runtime.conformance', tags: ['internal'] },
  { method: 'POST', path: '/api/sessions/:sid/permissions/:rid', operationId: 'permissions.replyRuntime', tags: ['internal'] },
  // Task E2：subagent 面对不上 SDK 调用面（packages/gateway-sdk/src/client.ts 无
  // /subagents 调用；packages/runtime-core/src 与 packages/desktop/src 也不发这些
  // 请求，只有 gateway 内 mafw-tools 走 HTTP）→ NON_SDK + internal，SDK 死契约门豁免。
  { method: 'POST', path: '/api/sessions/:id/subagents', operationId: 'session.subagents.spawn', tags: ['internal'] },
  { method: 'GET', path: '/api/sessions/:id/subagents', operationId: 'session.subagents.list', tags: ['internal'], response: SessionSubagentsResponse },
  { method: 'POST', path: '/api/sessions/:id/subagents/:subId/message', operationId: 'session.subagents.message', tags: ['internal'] },
  { method: 'POST', path: '/api/sessions/:id/subagents/:subId/cancel', operationId: 'session.subagents.cancel', tags: ['internal'] },
  { method: 'GET', path: '/api/sessions/:id/subagents/:subId/result', operationId: 'session.subagents.result', tags: ['internal'] },
  { method: 'DELETE', path: '/api/session/:id', operationId: 'session.deleteLegacy', tags: ['internal'] },
  // Eval / LLM 压缩
  { method: 'POST', path: '/api/eval/chat/completions', operationId: 'eval.chatCompletions', tags: ['internal'] },
  { method: 'POST', path: '/api/llm/compress', operationId: 'llm.compress', tags: ['internal'] },
  // 跨 worktree 记忆融合（§5.3）
  { method: 'POST', path: '/api/merge-memory', operationId: 'memory.merge', tags: ['internal'] },
  // 根健康检查（dashboard/桌面探测用）
  { method: 'GET', path: '/health', operationId: 'health.root', tags: ['internal'] },
  // Plugin Web surfaces（spec 2026-11-09 §5.4-§5.6）：asset/events 由浏览器
  // webview 直接消费（不经 SDK）；web-ticket 在 Task 6 起由桌面主进程经 SDK
  // 调用，已登记在 SDK_FACING_ROUTES（此前标 internal 以免 SDK 死契约）。
  { method: 'GET', path: '/api/plugins/:name/ui', operationId: 'plugins.webAsset', tags: ['internal'] },
  { method: 'GET', path: '/api/plugins/:name/events', operationId: 'plugins.webEvents', tags: ['internal'] },
  // MAFW 基础工具面（out-of-process runtime 注册/执行通道；loopback-only）
  { method: 'GET', path: '/api/tools', operationId: 'tools.list', tags: ['internal'], response: ToolsListResponse },
  { method: 'POST', path: '/api/tools/execute', operationId: 'tools.execute', tags: ['internal'] },
  // Agent 自我认知只读面（L1 能力账本 + L2 失败谱；fail-open）
  { method: 'GET', path: '/api/agent/capabilities', operationId: 'agent.capabilities', tags: ['internal'], response: AgentCapabilitiesResponse },
];

/** gateway 全量 HTTP 端点 shadow 登记（无 handler；Phase 3 逐条挂 handler 前不参与 dispatch）。
 *  每次调用返回全新 def 对象（浅拷贝）——attachHandler 会原地改写 def.handler，
 *  共享模块级常量会让第二次 build 的 registry 带上一次的 handler（测试已抓过）。 */
export function buildRouteCatalog(): RouteDef[] {
  return [...SDK_FACING_ROUTES, ...NON_SDK_ROUTES].map((d) => ({ ...d }));
}
