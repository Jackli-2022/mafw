// E10-3: schema coverage ledger.
//
// `scripts/schema-coverage.cjs` parses `route-catalog.ts` (no TS import, no
// generated SDK artifact) and reports how many catalog ops carry a 200
// response schema. This test pins that report against the catalog:
//   - the 164 ops covered through E10h-R1（E10g-fix 的 127 + 2 个写响应 pilot + R1 的
//     35 个 session 写响应：`session.create` / `tasks.submit` / `humanToken.rotate` 之外）
//     (13 pre-E10 + 16 E10 + 8 E10b-1 + 7 E10b-2 +
//     1 E11-1 + 8 E10c-1 + 8 E10d-1 + 8 E10e-1 + 16 E10f-A + 16 E10f-B + 16 E10f-C +
//     8 E10f-D) must each
//     keep their `response` — a silent schema deletion fails here;
//   - the catalog's covered set must equal this manifest exactly (both
//     directions), so a new covered op cannot land without a ledger entry;
//   - the total op count is pinned (318) so an unregistered/new route surfaces
//     instead of drifting the ledger;
//   - the script, spawned as a child process from the gateway root, must report
//     exactly what the catalog says (parser and source cannot drift).
import { execFileSync } from 'child_process';
import * as path from 'path';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

interface CoverageReport {
  total: number;
  covered: number;
  coveredOps: string[];
  byTag: Array<{ tag: string; covered: number; total: number }>;
  uncoveredOps: string[];
  requests: number;
  requestCovered: string[];
  requestTotal: number;
  requestUncovered: string[];
  // E10h: write responses (non-GET ops that declare `response:`).
  writeResponses: number;
  writeResponseCovered: string[];
  writeResponseTotal: number;
}

const GATEWAY_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(GATEWAY_ROOT, 'scripts', 'schema-coverage.cjs');

/** Baseline 分组 (E8 and earlier 13 + 8 session read (E10-1) + 8 pod/work read (E10-2) + 8 goal read (E10b-1) + 7 human-gate/permission read (E10b-2) + 1 human token rotate (E11-1) + 8 memory/recall/lead read (E10c-1) + 8 memory extra / lead.context / pod read (E10d-1) + 8 metadata/registry read (E10e-1) + 16 session/task/terminal/usage read (E10f-A) + 16 project/runtime/metadata read (E10f-B) + 16 goal/lead/event/standing/automation/pod read (E10f-C) + 8 observability/device/A2A read (E10f-D)) = 125 entries; E10f-D 收口时台账 127（含 humanToken.rotate 与 orchestration.outcomes），E10h-P0 +2 → 129，E10h-R1 的 35 个 session 写响应 → 164，E10h-R2 的 35 个 pod/task/terminal/fileHistory 写响应 → 199，E10h-R3 的 31 个 goal/decision/lead/standing/cognition 写响应 → 230，E10h-R4 的 24 个 event/automation/approvals/questions/triage/permissions 写响应 → 254，E10h-R5 的 35 个 mcp/plugins/runtime/config/project/manager/commands/models 写响应 → 289，E10h-R6 的 31 个 memory/media/tts/chat/python/obs/tools/eval/llm/mobile/devices/skills 写响应 → 320（`tts.speakStream` 音频流排除）。 */
const E10_COVERED_OPS = [
  'a2a.agentCard',
  'agent.capabilities',
  'agents.list',
  'approvals.list',
  'approvals.respond',
  'attention.list',
  'automations.draft',
  'automations.get',
  'automations.history',
  'automations.list',
  'automations.remove',
  'automations.toggle',
  'background.jobs.cancel',
  'background.jobs.list',
  'background.jobs.output',
  'chat.send',
  'chat.sendEnriched',
  'cognition.gate',
  'cognition.rewrite',
  'cognition.rules',
  'config.get',
  'config.set',
  'dashboard.stats',
  'decisions.confirm',
  'decisions.draft',
  'decisions.list',
  'decisions.reopen',
  'decisions.shelve',
  'devices.delete',
  'devices.list',
  'devices.register',
  'embedding.get',
  'embedding.update',
  'eval.chatCompletions',
  'event.publish',
  'event.replay',
  'events.deliveries.list',
  'events.deliveries.read',
  'events.deliveries.answer',
  'events.sources.create',
  'events.sources.list',
  'events.sources.patch',
  'events.subscriptions.delete',
  'events.threads.close',
  'events.threads.list',
  'events.threads.subscriptions.create',
  'events.threads.subscriptions.list',
  'events.threads.triggers',
  'events.webhook.receive',
  'experience.actions',
  'fileHistory.list',
  'fileHistory.restore',
  'fileHistory.snapshot',
  'goalRuns.approve',
  'goals.complete',
  'goals.control',
  'goals.controlLegacy',
  'goals.get',
  'goals.list',
  'goals.pause',
  'goals.plan',
  'goals.planApproval',
  'goals.respondQuestion',
  'goals.resume',
  'goals.retry',
  'goals.retryNode',
  'goals.sessions',
  'goals.source',
  'goals.stop',
  'goals.timeline',
  'goals.validate',
  'health.root',
  'humanToken.rotate',
  'kernel.stats',
  'lead.boundaries.accept',
  'lead.boundaries.list',
  'lead.boundaries.merge',
  'lead.boundaries.observe',
  'lead.boundaries.undo',
  'lead.compact',
  'lead.context',
  'lead.recall',
  'lead.topics.fork',
  'lead.topics.get',
  'lead.topics.list',
  'lead.topics.resume',
  'lead.workingSet',
  'llm.compress',
  'mafwCommands.list',
  'mafwCommands.run',
  'manager.rotate',
  'manager.session',
  'mcp.configApply',
  'mcp.configPreview',
  'mcp.configPreviewRemove',
  'mcp.configRemove',
  'mcp.configRestore',
  'mcp.connect',
  'mcp.disconnect',
  'mcp.servers',
  'media.analyzeAudio',
  'media.createTask',
  'media.createTaskApi',
  'media.plugins',
  'media.pluginsReload',
  'media.resolveTask',
  'media.switch',
  'media.upload',
  'media.uploadAndCreate',
  'memory.add',
  'memory.delete',
  'memory.embeddingsBackfill',
  'memory.episodes',
  'memory.get',
  'memory.getEnergyDistribution',
  'memory.getEpisode',
  'memory.getL5Axioms',
  'memory.listSticky',
  'memory.merge',
  'memory.mergedSearch',
  'memory.search',
  'memory.setSticky',
  'memory.stats',
  'mobile.devicesDelete',
  'mobile.devicesList',
  'mobile.devicesRegister',
  'mobile.mediaTaskAsk',
  'mobile.mediaTaskUpload',
  'mobile.pairingCode',
  'mobile.pairingVerify',
  'mobile.remoteAccess',
  'mobile.remoteAccessStatus',
  'models.get',
  'models.update',
  'obs.capture',
  'obs.episodeBoundary',
  'orchestration.outcomes',
  'permissions.addAllowlist',
  'permissions.addRule',
  'permissions.getMode',
  'permissions.list',
  'permissions.listAllowlist',
  'permissions.listRules',
  'permissions.removeAllowlist',
  'permissions.removeRule',
  'permissions.reply',
  'permissions.replyRuntime',
  'permissions.setMode',
  'plugins.apply',
  'plugins.audit',
  'plugins.check',
  'plugins.client',
  'plugins.delete',
  'plugins.disable',
  'plugins.doctor',
  'plugins.doctorAll',
  'plugins.enable',
  'plugins.install',
  'plugins.installPackage',
  'plugins.invoke',
  'plugins.kill',
  'plugins.lastGood',
  'plugins.list',
  'plugins.quarantine',
  'plugins.reload',
  'plugins.resume',
  'plugins.rollback',
  'plugins.unquarantine',
  'plugins.webTicket',
  'pod.events.list',
  'pod.events.seen',
  'pod.events.seenAll',
  'pods.a2a',
  'pods.a2aCard',
  'pods.cost',
  'pods.create',
  'pods.ensure',
  'pods.get',
  'pods.goals',
  'pods.goals.accept',
  'pods.goals.cancel',
  'pods.goals.create',
  'pods.goals.direction',
  'pods.goals.handoff',
  'pods.goals.probes',
  'pods.goals.probes.create',
  'pods.goals.reject',
  'pods.goals.result',
  'pods.goals.reviewItems',
  'pods.goals.reviewItems.create',
  'pods.goals.reviewItems.reopen',
  'pods.goals.reviewItems.resolve',
  'pods.goals.revisions',
  'pods.goals.techLead',
  'pods.goals.techLead.messages',
  'pods.goals.worktree.diff',
  'pods.lead.ensure',
  'pods.lookup',
  'pods.memory.get',
  'pods.memory.write',
  'pods.messages.create',
  'pods.messages.delivery.dismiss',
  'pods.messages.delivery.retry',
  'pods.messages.list',
  'pods.messages.read',
  'pods.sleep',
  'pods.tasks.create',
  'pods.tasks.delete',
  'pods.tasks.list',
  'pods.tasks.update',
  'pods.transcript',
  'pods.update',
  'pods.wake',
  'presence.get',
  'project.current',
  'project.list',
  'project.setCurrent',
  'providers.list',
  'python.execute',
  'python.restart',
  'python.status',
  'questions.list',
  'questions.reject',
  'questions.reply',
  'recall.context',
  'recall.instructions',
  'recall.pinned',
  'recall.priors',
  'recall.topicSet',
  'runtime.config.get',
  'runtime.config.update',
  'runtime.conformance',
  'runtime.contract',
  'runtime.dryEvent',
  'runtime.get',
  'runtime.reload',
  'runtime.restartAgent',
  'runtime.switch',
  'scheduler.status',
  'session.abort',
  'session.background',
  'session.checkpoint',
  'session.checkpoints',
  'session.children',
  'session.command',
  'session.config',
  'session.config.set',
  'session.create',
  'session.data',
  'session.delete',
  'session.deleteLegacy',
  'session.diff',
  'session.discardRun',
  'session.discovery',
  'session.discoveryRefresh',
  'session.discoverySkill',
  'session.discoverySkillInvoke',
  'session.fork',
  'session.get',
  'session.list',
  'session.messages',
  'session.prompt',
  'session.promptAsync',
  'session.queue.cancel',
  'session.queue.clear',
  'session.queue.list',
  'session.rename',
  'session.restoreCheckpoint',
  'session.resume',
  'session.revert',
  'session.revertDiff',
  'session.run',
  'session.structured',
  'session.subagents.cancel',
  'session.subagents.list',
  'session.subagents.message',
  'session.subagents.result',
  'session.subagents.spawn',
  'session.summarize',
  'session.suspend',
  'session.switchAgent',
  'session.switchModel',
  'session.todo',
  'session.tokenSummary',
  'session.trajectory',
  'session.unrevert',
  'session.usage',
  'session.usagePluginSourceGet',
  'session.usagePluginSourcePut',
  'session.usagePluginTest',
  'session.usagePluginsCreate',
  'session.usagePluginsDelete',
  'session.usagePluginsList',
  'session.usagePluginsReload',
  'session.usageSummary',
  'skills.deopt',
  'skills.list',
  'standingGoals.create',
  'standingGoals.list',
  'standingGoals.pause',
  'standingGoals.resume',
  'standingGoals.run',
  'standingGoals.runs',
  'standingGoals.stop',
  'standingGoals.update',
  'structured.submit',
  'tasks.cancel',
  'tasks.get',
  'tasks.list',
  'tasks.message',
  'tasks.output',
  'tasks.submit',
  'terminal.connectTicket',
  'terminal.create',
  'terminal.list',
  'terminal.remove',
  'tools.execute',
  'tools.list',
  'triage.confirm',
  'triage.dismiss',
  'triage.list',
  'triage.propose',
  'triage.reject',
  'tts.interrupt',
  'tts.speak',
  'tts.voices',
  'voice.status',
  'work.overview',
];

// Pinned: 317 through E10b, +1 for `humanToken.rotate` (E11-1) = 318,
// +7 Phase 6 device-trust routes = 325, +2 last-good/rollback = 327,
// +2 mobile remote access P0 (2026-11-18) = 335.
const TOTAL_OPS = 335;

function catalogOps(): Array<{ operationId: string; hasResponse: boolean }> {
  return buildRouteCatalog().map((def) => ({
    operationId: def.operationId,
    // RouteDef.response is the catalog's single source for the 200 schema.
    hasResponse: Boolean((def as { response?: unknown }).response),
  }));
}

/**
 * E10g: write ops = everything that is not a GET (query-only surface).
 * 188 before main's Phase 6 merge, +7 plugin recovery POSTs + 2 receipt routes = 197.
 */
const WRITE_OPS_TOTAL = 200;

/** P0 pilots：requestBody 管线的第一批（始终保留，不随批次回退）。 */
const E10G_P0_REQUEST_OPS = ['pods.tasks.create', 'session.create', 'tasks.submit'];

/**
 * E10h-P0：200 响应管线的第一批（`humanToken.rotate` 是 E11-1 的存量写响应）。
 * 后续 R1-R6 只追加；本清单钉住「这两个 op 的 `response:` 不被误删」。
 */
const E10H_P0_WRITE_RESPONSE_OPS = ['session.create', 'tasks.submit'];

/**
 * E10h-R1：session 域 35 个写 op 的 200 响应。P0 的 2 个 + 存量
 * `humanToken.rotate` 与这批同属一个台账；本清单按名钉住每个 op 的 `response:`。
 */
const E10H_R1_WRITE_RESPONSE_OPS = [
  'session.abort',
  'session.background',
  'session.checkpoint',
  'session.command',
  'session.config.set',
  'session.data',
  'session.delete',
  'session.deleteLegacy',
  'session.discardRun',
  'session.discoveryRefresh',
  'session.discoverySkillInvoke',
  'session.fork',
  'session.prompt',
  'session.promptAsync',
  'session.queue.cancel',
  'session.queue.clear',
  'session.rename',
  'session.restoreCheckpoint',
  'session.resume',
  'session.revert',
  'session.revertDiff',
  'session.subagents.cancel',
  'session.subagents.message',
  'session.subagents.spawn',
  'session.summarize',
  'session.suspend',
  'session.switchAgent',
  'session.switchModel',
  'session.unrevert',
  'session.usagePluginSourcePut',
  'session.usagePluginTest',
  'session.usagePluginsCreate',
  'session.usagePluginsDelete',
  'session.usagePluginsReload',
  'structured.submit',
];

/**
 * R1 中 handler 逐字 `json(200, {})` 的四个动作：schema 是空对象（无 properties）。
 * `session.command` 是 runtime 边界（open object），故意不在此列。
 */
const E10H_R1_EMPTY_RESPONSE_OPS = [
  'session.background',
  'session.revert',
  'session.summarize',
  'session.unrevert',
];

/**
 * E10h-R2：pod（含 pod.events.* / tasks / messages / goals / reviewItems / memory /
 * a2a）+ task / terminal / background / fileHistory 共 35 个写 op 的 200 响应。
 * 与 R1 同一台账；按名钉住，删一个 `response:` 立刻按名失败。
 */
const E10H_R2_WRITE_RESPONSE_OPS = [
  'background.jobs.cancel',
  'fileHistory.restore',
  'fileHistory.snapshot',
  'pod.events.seen',
  'pod.events.seenAll',
  'pods.a2a',
  'pods.create',
  'pods.goals.accept',
  'pods.goals.cancel',
  'pods.goals.create',
  'pods.goals.direction',
  'pods.goals.handoff',
  'pods.goals.probes.create',
  'pods.goals.reject',
  'pods.goals.reviewItems.create',
  'pods.goals.reviewItems.reopen',
  'pods.goals.reviewItems.resolve',
  'pods.goals.techLead.messages',
  'pods.lead.ensure',
  'pods.memory.write',
  'pods.messages.create',
  'pods.messages.delivery.dismiss',
  'pods.messages.delivery.retry',
  'pods.messages.read',
  'pods.sleep',
  'pods.tasks.create',
  'pods.tasks.delete',
  'pods.tasks.update',
  'pods.update',
  'pods.wake',
  'tasks.cancel',
  'tasks.message',
  'terminal.connectTicket',
  'terminal.create',
  'terminal.remove',
];

/**
 * E10h-R3：goal / decision / lead / standing / cognition 共 31 个写 op 的 200 响应。
 * 与 R1/R2 同一台账（73 → 104）；按名钉住，删一个 `response:` 立刻按名失败。
 */
const E10H_R3_WRITE_RESPONSE_OPS = [
  'cognition.gate',
  'cognition.rewrite',
  'decisions.confirm',
  'decisions.draft',
  'decisions.reopen',
  'decisions.shelve',
  'goalRuns.approve',
  'goals.complete',
  'goals.control',
  'goals.controlLegacy',
  'goals.pause',
  'goals.planApproval',
  'goals.respondQuestion',
  'goals.resume',
  'goals.retry',
  'goals.retryNode',
  'goals.stop',
  'goals.validate',
  'lead.boundaries.accept',
  'lead.boundaries.merge',
  'lead.boundaries.observe',
  'lead.boundaries.undo',
  'lead.compact',
  'lead.topics.fork',
  'lead.topics.resume',
  'standingGoals.create',
  'standingGoals.pause',
  'standingGoals.resume',
  'standingGoals.run',
  'standingGoals.stop',
  'standingGoals.update',
];

/**
 * E10h-R4：event / automation / approvals / questions / triage / permissions
 * 共 24 个写 op 的 200 响应。与 R1/R2/R3 同一台账（104 → 128）；
 * 按名钉住，删一个 `response:` 立刻按名失败。
 */
const E10H_R4_WRITE_RESPONSE_OPS = [
  'approvals.respond',
  'automations.draft',
  'automations.remove',
  'automations.toggle',
  'event.publish',
  'events.sources.create',
  'events.sources.patch',
  'events.subscriptions.delete',
  'events.threads.close',
  'events.threads.subscriptions.create',
  'events.webhook.receive',
  'permissions.addAllowlist',
  'permissions.addRule',
  'permissions.removeAllowlist',
  'permissions.removeRule',
  'permissions.reply',
  'permissions.replyRuntime',
  'permissions.setMode',
  'questions.reject',
  'questions.reply',
  'triage.confirm',
  'triage.dismiss',
  'triage.propose',
  'triage.reject',
];

/**
 * E10h-R5：mcp / plugins（含 Phase 6 自愈 8 个）/ runtime / config / project /
 * manager / commands / models 共 35 个写 op 的 200 响应。与 R1-R4 同一台账
 * （128 → 163）；按名钉住，删一个 `response:` 立刻按名失败。
 */
const E10H_R5_WRITE_RESPONSE_OPS = [
  'config.set',
  'mafwCommands.run',
  'manager.rotate',
  'mcp.configApply',
  'mcp.configPreview',
  'mcp.configPreviewRemove',
  'mcp.configRemove',
  'mcp.configRestore',
  'mcp.connect',
  'mcp.disconnect',
  'models.update',
  'plugins.apply',
  'plugins.check',
  'plugins.delete',
  'plugins.disable',
  'plugins.doctor',
  'plugins.doctorAll',
  'plugins.enable',
  'plugins.install',
  'plugins.installPackage',
  'plugins.invoke',
  'plugins.kill',
  'plugins.quarantine',
  'plugins.reload',
  'plugins.resume',
  'plugins.rollback',
  'plugins.unquarantine',
  'plugins.webTicket',
  'project.setCurrent',
  'runtime.config.update',
  'runtime.conformance',
  'runtime.dryEvent',
  'runtime.reload',
  'runtime.restartAgent',
  'runtime.switch',
];

/**
 * E10h-R6：memory / media / tts / chat / python / obs / embedding / tools /
 * eval / llm / mobile / devices / skills 共 32 个写 op 的 200 响应
 * （`tts.speakStream` 是音频流，按 spec §1.1 排除，见 `E10H_R6_EXCLUDED_OPS`；
 * 2026-11-18 追加 `mobile.remoteAccess`）。
 * 与 R1-R5 同一台账（163 → 194）；按名钉住，删一个 `response:` 立刻按名失败。
 */
const E10H_R6_WRITE_RESPONSE_OPS = [
  'chat.send',
  'chat.sendEnriched',
  'devices.delete',
  'devices.register',
  'embedding.update',
  'eval.chatCompletions',
  'llm.compress',
  'media.analyzeAudio',
  'media.createTask',
  'media.createTaskApi',
  'media.pluginsReload',
  'media.switch',
  'media.upload',
  'media.uploadAndCreate',
  'memory.add',
  'memory.delete',
  'memory.embeddingsBackfill',
  'memory.merge',
  'memory.setSticky',
  'mobile.devicesDelete',
  'mobile.devicesRegister',
  'mobile.mediaTaskAsk',
  'mobile.mediaTaskUpload',
  'mobile.pairingVerify',
  'mobile.remoteAccess',
  'obs.capture',
  'python.execute',
  'python.restart',
  'skills.deopt',
  'tools.execute',
  'tts.interrupt',
  'tts.speak',
];

/**
 * R6 的唯一排除项：`tts.speakStream` 的 200 是 `text/event-stream` 的 PCM16
 * 分块流（`data: {data,voice}` … + `{"done":true}`），chunked 流上不是单个
 * JSON 文档。收口 `WRITE_RESPONSE_EXCLUDED` 用它做台账来源。
 */
const E10H_R6_EXCLUDED_OPS: Record<string, string> = {
  'tts.speakStream': 'audio byte stream (SSE PCM16 chunks on text/event-stream); not a single JSON document',
};

/**
 * E10g-W1：session 域写接口（35 个）。P0 的 session.create + 这 35 个 = 38。
 * 后续 W2-W7 只会追加，因此总数断言是下界（`>= 38`），本清单用于钉住
 * 「这一批每个 op 都真的声明了 request」。
 */
const E10G_W1_REQUEST_OPS = [
  'session.abort',
  'session.background',
  'session.checkpoint',
  'session.command',
  'session.config.set',
  'session.data',
  'session.delete',
  'session.deleteLegacy',
  'session.discardRun',
  'session.discoveryRefresh',
  'session.discoverySkillInvoke',
  'session.fork',
  'session.prompt',
  'session.promptAsync',
  'session.queue.cancel',
  'session.queue.clear',
  'session.rename',
  'session.restoreCheckpoint',
  'session.resume',
  'session.revert',
  'session.revertDiff',
  'session.subagents.cancel',
  'session.subagents.message',
  'session.subagents.spawn',
  'session.summarize',
  'session.suspend',
  'session.switchAgent',
  'session.switchModel',
  'session.unrevert',
  'session.usagePluginSourcePut',
  'session.usagePluginTest',
  'session.usagePluginsCreate',
  'session.usagePluginsDelete',
  'session.usagePluginsReload',
  'structured.submit',
];

/** W1 中「无 body / body 被忽略」的动作：空对象 + `required:false`。 */
const E10G_W1_EMPTY_OPS = [
  'session.abort',
  'session.background',
  'session.delete',
  'session.deleteLegacy',
  'session.discoveryRefresh',
  'session.queue.cancel',
  'session.queue.clear',
  'session.subagents.cancel',
  'session.unrevert',
  'session.usagePluginTest',
  'session.usagePluginsDelete',
  'session.usagePluginsReload',
];

/**
 * W1 的「body 可缺省但有字段」动作（`requestRequired:false` + 非空 properties）：
 * `routes/session-run.ts` 读 `reason`（suspend）/ `runId`（resume / discardRun），
 * 全部带 `typeof x === 'string' && x` 守卫 —— 空 body 合法，但字段确实被消费，
 * 因此是 optional body 而不是空对象（E10g-fix F1）。
 */
const E10G_W1_OPTIONAL_OPS = [
  'session.discardRun',
  'session.resume',
  'session.suspend',
];

/**
 * E10g-W2/W3：tasks / terminal / background / fileHistory（8）+ pod 写接口（25）= 33。
 * P0 3 + W1 35 + 这 33 = 71。后续 W4-W7 只会追加，因此总数断言是下界（`>= 71`）。
 */
const E10G_W2W3_REQUEST_OPS = [
  // W2
  'tasks.cancel',
  'tasks.message',
  'terminal.create',
  'terminal.connectTicket',
  'terminal.remove',
  'background.jobs.cancel',
  'fileHistory.snapshot',
  'fileHistory.restore',
  // W3
  'pods.create',
  'pods.update',
  'pods.lead.ensure',
  'pods.tasks.update',
  'pods.tasks.delete',
  'pods.messages.create',
  'pods.messages.read',
  'pods.messages.delivery.retry',
  'pods.messages.delivery.dismiss',
  'pods.wake',
  'pods.sleep',
  'pods.goals.create',
  'pods.goals.handoff',
  'pods.goals.cancel',
  'pods.goals.reviewItems.create',
  'pods.goals.reviewItems.resolve',
  'pods.goals.reviewItems.reopen',
  'pods.goals.accept',
  'pods.memory.write',
  'pods.goals.techLead.messages',
  'pods.goals.direction',
  'pods.goals.probes.create',
  'pods.goals.reject',
  'pod.events.seen',
  'pod.events.seenAll',
];

/**
 * W2/W3 的「body 被完全忽略」动作（空对象 + `required:false`）：
 * tasks.cancel / terminal.remove / background.jobs.cancel（只有 path+query）、
 * pods.create（按 projectId ensure）/ pods.lead.ensure / pods.messages.read /
 * pods.wake / pods.sleep / pod.events.seen（只有路径参数）。
 */
const E10G_W2W3_EMPTY_OPS = [
  'background.jobs.cancel',
  'pod.events.seen',
  'pods.create',
  'pods.lead.ensure',
  'pods.messages.read',
  'pods.sleep',
  'pods.wake',
  'tasks.cancel',
  'terminal.remove',
];

/**
 * W2/W3 的「body 可缺省但有字段」动作（`required:false` + 非空 properties）：
 * 只用于 actor 鉴权（pod）或 query 回退（terminal.connectTicket）。
 */
const E10G_W2W3_OPTIONAL_OPS = [
  'pods.goals.cancel',
  'pods.goals.reviewItems.reopen',
  'pods.goals.reviewItems.resolve',
  'pods.messages.delivery.retry',
  'pods.tasks.delete',
  'terminal.connectTicket',
];

/**
 * E10g-W4：goals / decisions / lead / standing / goalRuns（29 个）。
 * P0 3 + W1 35 + W2W3 33 + 这 29 = 100。后续 W5-W7 只会追加，因此总数断言是下界（`>= 100`）。
 */
const E10G_W4_REQUEST_OPS = [
  // goals
  'goals.planApproval',
  'goals.pause',
  'goals.resume',
  'goals.stop',
  'goals.retry',
  'goals.retryNode',
  'goals.respondQuestion',
  'goals.validate',
  'goals.control',
  'goals.controlLegacy',
  'goals.complete',
  // decisions
  'decisions.draft',
  'decisions.confirm',
  'decisions.shelve',
  'decisions.reopen',
  // lead
  'lead.boundaries.accept',
  'lead.boundaries.merge',
  'lead.boundaries.undo',
  'lead.boundaries.observe',
  'lead.compact',
  'lead.topics.resume',
  'lead.topics.fork',
  // standing + goal run
  'standingGoals.create',
  'standingGoals.update',
  'standingGoals.pause',
  'standingGoals.resume',
  'standingGoals.stop',
  'standingGoals.run',
  'goalRuns.approve',
];

/**
 * W4 的「body 被完全忽略」动作（空对象 + `requestRequired:false`）：
 * goals pause/resume/stop（control handler 只把 runId 给 retry）与 complete
 * （kernel 的 handleComplete 不读 score）、lead boundaries accept/merge/undo
 * （human-only 门只看凭据）、lead.topics.resume（只读路径 id）、standing 生命周期
 * 4 个 + goalRuns.approve（actorSessionID 是禁止字段，不声明）。
 */
const E10G_W4_EMPTY_OPS = [
  'goals.pause',
  'goals.resume',
  'goals.stop',
  'goals.complete',
  'lead.boundaries.accept',
  'lead.boundaries.merge',
  'lead.boundaries.undo',
  'lead.topics.resume',
  'standingGoals.pause',
  'standingGoals.resume',
  'standingGoals.stop',
  'standingGoals.run',
  'goalRuns.approve',
];

/**
 * W4 的「body 可缺省但有字段」动作（`requestRequired:false` + 非空 properties）：
 * 字段只是补充信息/门禁（retry 的 runId、retryNode 的 confirm、validate 的
 * projectDir、decision confirm/reopen 的说明、fork 的 goalTitle）。
 */
const E10G_W4_OPTIONAL_OPS = [
  'goals.retry',
  'goals.retryNode',
  'goals.validate',
  'decisions.confirm',
  'decisions.reopen',
  'lead.topics.fork',
];

/**
 * E10g-W5：events / automations / approvals / questions / triage / permissions（24 个）。
 * P0 3 + W1 35 + W2W3 33 + W4 29 + 这 24 = 124。后续 W6-W7 只会追加，
 * 因此总数断言是下界（`>= 124`）。
 */
const E10G_W5_REQUEST_OPS = [
  // events
  'event.publish',
  'events.sources.create',
  'events.sources.patch',
  'events.threads.close',
  'events.threads.subscriptions.create',
  'events.subscriptions.delete',
  'events.webhook.receive',
  // automations
  'automations.toggle',
  'automations.remove',
  'automations.draft',
  // approvals / questions
  'approvals.respond',
  'questions.reply',
  'questions.reject',
  // triage
  'triage.dismiss',
  'triage.confirm',
  'triage.reject',
  'triage.propose',
  // permissions
  'permissions.reply',
  'permissions.setMode',
  'permissions.addAllowlist',
  'permissions.removeAllowlist',
  'permissions.addRule',
  'permissions.removeRule',
  'permissions.replyRuntime',
];

/**
 * W5 的「body 被完全忽略」动作（空对象 + `requestRequired:false`）：
 * `events.threads.close` / `events.subscriptions.delete`（只读路径 id）、
 * `automations.remove`（只读路径 id）、`questions.reject`（只 requestID + workspace
 * 回退链）、`triage.confirm` / `reject` / `dismiss`（分支由磁盘 item 决定，只做 human gate）。
 */
const E10G_W5_EMPTY_OPS = [
  'automations.remove',
  'events.subscriptions.delete',
  'events.threads.close',
  'questions.reject',
  'triage.confirm',
  'triage.dismiss',
  'triage.reject',
];

/**
 * W5 的协议透传边界（`requestRequired:false` + `additionalProperties:true` +
 * 无 `properties`）：`events.webhook.receive` 的 body 由上游源定义，gateway 只把
 * body + rawBody + headers 交给 source adapter，字段面不可枚举。
 */
const E10G_W5_BOUNDARY_OPS = ['events.webhook.receive'];

/**
 * E10g-W6：mcp / plugins / runtime / config / project / manager / commands（26 个）。
 * P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + 这 26 = 150。W7 只会追加，
 * 因此总数断言是下界（`>= 150`）。
 *
 * `plugins.install` 不在清单里：它读原始 `.js` 字节（`readBodyBuffer`）+ query
 * （filename/type/overwrite），没有 JSON body —— 按 spec §1.3 排除，
 * 见 `E10G_W6_EXCLUDED_OPS`（收口台账 `REQUEST_EXCLUDED` 的唯一来源）。
 */
const E10G_W6_REQUEST_OPS = [
  // mcp
  'mcp.connect',
  'mcp.disconnect',
  'mcp.configPreview',
  'mcp.configPreviewRemove',
  'mcp.configApply',
  'mcp.configRestore',
  'mcp.configRemove',
  // plugins
  'plugins.installPackage',
  'plugins.check',
  'plugins.enable',
  'plugins.disable',
  'plugins.delete',
  'plugins.apply',
  'plugins.reload',
  'plugins.invoke',
  'plugins.webTicket',
  // runtime
  'runtime.switch',
  'runtime.restartAgent',
  'runtime.reload',
  'runtime.dryEvent',
  'runtime.conformance',
  'runtime.config.update',
  // config / project / manager / commands
  'config.set',
  'project.setCurrent',
  'manager.rotate',
  'mafwCommands.run',
];

/**
 * W6 的「body 被完全忽略」动作（空对象 + `requestRequired:false`）：
 * `mcp.connect` / `mcp.disconnect`（路径 `:name` + query `directory`）、
 * `plugins.apply` / `plugins.reload`（handler `_req`，只读路径 `:name`）、
 * `runtime.restartAgent` / `runtime.reload`（handler 不读 body）。
 */
const E10G_W6_EMPTY_OPS = [
  'mcp.connect',
  'mcp.disconnect',
  'plugins.apply',
  'plugins.reload',
  'runtime.restartAgent',
  'runtime.reload',
];

/**
 * W6 的「body 可缺省但有字段」动作（`requestRequired:false` + 非空 properties）：
 * `plugins.invoke`（空 body → `{}`，`input` 是插件自定义负载）、
 * `runtime.conformance`（缺省跑全部场景）。
 */
const E10G_W6_OPTIONAL_OPS = ['plugins.invoke', 'runtime.conformance'];

/**
 * W6 的协议/所有权边界（开放对象，不枚举字段）：
 *   - `runtime.config.update`：runtime 原生 Config merge 文档，shape 归活跃
 *     runtime 所有，gateway 原样转发（body 必填，空 body 解析失败）；
 *   - `runtime.dryEvent`：runtime 原生事件样本（adapter-owned），顶层
 *     `additionalProperties:true` 以允许「直接事件对象」形态（body 必填）。
 * `plugins.invoke` 的 `input` 边界在 optional 用例里单独断言（顶层 body 有字段）。
 */
const E10G_W6_BOUNDARY_OPS = ['runtime.config.update', 'runtime.dryEvent'];

/**
 * W6 的排除项（不入 request，由收口 `REQUEST_EXCLUDED` 台账记录原因）：
 * `plugins.install` 读原始 `.js` 字节流 + query 元数据，不是 JSON body。
 * 单文件插件仍可经 `plugins.installPackage`（JSON `{ path }`）安装。
 */
const E10G_W6_EXCLUDED_OPS: Record<string, string> = {
  'plugins.install': 'raw .js byte stream (readBodyBuffer) + query filename/type/overwrite; no JSON body',
};

/**
 * E10g-W7：memory / media / tts / chat / python / obs / models / embedding /
 * tools / eval / llm / mobile / devices / a2a / skills（31 个已覆盖；
 * 2026-11-18 追加 `mobile.remoteAccess`）。
 * P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + 这 31 = 181（W8 再补 cognition 2）。
 * 分母 189 = W8 后 183 covered + 6 excluded（W6 1 + W7 5）。
 */
const E10G_W7_REQUEST_OPS = [
  // memory / embedding
  'memory.add',
  'memory.delete',
  'memory.setSticky',
  'memory.embeddingsBackfill',
  'memory.merge',
  'embedding.update',
  // media / tts
  'media.switch',
  'media.createTaskApi',
  'media.analyzeAudio',
  'media.pluginsReload',
  'tts.speak',
  'tts.speakStream',
  'tts.interrupt',
  // chat / python / obs
  'chat.send',
  'chat.sendEnriched',
  'python.execute',
  'python.restart',
  'obs.capture',
  // models / tools / eval / llm
  'models.update',
  'tools.execute',
  'eval.chatCompletions',
  'llm.compress',
  // mobile / devices
  'mobile.mediaTaskAsk',
  'mobile.devicesRegister',
  'mobile.pairingVerify',
  'mobile.remoteAccess',
  'devices.register',
  'devices.delete',
  'mobile.devicesDelete',
  // auth / skills
  'humanToken.rotate',
  'skills.deopt',
];

/**
 * W7 的「body 被忽略」动作（空对象 + `requestRequired:false`）：
 * `memory.delete` / `devices.delete` / `mobile.devicesDelete`（DELETE 只读路径
 * `:id`）、`memory.embeddingsBackfill`（只读 `?limit=N`）、
 * `media.pluginsReload`（handler `_req`）、`humanToken.rotate`（凭据在头部，body 为空）。
 */
const E10G_W7_EMPTY_OPS = [
  'devices.delete',
  'humanToken.rotate',
  'media.pluginsReload',
  'memory.delete',
  'memory.embeddingsBackfill',
  'mobile.devicesDelete',
];

/**
 * W7 的「body 可缺省但有字段」动作（`requestRequired:false` + 非空 properties）：
 * `skills.deopt`（缺失/非法 body 回退默认 reason `manual`）。
 */
const E10G_W7_OPTIONAL_OPS = ['skills.deopt'];

/**
 * W7 的排除项（不入 request，由收口 `REQUEST_EXCLUDED` 台账记录原因）：
 *   - `media.upload` / `media.uploadAndCreate`：原始媒体字节流 + query 元数据；
 *   - `media.createTask`（`POST /a2a`）：A2A JSON-RPC 透传（agent.handleJsonRpc）；
 *   - `mobile.mediaTaskUpload`：multipart/form-data 文件部；
 *   - `pods.a2a`：A2A JSON-RPC 透传（raw body → agent.handleJsonRpc）。
 * 每个 op 的 JSON 替代面都另有一条已覆盖路由（createTaskApi / mediaTaskAsk）。
 */
const E10G_W7_EXCLUDED_OPS: Record<string, string> = {
  'media.createTask': 'A2A JSON-RPC pass-through on POST /a2a (agent.handleJsonRpc); envelope owned by the protocol',
  'media.upload': 'raw media byte stream (for-await chunks) + query type; no JSON body',
  'media.uploadAndCreate': 'raw media byte stream + query type/question; no JSON body',
  'mobile.mediaTaskUpload': 'multipart/form-data file part (boundary parsed in mobile/media-proxy.ts); no JSON body',
  'pods.a2a': 'A2A JSON-RPC pass-through (raw body → PodA2AAgent.handleJsonRpc); envelope owned by the protocol',
};

/**
 * E10g-W8：cognition gate / rewrite（2 个，最后一个写批）。
 * P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + W7 31 + 这 2 = 183。
 * 分母 189 = **183 covered + 6 excluded**（W6 1 + W7 5）；W7 遗留的两个
 * cognition op 在此归位（body 归 cognition gate 契约，handler 是事实源）。
 */
const E10G_W8_REQUEST_OPS = ['cognition.gate', 'cognition.rewrite'];

/**
 * E10g-fix（main Phase 6 集成）：main 新增 7 个 plugin 自愈面 POST。
 * handler 事实（`routes/plugin-packages.ts`）：
 *   - `plugins.quarantine` 读 `{reason}`（缺失 / 空串 → 400），JSON body 必填；
 *   - 其余 6 个只读路径 `:name` 与凭据头部（`_req` / `principalOf(req)` /
 *     `assertHuman(req)`）→ 空对象 + `requestRequired:false`。
 */
const E10G_P6_REQUEST_OPS = [
  'plugins.doctor',
  'plugins.doctorAll',
  'plugins.kill',
  'plugins.quarantine',
  'plugins.resume',
  'plugins.rollback',
  'plugins.unquarantine',
];

/** P6 的「无 body 字段」动作（空对象 + `requestRequired:false`）。 */
const E10G_P6_EMPTY_OPS = [
  'plugins.doctor',
  'plugins.doctorAll',
  'plugins.kill',
  'plugins.resume',
  'plugins.rollback',
  'plugins.unquarantine',
];


function catalogById(): Map<string, { hasRequest: boolean; request?: object; requestRequired?: boolean }> {
  return new Map(
    buildRouteCatalog().map((def) => [
      def.operationId,
      {
        hasRequest: Boolean(def.request),
        request: def.request,
        requestRequired: def.requestRequired,
      },
    ]),
  );
}

function catalogWriteOps(): Array<{ operationId: string; hasRequest: boolean; hasResponse: boolean }> {
  return buildRouteCatalog()
    .filter((def) => def.method !== 'GET')
    .map((def) => ({
      operationId: def.operationId,
      // RouteDef.request / RouteDef.response are the catalog's single source.
      hasRequest: Boolean((def as { request?: unknown }).request),
      hasResponse: Boolean((def as { response?: unknown }).response),
    }));
}

/** E10h: the declared 200 response schema per op (text-level for the empty-body check). */
function catalogResponseById(): Map<string, any> {
  return new Map(buildRouteCatalog().map((def) => [def.operationId, (def as { response?: unknown }).response]));
}

function runScript(): CoverageReport {
  const out = execFileSync(process.execPath, [SCRIPT, '--json'], {
    cwd: GATEWAY_ROOT,
    encoding: 'utf-8',
  });
  return JSON.parse(out) as CoverageReport;
}

describe('schema-coverage: ledger for catalog 200 response schemas (E10-3)', () => {
  it('every op listed in the ledger still declares a response schema', () => {
    const byId = new Map(catalogOps().map((op) => [op.operationId, op.hasResponse]));
    const lost = E10_COVERED_OPS.filter((id) => !byId.get(id));
    // Named so the failure says which schema disappeared, not just "expected true".
    expect(lost).toEqual([]);
  });

  it('the catalog covered set equals the ledger exactly, and the catalog still has 335 ops', () => {
    const ops = catalogOps();
    const covered = ops
      .filter((op) => op.hasResponse)
      .map((op) => op.operationId)
      .sort();
    // Both directions, not just `covered >= ledger.length` (that lenient form let
    // `goals.list` ship covered-but-unlisted in E10b-4): a covered op missing from
    // the ledger lands unrecorded, a ledger op without a schema goes stale.
    expect(covered).toEqual([...E10_COVERED_OPS].sort());
    // Duplicates would mask an alias/typo in the ledger.
    expect(new Set(E10_COVERED_OPS).size).toBe(E10_COVERED_OPS.length);
    // Pinned: a new/removed catalog route must be reflected in the ledger.
    expect(ops.length).toBe(TOTAL_OPS);
  });

  it('the script reports the same numbers as the catalog (no parser drift)', () => {
    const report = runScript();
    const ops = catalogOps();
    const coveredOps = ops.filter((op) => op.hasResponse).map((op) => op.operationId).sort();

    expect(report.total).toBe(TOTAL_OPS);
    expect(report.total).toBe(ops.length);
    expect(report.covered).toBe(coveredOps.length);
    expect(report.coveredOps).toEqual(coveredOps);
    // byTag is a partition of the covered set.
    expect(report.byTag.reduce((n, t) => n + t.covered, 0)).toBe(report.covered);
    // uncovered = total - covered, stable sorted, no overlap.
    expect(report.uncoveredOps).toHaveLength(report.total - report.covered);
    expect([...report.uncoveredOps].sort()).toEqual(report.uncoveredOps);
    const coveredSet = new Set(report.coveredOps);
    expect(report.uncoveredOps.some((id) => coveredSet.has(id))).toBe(false);
  });

  // E10g-P0: request ledger shares the same parser so the write-op denominator
  // (197 after the Phase 6 merge) and the grown coverage set stay pinned while W1-W7 land.
  it('the script reports request coverage over the 200 write ops', () => {
    const report = runScript();
    const write = catalogWriteOps();
    const covered = write.filter((op) => op.hasRequest).map((op) => op.operationId).sort();

    expect(write).toHaveLength(WRITE_OPS_TOTAL);
    expect(report.requestTotal).toBe(WRITE_OPS_TOTAL);
    expect(report.requests).toBe(covered.length);
    expect(report.requestCovered).toEqual(covered);
    expect(report.requestUncovered).toHaveLength(WRITE_OPS_TOTAL - covered.length);
    expect(new Set(report.requestCovered).size).toBe(report.requestCovered.length);
    expect(report.requestUncovered.some((id) => covered.includes(id))).toBe(false);
  });

  it('P0 pilots still declare a request schema', () => {
    const byId = catalogById();
    expect(E10G_P0_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest)).toEqual([]);
  });

  // E10h-P0/R1/R2/R3/R4/R5/R6: write-response ledger. Same parser, same 197 write-op
  // denominator; `humanToken.rotate` (E11-1) + 2 P0 pilots + 35 R1 session writes +
  // 35 R2 pod/task/terminal/fileHistory writes + 31 R3 goal/decision/lead/standing/
  // cognition writes + 24 R4 event/automation/human-gate writes + 35 R5
  // mcp/plugin/runtime/platform writes + 31 R6 memory/media/tts/chat/python/obs/tools/
  // eval/llm/mobile/devices/skills writes = 196/197 (tts.speakStream excluded).
  // Later batches only append, so the count is a floor.
  it('the script reports write-response coverage over the 200 write ops', () => {
    const report = runScript();
    const write = catalogWriteOps();
    const covered = write.filter((op) => op.hasResponse).map((op) => op.operationId).sort();

    expect(write).toHaveLength(WRITE_OPS_TOTAL);
    expect(report.writeResponseTotal).toBe(WRITE_OPS_TOTAL);
    expect(report.writeResponses).toBe(covered.length);
    expect(report.writeResponses).toBeGreaterThanOrEqual(198);
    expect(report.writeResponseCovered).toEqual(covered);
    // Disjoint from the request ledger: the two scans are independent `response:`/
    // `request:` hits on the same write ops — with deliberate exceptions:
    // `pods.a2a` / `media.createTask` (raw A2A JSON-RPC body excluded by E10g; JSON
    // 200 envelope modeled), `plugins.install` (raw `.js` byte stream excluded by
    // E10g; JSON `PluginEntry`), `media.upload` / `media.uploadAndCreate` (raw media
    // bytes excluded; JSON references) and `mobile.mediaTaskUpload` (multipart
    // excluded; JSON task projection).
    const requestCovered = new Set(report.requestCovered);
    expect(report.writeResponseCovered.filter((id) => !requestCovered.has(id)))
      .toEqual([
        'media.createTask',
        'media.upload',
        'media.uploadAndCreate',
        'mobile.mediaTaskUpload',
        'plugins.install',
        'pods.a2a',
      ]);
  });

  it('P0 write-response pilots declare a 200 response schema', () => {
    const byId = catalogById();
    expect(
      E10H_P0_WRITE_RESPONSE_OPS.filter((id) => !catalogWriteOps().some((op) => op.operationId === id && op.hasResponse)),
    ).toEqual([]);
    // Named, so a dropped `response:` on a pilot fails by name (not as a count delta).
    expect(E10H_P0_WRITE_RESPONSE_OPS.filter((id) => !byId.get(id)?.hasRequest)).toEqual([]);
    // A write response for a write op that declared no request would be a shape
    // nobody can construct: every covered write response still has a request, except
    // `pods.a2a` / `media.createTask` (E10g excluded their raw A2A bodies; the 200
    // envelopes are still JSON), `plugins.install` (raw `.js` bytes; 200 is a
    // PluginEntry), `media.upload` / `media.uploadAndCreate` (raw media bytes; 200 is
    // a JSON artifact reference) and `mobile.mediaTaskUpload` (multipart; 200 is a
    // JSON task projection).
    const noRequestButResponded = new Set([
      'media.createTask',
      'media.upload',
      'media.uploadAndCreate',
      'mobile.mediaTaskUpload',
      'plugins.install',
      'pods.a2a',
    ]);
    expect(
      catalogWriteOps()
        .filter((op) => op.hasResponse && !noRequestButResponded.has(op.operationId))
        .map((op) => op.operationId)
        .every((id) => byId.get(id)?.hasRequest),
    ).toBe(true);
  });

  // E10h-R1: session 写响应。P0 的两个 pilot 之外再补 35 个（含 usage plugins /
  // subagents / queue / deleteLegacy），同台账下界 38。按名钉住，删一个 `response:`
  // 立刻按名失败，而不是只掉一个计数。
  it('R1 session write ops declare a 200 response schema (write responses >= 73)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R1_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R1_WRITE_RESPONSE_OPS).toHaveLength(35);
    // No duplicates across P0/R1 (a typo would otherwise hide behind the floor).
    expect(new Set(E10H_R1_WRITE_RESPONSE_OPS).size).toBe(E10H_R1_WRITE_RESPONSE_OPS.length);
    expect(E10H_R1_WRITE_RESPONSE_OPS.filter((id) => E10H_P0_WRITE_RESPONSE_OPS.includes(id))).toEqual([]);
    // 73 = humanToken.rotate + P0 2 + R1 35 + R2 35.
    expect(writes.filter((op) => op.hasResponse).length).toBeGreaterThanOrEqual(73);
  });

  // 这四个 handler 逐字 `json(200, {})`：schema 必须是空对象（无字段），不是「任意 body」。
  // `session.command` 是 runtime 边界，故意 open——不在此清单里（见下一条）。
  it('R1 empty-body actions model `{}` exactly (no invented fields)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    for (const id of E10H_R1_EMPTY_RESPONSE_OPS) {
      const schema = responses.get(id) as { type?: string; properties?: Record<string, unknown>; additionalProperties?: unknown } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length !== 0) {
        problems.push(`${id}: expected empty object, got ${Object.keys(schema.properties ?? {}).join(',')}`);
      }
      // An open object would silently legalize a body the handler never sends.
      if (schema.additionalProperties !== undefined) problems.push(`${id}: must not be open`);
    }
    expect(problems).toEqual([]);
    // The classification is meaningful: the four empty ops are in the R1 ledger …
    expect(E10H_R1_EMPTY_RESPONSE_OPS.filter((id) => !E10H_R1_WRITE_RESPONSE_OPS.includes(id))).toEqual([]);
    // … and the runtime boundary (`command`) is the only open R1 response.
    const command = responses.get('session.command') as { additionalProperties?: unknown } | undefined;
    expect(command?.additionalProperties).toBe(true);
  });

  // E10h-R2: pod / task / terminal / fileHistory 写响应（35 个）。与 R1 同一台账，
  // 下界 73；按名钉住，删一个 `response:` 立刻按名失败。
  it('R2 pod/task/terminal/fileHistory write ops declare a 200 response schema (write responses >= 73)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R2_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R2_WRITE_RESPONSE_OPS).toHaveLength(35);
    // No duplicates inside the batch …
    expect(new Set(E10H_R2_WRITE_RESPONSE_OPS).size).toBe(E10H_R2_WRITE_RESPONSE_OPS.length);
    // … and no overlap with the earlier batches (R2 = the pod/task/terminal/fileHistory
    // writes that R1 left uncovered).
    expect(E10H_R2_WRITE_RESPONSE_OPS.filter((id) => E10H_R1_WRITE_RESPONSE_OPS.includes(id))).toEqual([]);
    expect(E10H_R2_WRITE_RESPONSE_OPS.filter((id) => E10H_P0_WRITE_RESPONSE_OPS.includes(id))).toEqual([]);
    // 73 = humanToken.rotate + P0 2 + R1 35 + R2 35.
    expect(responded.size).toBeGreaterThanOrEqual(73);
    // `pods.a2a` is a JSON 200 with a protocol-owned envelope — covered, not excluded.
    expect(responded.has('pods.a2a')).toBe(true);
  });

  // 本批没有空体 200（handler 都发字段）；唯一不枚举字段的是 A2A 协议边界。
  it('R2 responses model real bodies (no empty shells; a2a is the only open boundary)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    for (const id of E10H_R2_WRITE_RESPONSE_OPS) {
      if (id === 'pods.a2a') continue; // asserted separately below
      const schema = responses.get(id) as {
        type?: string;
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length === 0) problems.push(`${id}: expected declared fields`);
      // A10: an open object would silently legalize fields the handler never sends.
      if (schema.additionalProperties !== undefined) problems.push(`${id}: must not be open`);
    }
    expect(problems).toEqual([]);

    const a2a = responses.get('pods.a2a') as {
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    } | undefined;
    expect(a2a?.additionalProperties).toBe(true);
    expect(Object.keys(a2a?.properties ?? {})).toEqual([]);
  });

  // E10h-R3: goal / decision / lead / standing / cognition 写响应（31 个）。同台账，
  // 下界 104；按名钉住，删一个 `response:` 立刻按名失败。
  it('R3 goal/decision/lead/standing/cognition write ops declare a 200 response schema (write responses >= 104)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R3_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R3_WRITE_RESPONSE_OPS).toHaveLength(31);
    // No duplicates inside the batch …
    expect(new Set(E10H_R3_WRITE_RESPONSE_OPS).size).toBe(E10H_R3_WRITE_RESPONSE_OPS.length);
    // … and no overlap with the earlier batches.
    for (const earlier of [E10H_P0_WRITE_RESPONSE_OPS, E10H_R1_WRITE_RESPONSE_OPS, E10H_R2_WRITE_RESPONSE_OPS]) {
      expect(E10H_R3_WRITE_RESPONSE_OPS.filter((id) => earlier.includes(id))).toEqual([]);
    }
    // 104 = humanToken.rotate + P0 2 + R1 35 + R2 35 + R3 31.
    expect(responded.size).toBeGreaterThanOrEqual(104);
  });

  // 本批 200 全是「常量回执 / 复用读侧 DTO / 判别联合」，没有一个空壳对象；
  // 顶层也不许开放（开放会合法化 handler 不会发的字段）。
  it('R3 responses model real bodies (no empty shells, no open top-level object)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    for (const id of E10H_R3_WRITE_RESPONSE_OPS) {
      const schema = responses.get(id) as {
        type?: string;
        anyOf?: unknown[];
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      // `cognition.gate` 是判别联合（allow/deny/ask/rewrite/transform），其余是对象。
      if (schema.anyOf) {
        if (schema.anyOf.length !== 5) problems.push(`${id}: expected 5 decision branches`);
        continue;
      }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length === 0) problems.push(`${id}: expected declared fields`);
      if (schema.additionalProperties !== undefined) problems.push(`${id}: must not be open`);
    }
    expect(problems).toEqual([]);
  });

  it('R3 shares one schema for same-handler receipts and reuses the read DTOs', () => {
    const responses = catalogResponseById();
    // control / controlLegacy 是同一 handler 的同一 body → 同一个 schema 对象。
    expect(responses.get('goals.control')).toBe(responses.get('goals.controlLegacy'));
    // decisions 四个动作同形 `{record}`（draft 的 schema 被其余三个复用）。
    for (const id of ['decisions.confirm', 'decisions.draft', 'decisions.reopen', 'decisions.shelve']) {
      expect(responses.get(id)).toBe(responses.get('decisions.draft'));
    }
    // standing 生命周期复用读侧 item：[{goal}] / [{run}]。
    const goalItem = (responses.get('standingGoals.list') as any).properties.items.items;
    for (const id of [
      'standingGoals.create', 'standingGoals.update', 'standingGoals.pause',
      'standingGoals.resume', 'standingGoals.stop',
    ]) {
      expect((responses.get(id) as any).properties.goal).toEqual(goalItem);
    }
    const runItem = (responses.get('standingGoals.runs') as any).properties.items.items;
    for (const id of ['standingGoals.run', 'goalRuns.approve']) {
      expect((responses.get(id) as any).properties.run).toEqual(runItem);
    }
  });
  // E10h-R4: event / automation / approvals / questions / triage / permissions 写响应（24 个）。
  // 同台账，下界 128；按名钉住，删一个 `response:` 立刻按名失败。
  it('R4 event/automation/human-gate write ops declare a 200 response schema (write responses >= 128)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R4_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R4_WRITE_RESPONSE_OPS).toHaveLength(24);
    // No duplicates inside the batch …
    expect(new Set(E10H_R4_WRITE_RESPONSE_OPS).size).toBe(E10H_R4_WRITE_RESPONSE_OPS.length);
    // … and no overlap with the earlier batches.
    for (const earlier of [
      E10H_P0_WRITE_RESPONSE_OPS,
      E10H_R1_WRITE_RESPONSE_OPS,
      E10H_R2_WRITE_RESPONSE_OPS,
      E10H_R3_WRITE_RESPONSE_OPS,
    ]) {
      expect(E10H_R4_WRITE_RESPONSE_OPS.filter((id) => earlier.includes(id))).toEqual([]);
    }
    // 128 = humanToken.rotate + P0 2 + R1 35 + R2 35 + R3 31 + R4 24.
    expect(responded.size).toBeGreaterThanOrEqual(128);
  });

  // 本批没有空体 200，也没有顶层开放对象：`events.webhook.receive` 的**请求**是
  // 源定义边界，但 200 是网关自己的回执（`{accepted:true, duplicate}`），所以也闭合。
  it('R4 responses model real bodies (no empty shells, no open top-level object)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    for (const id of E10H_R4_WRITE_RESPONSE_OPS) {
      const schema = responses.get(id) as {
        type?: string;
        anyOf?: unknown[];
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      // `triage.confirm` 是三条成功分支的判别联合（installed / axioms / goalId）。
      if (schema.anyOf) {
        if (schema.anyOf.length !== 3) problems.push(`${id}: expected 3 confirm branches`);
        continue;
      }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length === 0) problems.push(`${id}: expected declared fields`);
      if (schema.additionalProperties !== undefined) problems.push(`${id}: must not be open`);
    }
    expect(problems).toEqual([]);
  });

  it('R4 reuses the read DTOs and keeps the two permission reply receipts apart', () => {
    const responses = catalogResponseById();
    // events.sources.create 与 list item 是同一个 sourceView() 投影。
    expect(responses.get('events.sources.create')).toEqual(
      (responses.get('events.sources.list') as any).properties.items.items,
    );
    // subscriptions.create 返回 store 行本体（与 list item 同形，未做窄投影）。
    expect(responses.get('events.threads.subscriptions.create')).toEqual(
      (responses.get('events.threads.subscriptions.list') as any).properties.items.items,
    );
    // setMode 与 getMode 同形（写入路径只是 autoApprovals 恒为 0）。
    expect(responses.get('permissions.setMode')).toBe(responses.get('permissions.getMode'));
    // 两个 reply 入口刻意不同形：`{status:'ok'}` vs `{success:true}`。
    expect(responses.get('permissions.reply')).not.toBe(responses.get('permissions.replyRuntime'));
    expect(Object.keys((responses.get('permissions.reply') as any).properties)).toEqual(['status']);
    expect(Object.keys((responses.get('permissions.replyRuntime') as any).properties)).toEqual(['success']);
    // `{ok:true}` 共享一个 OkResponse，`{status:'ok'}` 同理。
    for (const id of ['event.publish', 'events.sources.patch', 'events.subscriptions.delete']) {
      expect(responses.get(id)).toBe(responses.get('event.publish'));
    }
    for (const id of ['questions.reject', 'questions.reply', 'permissions.reply']) {
      expect(responses.get(id)).toBe(responses.get('questions.reply'));
    }
  });


  // E10g-W1: session writes. Pinned per-op so a dropped `request:` fails by name,
  // and as a floor (>= 124 through W5) so the count can only grow with W6-W7.
  it('every W1 session write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W1_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([...E10G_P0_REQUEST_OPS, ...E10G_W1_REQUEST_OPS]));
  });

  it('W1 no-body actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W1_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    // The two classifications are disjoint: an empty-object action cannot be
    // one of the JSON-body ops in the W1 list.
    expect(E10G_W1_EMPTY_OPS.filter((id) => !E10G_W1_REQUEST_OPS.includes(id))).toEqual([]);
  });

  it('W1 optional-body actions declare fields but requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W1_OPTIONAL_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length === 0) problems.push(`${id}: expected declared fields, got empty object`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W1_OPTIONAL_OPS.filter((id) => !E10G_W1_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W1_OPTIONAL_OPS.filter((id) => E10G_W1_EMPTY_OPS.includes(id))).toEqual([]);
  });

  // E10g-W2/W3: tasks/terminal/background/fileHistory + pods. Same shape as W1:
  // pinned per-op by name, count floor at 124 (P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24).
  it('every W2/W3 write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W2W3_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
    ]));
  });

  it('W2/W3 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W2W3_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    // Empty-object ops must also be part of the W2/W3 request ledger, and the
    // optional-body ops must be disjoint from them (fields exist there).
    expect(E10G_W2W3_EMPTY_OPS.filter((id) => !E10G_W2W3_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W2W3_EMPTY_OPS.filter((id) => E10G_W2W3_OPTIONAL_OPS.includes(id))).toEqual([]);
  });

  it('W2/W3 optional-body actions declare fields but requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W2W3_OPTIONAL_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length === 0) problems.push(`${id}: expected declared fields, got empty object`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W2W3_OPTIONAL_OPS.filter((id) => !E10G_W2W3_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // E10g-W4: goals / decisions / lead / standing / goalRuns writes. Same shape as
  // W1/W2W3: pinned per-op by name, count floor at 124.
  it('every W4 goal/decision/lead/standing write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W4_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
      ...E10G_W4_REQUEST_OPS,
    ]));
    // No duplicate ids across batches (a typo would hide here otherwise).
    expect(new Set(E10G_W4_REQUEST_OPS).size).toBe(E10G_W4_REQUEST_OPS.length);
  });

  it('W4 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W4_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W4_EMPTY_OPS.filter((id) => !E10G_W4_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W4_EMPTY_OPS.filter((id) => E10G_W4_OPTIONAL_OPS.includes(id))).toEqual([]);
  });

  it('W4 optional-body actions declare fields but requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W4_OPTIONAL_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length === 0) problems.push(`${id}: expected declared fields, got empty object`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W4_OPTIONAL_OPS.filter((id) => !E10G_W4_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // E10g-W5: events / automations / approvals / questions / triage / permissions writes.
  // Same shape as W1-W4: pinned per-op by name, count floor at 124.
  it('every W5 event/automation/human-gate write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W5_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
      ...E10G_W4_REQUEST_OPS,
      ...E10G_W5_REQUEST_OPS,
    ]));
    // No duplicate ids across batches (a typo would hide here otherwise).
    expect(new Set(E10G_W5_REQUEST_OPS).size).toBe(E10G_W5_REQUEST_OPS.length);
  });

  it('W5 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W5_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W5_EMPTY_OPS.filter((id) => !E10G_W5_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W5_EMPTY_OPS.filter((id) => E10G_W5_BOUNDARY_OPS.includes(id))).toEqual([]);
  });

  // The webhook body is source-defined: the boundary is declared as an open object
  // instead of being excluded, so the op still counts as covered in `requests`.
  it('W5 webhook pass-through declares an open-object boundary with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W5_BOUNDARY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const schema = def.request as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      if (Object.keys(schema.properties ?? {}).length !== 0) problems.push(`${id}: boundary must not enumerate properties`);
      if (schema.additionalProperties !== true) problems.push(`${id}: boundary must allow additionalProperties`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W5_BOUNDARY_OPS.filter((id) => !E10G_W5_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // E10g-W6: mcp / plugins / runtime / config / project / manager / commands writes.
  // Same shape as W1-W5: pinned per-op by name, count floor at 150
  // (P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26).
  it('every W6 mcp/plugin/runtime/config/project/manager/command write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W6_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
      ...E10G_W4_REQUEST_OPS,
      ...E10G_W5_REQUEST_OPS,
      ...E10G_W6_REQUEST_OPS,
    ]));
    // No duplicate ids across batches (a typo would hide here otherwise).
    expect(new Set(E10G_W6_REQUEST_OPS).size).toBe(E10G_W6_REQUEST_OPS.length);
  });

  it('W6 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W6_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W6_EMPTY_OPS.filter((id) => !E10G_W6_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W6_EMPTY_OPS.filter((id) => E10G_W6_OPTIONAL_OPS.includes(id))).toEqual([]);
  });

  it('W6 optional-body actions declare fields but requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W6_OPTIONAL_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length === 0) problems.push(`${id}: expected declared fields, got empty object`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W6_OPTIONAL_OPS.filter((id) => !E10G_W6_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // Ownership/protocol boundaries stay documented AND counted: the body is
  // required (an empty body is a 4xx/5xx in the handler), but the shape belongs
  // to the runtime / plugin author, so the object is open with no field list.
  it('W6 runtime/plugin-owned bodies declare an open-object boundary', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W6_BOUNDARY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired === false) problems.push(`${id}: handler rejects an empty body`);
      const schema = def.request as {
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
        anyOf?: unknown;
      };
      if (schema.additionalProperties !== true) problems.push(`${id}: boundary must allow additionalProperties`);
      if (id === 'runtime.config.update' && Object.keys(schema.properties ?? {}).length !== 0) {
        problems.push(`${id}: boundary must not enumerate properties`);
      }
      if (id === 'runtime.dryEvent' && Object.keys(schema.properties ?? {}).length === 0) {
        problems.push(`${id}: envelope fields (event/plugin) must be declared`);
      }
    }
    expect(problems).toEqual([]);
    expect(E10G_W6_BOUNDARY_OPS.filter((id) => !E10G_W6_REQUEST_OPS.includes(id))).toEqual([]);

    // `plugins.invoke.input` is plugin-defined: the field is declared, the
    // payload itself is an open object (never a closed property list).
    const invoke = byId.get('plugins.invoke');
    const input = (invoke?.request as any)?.properties?.input;
    expect(input?.type).toBe('object');
    expect(input?.additionalProperties).toBe(true);
    expect(Object.keys(input?.properties ?? {})).toEqual([]);
  });

  // Exclusions are ledger entries, not silent gaps: W6 contributes exactly one
  // (plugins.install), and it must still exist in the catalog.
  it('W6 exclusions are named with a reason and are still catalog ops', () => {
    const ids = Object.keys(E10G_W6_EXCLUDED_OPS);
    const all = new Set(buildRouteCatalog().map((def) => def.operationId));
    expect(ids.filter((id) => !all.has(id))).toEqual([]);
    for (const [id, reason] of Object.entries(E10G_W6_EXCLUDED_OPS)) {
      expect(`${id}:${reason.length > 0}`).toBe(`${id}:true`);
    }
    // The excluded op is neither covered nor double-counted.
    expect(ids.filter((id) => E10G_W6_REQUEST_OPS.includes(id))).toEqual([]);
    expect(catalogById().get('plugins.install')?.hasRequest).toBe(false);
  });

  // E10g-W7: memory / media / tts / chat / python / obs / models / tools / eval /
  // llm / mobile / devices / a2a / skills writes. Floor at 180
  // (P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + W7 30).
  it('every W7 memory/media/device write op declares a request schema (catalog requests >= 180)', () => {
    const byId = catalogById();
    const missing = E10G_W7_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(180);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
      ...E10G_W4_REQUEST_OPS,
      ...E10G_W5_REQUEST_OPS,
      ...E10G_W6_REQUEST_OPS,
      ...E10G_W7_REQUEST_OPS,
    ]));
    // No duplicate ids across batches (a typo would hide here otherwise).
    expect(new Set(E10G_W7_REQUEST_OPS).size).toBe(E10G_W7_REQUEST_OPS.length);
  });

  it('W7 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W7_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W7_EMPTY_OPS.filter((id) => !E10G_W7_REQUEST_OPS.includes(id))).toEqual([]);
    expect(E10G_W7_EMPTY_OPS.filter((id) => E10G_W7_OPTIONAL_OPS.includes(id))).toEqual([]);
  });

  it('W7 optional-body actions declare fields but requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_W7_OPTIONAL_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length === 0) problems.push(`${id}: expected declared fields, got empty object`);
    }
    expect(problems).toEqual([]);
    expect(E10G_W7_OPTIONAL_OPS.filter((id) => !E10G_W7_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // W7 exclusions: binary / multipart / A2A pass-through. Each one must still be
  // a catalog op, must carry a reason, and must NOT declare a request (that
  // would inflate `requests` with a shape the gateway never parses).
  it('W7 exclusions are named with a reason and stay out of the request ledger', () => {
    const ids = Object.keys(E10G_W7_EXCLUDED_OPS);
    const all = new Set(buildRouteCatalog().map((def) => def.operationId));
    expect(ids.filter((id) => !all.has(id))).toEqual([]);
    for (const [id, reason] of Object.entries(E10G_W7_EXCLUDED_OPS)) {
      expect(`${id}:${reason.length > 0}`).toBe(`${id}:true`);
      expect(`${id}:${catalogById().get(id)?.hasRequest === true}`).toBe(`${id}:false`);
    }
    expect(ids.filter((id) => E10G_W7_REQUEST_OPS.includes(id))).toEqual([]);
  });

  // E10g-W8: the last two writes (cognition gate / rewrite) now declare their
  // request bodies, so the write-op denominator is fully accounted for:
  // 189 = 183 covered + 6 excluded (W6 1 + W7 5).
  it('every W8 cognition write op declares a request schema (catalog requests >= 182)', () => {
    const byId = catalogById();
    const missing = E10G_W8_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(182);
    expect(requests).toEqual(expect.arrayContaining([
      ...E10G_P0_REQUEST_OPS,
      ...E10G_W1_REQUEST_OPS,
      ...E10G_W2W3_REQUEST_OPS,
      ...E10G_W4_REQUEST_OPS,
      ...E10G_W5_REQUEST_OPS,
      ...E10G_W6_REQUEST_OPS,
      ...E10G_W7_REQUEST_OPS,
      ...E10G_W8_REQUEST_OPS,
    ]));
    // No duplicate ids across batches (a typo would hide here otherwise).
    expect(new Set(E10G_W8_REQUEST_OPS).size).toBe(E10G_W8_REQUEST_OPS.length);
    expect(E10G_W8_REQUEST_OPS.filter((id) => E10G_W7_REQUEST_OPS.includes(id))).toEqual([]);
  });

  it('W8 cognition bodies pin the handler gate/rewrite required fields', () => {
    const gate = catalogById().get('cognition.gate');
    if (!gate?.hasRequest) throw new Error('cognition.gate: missing request');
    // JSON body with no optional envelope: a missing body is a 400.
    expect(gate.requestRequired).toBeUndefined();
    const gateSchema = gate.request as any;
    expect(gateSchema.required).toEqual(['sessionID', 'kind']);
    expect(gateSchema.properties.kind.anyOf.map((v: any) => v.const)).toEqual(['tool_call', 'prompt']);
    // `tool` is required only on the tool_call branch → optional + description,
    // never a fabricated oneOf (the handler 400s on tool_call without it).
    expect(gateSchema.required).not.toContain('tool');
    expect(gateSchema.properties.tool.description).toContain("kind is 'tool_call'");
    expect(gateSchema.properties.input.type).toBe('object');
    expect(gateSchema.properties.text.type).toBe('string');

    const rewrite = catalogById().get('cognition.rewrite');
    if (!rewrite?.hasRequest) throw new Error('cognition.rewrite: missing request');
    expect(rewrite.requestRequired).toBeUndefined();
    const rewriteSchema = rewrite.request as any;
    expect(rewriteSchema.required).toEqual(['sessionID', 'tool', 'output']);
    // output.content must be an array; an empty array is a valid 200.
    expect(rewriteSchema.properties.output.required).toEqual(['content']);
    const content = rewriteSchema.properties.output.properties.content;
    expect(content.type).toBe('array');
    expect(content.minItems).toBeUndefined();
    // Parts are runtime-owned: only `type` is pinned, the rest passes through.
    expect(content.items.required).toEqual(['type']);
    expect(content.items.additionalProperties).toBe(true);
    expect(rewriteSchema.properties.output.required).not.toContain('isError');
    // `isError` is part of the host envelope but the gateway never reads it.
    expect(rewriteSchema.properties.output.properties.isError.type).toBe('boolean');
    // Host envelope field (`contract-cognition` requiredFields) the handler ignores.
    expect(rewriteSchema.properties.input.type).toBe('object');
  });

  // E10g-fix: main's Phase 6 plugin recovery writes join the ledger. 200 write
  // ops = 194 covered + 6 excluded.
  it('every Phase 6 plugin recovery write op declares a request schema (catalog requests >= 194)', () => {
    const byId = catalogById();
    const missing = E10G_P6_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(193);
    // No duplicate ids in the batch (a typo would hide here otherwise).
    expect(new Set(E10G_P6_REQUEST_OPS).size).toBe(E10G_P6_REQUEST_OPS.length);
  });

  it('P6 body-ignored actions use an empty object schema with requestRequired:false', () => {
    const byId = catalogById();
    const problems: string[] = [];
    for (const id of E10G_P6_EMPTY_OPS) {
      const def = byId.get(id);
      if (!def?.hasRequest) { problems.push(`${id}: missing request`); continue; }
      if (def.requestRequired !== false) problems.push(`${id}: requestRequired must be false`);
      const props = (def.request as { properties?: Record<string, unknown> }).properties ?? {};
      if (Object.keys(props).length !== 0) problems.push(`${id}: expected empty object, got ${Object.keys(props).join(',')}`);
    }
    expect(problems).toEqual([]);
    expect(E10G_P6_EMPTY_OPS.filter((id) => !E10G_P6_REQUEST_OPS.includes(id))).toEqual([]);
    // The one JSON-body op in the batch: quarantine's `reason` is required.
    const quarantine = byId.get('plugins.quarantine');
    if (!quarantine?.hasRequest) throw new Error('plugins.quarantine: missing request');
    expect((quarantine.request as any).required).toEqual(['reason']);
    expect(quarantine.requestRequired).toBeUndefined();
  });

  // E10g-fix: main's Phase 6 plugin recovery writes join the ledger. 200 write
  // ops now (199 + mobile.remoteAccess P0), 194 declared requests + 6 excluded.
  it('E10g request arithmetic closes on 200 (194 covered + 6 excluded)', () => {
    const covered = new Set(catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId));
    const excluded = new Set([
      ...Object.keys(E10G_W6_EXCLUDED_OPS),
      ...Object.keys(E10G_W7_EXCLUDED_OPS),
    ]);
    const withoutRequest = catalogWriteOps().map((op) => op.operationId).filter((id) => !covered.has(id));
    expect(withoutRequest.sort()).toEqual([
      'media.createTask',
      'media.upload',
      'media.uploadAndCreate',
      'mobile.mediaTaskUpload',
      'plugins.install',
      'pods.a2a',
    ]);
    expect(covered.size).toBe(194);
    expect(excluded.size).toBe(6);
    expect([...covered].filter((id) => excluded.has(id))).toEqual([]);
    expect(covered.size + excluded.size).toBe(WRITE_OPS_TOTAL);
    expect(catalogWriteOps()).toHaveLength(WRITE_OPS_TOTAL);
  });

  // E10h-R5: mcp / plugins（Phase 6 自愈面在内）/ runtime / config / project /
  // manager / commands / models 写响应，35 个。与 R1-R4 同一台账（128 → 163）；
  // 按名钉住，删一个 `response:` 立刻按名失败，而不是只掉一个计数。
  it('R5 mcp/plugin/runtime/platform write ops declare a 200 response schema (write responses >= 163)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R5_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R5_WRITE_RESPONSE_OPS).toHaveLength(35);
    // No duplicates inside the batch …
    expect(new Set(E10H_R5_WRITE_RESPONSE_OPS).size).toBe(E10H_R5_WRITE_RESPONSE_OPS.length);
    // … and no overlap with the earlier batches.
    for (const earlier of [
      E10H_P0_WRITE_RESPONSE_OPS,
      E10H_R1_WRITE_RESPONSE_OPS,
      E10H_R2_WRITE_RESPONSE_OPS,
      E10H_R3_WRITE_RESPONSE_OPS,
      E10H_R4_WRITE_RESPONSE_OPS,
    ]) {
      expect(E10H_R5_WRITE_RESPONSE_OPS.filter((id) => earlier.includes(id))).toEqual([]);
    }
    // 163 = humanToken.rotate + P0 2 + R1 35 + R2 35 + R3 31 + R4 24 + R5 35.
    expect(responded.size).toBeGreaterThanOrEqual(163);
  });

  // 本批的 200 全是「有定义的对象 / 双分支联合」，只有命令结果是开放对象
  // （自定义命令可以追加任意键）；插件 action 的 output 是嵌套边界，不影响顶层。
  it('R5 responses model real bodies (the command result is the only open top-level object)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    const openTopLevel = new Set(['mafwCommands.run']);
    for (const id of E10H_R5_WRITE_RESPONSE_OPS) {
      const schema = responses.get(id) as {
        type?: string;
        anyOf?: unknown[];
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      // plugins.enable|disable|delete 的判别式双分支（package vs legacy）。
      if (schema.anyOf) {
        if (schema.anyOf.length !== 2) problems.push(`${id}: expected 2 body branches`);
        continue;
      }
      // plugins.doctorAll 是报告**数组**（checkAll），其余都是单个 body 对象。
      const arraySchema = schema as { type?: string; items?: { type?: string } };
      if (arraySchema.type === 'array') {
        if (arraySchema.items?.type !== 'object') problems.push(`${id}: expected report items`);
        continue;
      }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length === 0) problems.push(`${id}: expected declared fields`);
      if (schema.additionalProperties !== undefined && !openTopLevel.has(id)) {
        problems.push(`${id}: must not be open`);
      }
    }
    expect(problems).toEqual([]);
    // 三个双分支 op 的第二支都是「legacy 单文件」的回执，不是第二份业务 DTO。
    const deleteBranches = (responses.get('plugins.delete') as any).anyOf;
    expect(deleteBranches[1].required).toEqual(['ok']);
    const toggleBranches = (responses.get('plugins.enable') as any).anyOf;
    expect(toggleBranches[1].required).toEqual([
      'type', 'name', 'file', 'status', 'size', 'mtime',
    ]);
    // enable / disable 是同一个双分支（handler 只有 enabled 布尔不同）。
    expect(responses.get('plugins.disable')).toBe(responses.get('plugins.enable'));
  });

  // 写响应必须复用读侧 DTO，不写第二份转写：同一 DTO 的多次出现要指向同一
  // schema 对象，跨读写的复用要逐段相等。
  it('R5 reuses the read-side DTOs (no second transcription)', () => {
    const responses = catalogResponseById();

    // mcp：preview / preview-remove 同一个 preview DTO；apply / remove / restore
    // 同一个 result DTO；connect / disconnect 共用 `{ok:true}` 信封。
    expect(responses.get('mcp.configPreviewRemove')).toBe(responses.get('mcp.configPreview'));
    expect(responses.get('mcp.configApply')).toBe(responses.get('mcp.configRemove'));
    expect(responses.get('mcp.configRemove')).toBe(responses.get('mcp.configRestore'));
    expect(responses.get('mcp.connect')).toBe(responses.get('event.publish'));
    expect(responses.get('mcp.disconnect')).toBe(responses.get('mcp.connect'));

    // runtime.reload 的 plugins item ≡ runtime.get 的 plugins item（同一 loader 投影）。
    const reload = responses.get('runtime.reload') as any;
    const runtimeGet = responses.get('runtime.get') as any;
    expect(reload.properties.plugins.items).toEqual(runtimeGet.properties.plugins.items);

    // models.update 的三段 ≡ models.get 的同名段（写入后读回，不是新 DTO）。
    const update = responses.get('models.update') as any;
    const modelGet = responses.get('models.get') as any;
    for (const key of ['recall', 'media', 'goal']) {
      expect(`${key}:${JSON.stringify(update.properties[key])}`)
        .toBe(`${key}:${JSON.stringify(modelGet.properties[key])}`);
    }

    // plugins.install ≡ plugins.list 的 item（同一个 `statEntry()` 投影）。
    const list = responses.get('plugins.list') as any;
    expect(responses.get('plugins.install')).toEqual(list.properties.plugins.items);
  });

  // 插件 action 的输出是**包定义**的边界：信封字段固定，output 允许任意 JSON，
  // 其中对象分支必须是开放对象（additionalProperties:true）而不是空壳。
  it('R5 keeps the plugin action output as an open boundary', () => {
    const invoke = catalogResponseById().get('plugins.invoke') as any;
    expect(invoke.required).toEqual(['package', 'action', 'revision']);
    const output = invoke.properties.output;
    const branches: any[] = output.anyOf;
    expect(branches).toHaveLength(6);
    const objectBranch = branches.find((branch) => branch.type === 'object');
    expect(objectBranch?.additionalProperties).toBe(true);
    // 标量 / 数组 / null 也是合法输出（handler 只要求 JSON 可序列化）。
    expect(branches.map((branch) => branch.type).sort())
      .toEqual(['array', 'boolean', 'null', 'number', 'object', 'string']);
  });

  // 同一批里的状态字面量都来自 handler 的唯一写出值，不放宽成 string。
  it('R5 pins the handler literals (kill/resume, quarantine pair, switch/apply receipts)', () => {
    const responses = catalogResponseById();
    const literal = (id: string, key: string): unknown =>
      (responses.get(id) as any).properties[key].const;
    expect(literal('plugins.kill', 'safeMode')).toBe(true);
    expect(literal('plugins.resume', 'safeMode')).toBe(false);
    expect(literal('plugins.quarantine', 'quarantined')).toBe(true);
    expect(literal('plugins.unquarantine', 'quarantined')).toBe(false);
    expect(literal('runtime.switch', 'success')).toBe(true);
    expect(literal('runtime.restartAgent', 'success')).toBe(true);
    expect(literal('config.set', 'success')).toBe(true);
    expect(literal('project.setCurrent', 'status')).toBe('ok');
    expect(literal('runtime.config.update', 'status')).toBe('ok');
    // manager.rotate 的 created 两态（initial = 懒建，rotated = 换新）。
    expect((responses.get('manager.rotate') as any).properties.created.anyOf
      .map((branch: any) => branch.const)).toEqual(['initial', 'rotated']);
    // dryEvent：type 与 facets 都可空但恒在（丢弃 / 工具原语分支）。
    const dry = responses.get('runtime.dryEvent') as any;
    expect(dry.required).toEqual(['type', 'known', 'facets', 'warnings']);
    expect(dry.properties.type.anyOf.map((b: any) => b.type).sort()).toEqual(['null', 'string']);
  });

  // E10h-R6: memory / media / tts / chat / python / obs / tools / eval / llm /
  // mobile / devices / skills 写响应（32 个，含 2026-11-18 `mobile.remoteAccess`）。
  // 与 R1-R5 同一台账（163 → 194，+1）；按名钉住，删一个 `response:` 立刻按名失败，
  // 而不是只掉一个计数。
  it('R6 memory/media/internal/device write ops declare a 200 response schema (write responses >= 198)', () => {
    const writes = catalogWriteOps();
    const responded = new Set(writes.filter((op) => op.hasResponse).map((op) => op.operationId));

    expect(E10H_R6_WRITE_RESPONSE_OPS.filter((id) => !responded.has(id))).toEqual([]);
    expect(E10H_R6_WRITE_RESPONSE_OPS).toHaveLength(32);
    // No duplicates inside the batch …
    expect(new Set(E10H_R6_WRITE_RESPONSE_OPS).size).toBe(E10H_R6_WRITE_RESPONSE_OPS.length);
    // … and no overlap with the earlier batches.
    for (const earlier of [
      E10H_P0_WRITE_RESPONSE_OPS,
      E10H_R1_WRITE_RESPONSE_OPS,
      E10H_R2_WRITE_RESPONSE_OPS,
      E10H_R3_WRITE_RESPONSE_OPS,
      E10H_R4_WRITE_RESPONSE_OPS,
      E10H_R5_WRITE_RESPONSE_OPS,
    ]) {
      expect(E10H_R6_WRITE_RESPONSE_OPS.filter((id) => earlier.includes(id))).toEqual([]);
    }
    // 195 = humanToken.rotate + P0 2 + R1 35 + R2 35 + R3 31 + R4 24 + R5 35 + R6 32.
    expect(responded.size).toBeGreaterThanOrEqual(198);
    // 音频流那一支不在响应台账里（排除，不是漏项）。
    expect(responded.has('tts.speakStream')).toBe(false);
  });

  // 本批的 200 全是「有定义的对象 / 多分支联合」；唯一不枚举字段的是
  // `media.createTask` 的 A2A 信封（协议边界，与 R2 的 `pods.a2a` 同口径）。
  it('R6 responses model real bodies (only the A2A envelope is an open top-level object)', () => {
    const responses = catalogResponseById();
    const problems: string[] = [];
    for (const id of E10H_R6_WRITE_RESPONSE_OPS) {
      if (id === 'media.createTask') continue; // asserted separately below
      const schema = responses.get(id) as {
        type?: string;
        anyOf?: Array<{ type?: string; properties?: Record<string, unknown>; additionalProperties?: unknown }>;
        properties?: Record<string, unknown>;
        additionalProperties?: unknown;
      } | undefined;
      if (!schema) { problems.push(`${id}: missing response`); continue; }
      // memory.add / memory.setSticky / memory.merge / obs.capture 是分支联合。
      if (schema.anyOf) {
        for (const branch of schema.anyOf) {
          if (Object.keys(branch.properties ?? {}).length === 0) {
            problems.push(`${id}: branch without declared fields`);
          }
          if (branch.additionalProperties !== undefined) problems.push(`${id}: branch must not be open`);
        }
        continue;
      }
      if (schema.type !== 'object') problems.push(`${id}: expected object`);
      if (Object.keys(schema.properties ?? {}).length === 0) problems.push(`${id}: expected declared fields`);
      if (schema.additionalProperties !== undefined) problems.push(`${id}: must not be open`);
    }
    expect(problems).toEqual([]);

    // `media.createTask`（POST /a2a）与 `pods.a2a` 是同一个协议边界形态。
    const a2a = responses.get('media.createTask') as {
      additionalProperties?: unknown;
      properties?: Record<string, unknown>;
    } | undefined;
    expect(a2a?.additionalProperties).toBe(true);
    expect(Object.keys(a2a?.properties ?? {})).toEqual([]);
  });

  // 写响应复用读侧 DTO / 兄弟 op 的同一份 schema，不写第二份转写。
  it('R6 reuses the read-side DTOs and pins the two-mode receipts', () => {
    const responses = catalogResponseById();

    // media.pluginsReload 的 plugins 段 ≡ media.plugins 的列表段（同一 getState() 投影）。
    const reload = responses.get('media.pluginsReload') as any;
    const plugins = responses.get('media.plugins') as any;
    expect(reload.properties.plugins).toBe(plugins.properties.plugins);

    // devices.register / mobile.devicesRegister 共用一份回执，device 段 ≡ devices.list item
    // （`device` 是 Optional 包裹，Symbol 标记不同 → 按结构比较）。
    expect(responses.get('mobile.devicesRegister')).toBe(responses.get('devices.register'));
    const register = responses.get('devices.register') as any;
    const deviceList = responses.get('devices.list') as any;
    expect(JSON.stringify(register.properties.device))
      .toBe(JSON.stringify(deviceList.properties.devices.items));
    // 两个 DELETE 别名同一实现 → 同一份 `{ok:true}` 回执。
    expect(responses.get('mobile.devicesDelete')).toBe(responses.get('devices.delete'));

    // chat.send 与 chat.sendEnriched 的 200 严格同形（都只有 sessionID）。
    expect(responses.get('chat.sendEnriched')).toBe(responses.get('chat.send'));

    // embedding.update 的 current / runtime ≡ embedding.get 的同名段（写后读回）。
    const embeddingUpdate = responses.get('embedding.update') as any;
    const embeddingGet = responses.get('embedding.get') as any;
    for (const key of ['current', 'runtime']) {
      expect(`${key}:${JSON.stringify(embeddingUpdate.properties[key])}`)
        .toBe(`${key}:${JSON.stringify(embeddingGet.properties[key])}`);
    }

    // setSticky 的两个模式分支（sticky / pinned）+ 失败分支，收敛成一份会合法化
    // 「两个都给」的 body。
    const setSticky = responses.get('memory.setSticky') as any;
    expect(setSticky.anyOf).toHaveLength(3);
    expect(setSticky.anyOf[0].required).toEqual(['success', 'id', 'sticky']);
    expect(setSticky.anyOf[1].required).toEqual(['success', 'id', 'pinned']);
    expect(setSticky.anyOf[2].required).toEqual(['success', 'error']);

    // memory.add 的 dedup 回执没有 id，deduped 是字面量 true。
    const add = responses.get('memory.add') as any;
    const addSuccess = add.anyOf[0];
    expect(addSuccess.required).toEqual(['success']);
    expect(addSuccess.properties.deduped.const).toBe(true);
    expect(add.anyOf[1].properties.code.const).toBe('disk_low');

    // media.uploadAndCreate 的 state 是网关自己写死的 working 态。
    expect((responses.get('media.uploadAndCreate') as any).properties.state.const)
      .toBe('TASK_STATE_WORKING');
    // memory.delete / tts.interrupt / python.restart 的常量回执。
    expect((responses.get('memory.delete') as any).properties.status.const).toBe('deleted');
    expect((responses.get('tts.interrupt') as any).properties.ok.const).toBe(true);
    expect((responses.get('python.restart') as any).properties.ok.const).toBe(true);
  });

  // 排除项是台账条目，不是静默缺口：R6 恰好一个（tts.speakStream），它必须仍在
  // catalog 里、必须有原因，且**不**声明 response。
  it('R6 exclusions are named with a reason and stay out of the response ledger', () => {
    const ids = Object.keys(E10H_R6_EXCLUDED_OPS);
    const all = new Set(buildRouteCatalog().map((def) => def.operationId));
    expect(ids.filter((id) => !all.has(id))).toEqual([]);
    for (const [id, reason] of Object.entries(E10H_R6_EXCLUDED_OPS)) {
      expect(`${id}:${reason.length > 0}`).toBe(`${id}:true`);
      expect(`${id}:${catalogById().get(id) !== undefined}`).toBe(`${id}:true`);
    }
    // 排除项既不在响应台账，也不在响应批次的 op 清单里。
    expect(ids.filter((id) => E10H_R6_WRITE_RESPONSE_OPS.includes(id))).toEqual([]);
    expect(catalogWriteOps().find((op) => op.operationId === 'tts.speakStream')?.hasResponse).toBe(false);
    // 请求面仍是已覆盖的 JSON body（排除只针对响应）。
    expect(catalogById().get('tts.speakStream')?.hasRequest).toBe(true);
  });
});
