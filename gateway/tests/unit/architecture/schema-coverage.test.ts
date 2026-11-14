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

// Pinned: 317 through E10b, +1 for `humanToken.rotate` (E11-1) = 318 (E10f only adds schemas).
const TOTAL_OPS = 318;

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
  // and as a floor (`>= 38`) so the count can only grow with W2-W7.
  it('every W1 session write op declares a request schema (catalog requests >= 38)', () => {
    const byId = catalogById();
    const missing = E10G_W1_REQUEST_OPS.filter((id) => !byId.get(id)?.hasRequest);
    expect(missing).toEqual([]);
    const requests = catalogWriteOps().filter((op) => op.hasRequest).map((op) => op.operationId);
    expect(requests.length).toBeGreaterThanOrEqual(38);
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
});
