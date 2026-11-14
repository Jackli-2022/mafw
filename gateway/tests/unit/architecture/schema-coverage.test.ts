// E10-3: schema coverage ledger.
//
// `scripts/schema-coverage.cjs` parses `route-catalog.ts` (no TS import, no
// generated SDK artifact) and reports how many catalog ops carry a 200
// response schema. This test pins that report against the catalog:
//   - the 125 ops covered through E10f-D (13 pre-E10 + 16 E10 + 8 E10b-1 + 7 E10b-2 +
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
}

const GATEWAY_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(GATEWAY_ROOT, 'scripts', 'schema-coverage.cjs');

/** Baseline 13 (E8 and earlier) + 8 session read (E10-1) + 8 pod/work read (E10-2) + 8 goal read (E10b-1) + 7 human-gate/permission read (E10b-2) + 1 human token rotate (E11-1) + 8 memory/recall/lead read (E10c-1) + 8 memory extra / lead.context / pod read (E10d-1) + 8 metadata/registry read (E10e-1) + 16 session/task/terminal/usage read (E10f-A) + 16 project/runtime/metadata read (E10f-B) + 16 goal/lead/event/standing/automation/pod read (E10f-C) + 8 observability/device/A2A read (E10f-D) = 125. */
const E10_COVERED_OPS = [
  'a2a.agentCard',
  'agent.capabilities',
  'agents.list',
  'approvals.list',
  'attention.list',
  'automations.get',
  'automations.history',
  'automations.list',
  'background.jobs.list',
  'background.jobs.output',
  'cognition.rules',
  'config.get',
  'dashboard.stats',
  'decisions.list',
  'devices.list',
  'embedding.get',
  'event.replay',
  'events.deliveries.list',
  'events.sources.list',
  'events.threads.list',
  'events.threads.subscriptions.list',
  'events.threads.triggers',
  'experience.actions',
  'fileHistory.list',
  'goals.get',
  'goals.list',
  'goals.plan',
  'goals.sessions',
  'goals.source',
  'goals.timeline',
  'health.root',
  'humanToken.rotate',
  'kernel.stats',
  'lead.boundaries.list',
  'lead.context',
  'lead.recall',
  'lead.topics.get',
  'lead.topics.list',
  'lead.workingSet',
  'mafwCommands.list',
  'manager.session',
  'mcp.servers',
  'media.plugins',
  'media.resolveTask',
  'memory.get',
  'memory.getEnergyDistribution',
  'memory.getL5Axioms',
  'memory.listSticky',
  'memory.mergedSearch',
  'memory.search',
  'memory.stats',
  'mobile.devicesList',
  'mobile.pairingCode',
  'models.get',
  'orchestration.outcomes',
  'permissions.getMode',
  'permissions.list',
  'permissions.listAllowlist',
  'permissions.listRules',
  'plugins.client',
  'plugins.list',
  'pod.events.list',
  'pods.a2aCard',
  'pods.cost',
  'pods.ensure',
  'pods.get',
  'pods.goals',
  'pods.goals.probes',
  'pods.goals.result',
  'pods.goals.reviewItems',
  'pods.goals.revisions',
  'pods.goals.techLead',
  'pods.goals.worktree.diff',
  'pods.lookup',
  'pods.memory.get',
  'pods.messages.list',
  'pods.tasks.list',
  'pods.transcript',
  'presence.get',
  'project.current',
  'project.list',
  'providers.list',
  'python.status',
  'questions.list',
  'recall.context',
  'recall.instructions',
  'recall.pinned',
  'recall.priors',
  'runtime.config.get',
  'runtime.contract',
  'runtime.get',
  'scheduler.status',
  'session.checkpoints',
  'session.children',
  'session.config',
  'session.diff',
  'session.discovery',
  'session.discoverySkill',
  'session.get',
  'session.list',
  'session.messages',
  'session.queue.list',
  'session.run',
  'session.structured',
  'session.subagents.list',
  'session.subagents.result',
  'session.todo',
  'session.tokenSummary',
  'session.trajectory',
  'session.usage',
  'session.usagePluginSourceGet',
  'session.usagePluginsList',
  'session.usageSummary',
  'skills.list',
  'standingGoals.list',
  'standingGoals.runs',
  'tasks.get',
  'tasks.list',
  'tasks.output',
  'terminal.list',
  'tools.list',
  'triage.list',
  'tts.voices',
  'voice.status',
  'work.overview',
];

// Pinned: 317 through E10b, +1 for `humanToken.rotate` (E11-1) = 318,
// +7 Phase 6 device-trust routes = 325, +2 last-good/rollback = 327.
const TOTAL_OPS = 327;

function catalogOps(): Array<{ operationId: string; hasResponse: boolean }> {
  return buildRouteCatalog().map((def) => ({
    operationId: def.operationId,
    // RouteDef.response is the catalog's single source for the 200 schema.
    hasResponse: Boolean((def as { response?: unknown }).response),
  }));
}

/** E10g: write ops = everything that is not a GET (query-only surface). */
const WRITE_OPS_TOTAL = 188;

/** P0 pilots：requestBody 管线的第一批（始终保留，不随批次回退）。 */
const E10G_P0_REQUEST_OPS = ['pods.tasks.create', 'session.create', 'tasks.submit'];

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
  'session.discardRun',
  'session.discoveryRefresh',
  'session.queue.cancel',
  'session.queue.clear',
  'session.resume',
  'session.suspend',
  'session.subagents.cancel',
  'session.unrevert',
  'session.usagePluginTest',
  'session.usagePluginsDelete',
  'session.usagePluginsReload',
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
 * tools / eval / llm / mobile / devices / a2a / skills（30 个已覆盖）。
 * P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + 这 30 = 180（W8 再补 cognition 2）。
 * 分母 188 = W8 后 182 covered + 6 excluded（W6 1 + W7 5）。
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
 * P0 3 + W1 35 + W2W3 33 + W4 29 + W5 24 + W6 26 + W7 30 + 这 2 = 182。
 * 分母 188 = **182 covered + 6 excluded**（W6 1 + W7 5）；W7 遗留的两个
 * cognition op 在此归位（body 归 cognition gate 契约，handler 是事实源）。
 */
const E10G_W8_REQUEST_OPS = ['cognition.gate', 'cognition.rewrite'];


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

function catalogWriteOps(): Array<{ operationId: string; hasRequest: boolean }> {
  return buildRouteCatalog()
    .filter((def) => def.method !== 'GET')
    .map((def) => ({
      operationId: def.operationId,
      // RouteDef.request is the catalog's single source for the request body.
      hasRequest: Boolean((def as { request?: unknown }).request),
    }));
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

  it('the catalog covered set equals the ledger exactly, and the catalog still has 318 ops', () => {
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
  // (188) and the grown coverage set stay pinned while W1-W7 land.
  it('the script reports request coverage over the 188 write ops', () => {
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
  // 188 = 182 covered + 6 excluded (W6 1 + W7 5).
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

  // Closing arithmetic for the E10g scope: 188 write ops = 182 declared requests +
  // 6 excluded (W6 1 + W7 5). Nothing is left unaccounted for after W8.
  it('E10g request arithmetic closes on 188 (W8: 182 covered + 6 excluded)', () => {
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
    expect(covered.size).toBe(182);
    expect(excluded.size).toBe(6);
    expect([...covered].filter((id) => excluded.has(id))).toEqual([]);
    expect(covered.size + excluded.size).toBe(WRITE_OPS_TOTAL);
    expect(catalogWriteOps()).toHaveLength(WRITE_OPS_TOTAL);
  });
});
