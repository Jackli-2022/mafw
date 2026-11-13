// E10-3: schema coverage ledger.
//
// `scripts/schema-coverage.cjs` parses `route-catalog.ts` (no TS import, no
// generated SDK artifact) and reports how many catalog ops carry a 200
// response schema. This test pins that report against the catalog:
//   - the 44 ops covered at the E10b-2 close (13 pre-E10 + 16 E10 + 8 E10b-1 + 7 E10b-2) must each
//     keep their `response` — a silent schema deletion fails here;
//   - the covered count may only grow (>= 44);
//   - the total op count is pinned (316) so an unregistered/new route surfaces
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
}

const GATEWAY_ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = path.join(GATEWAY_ROOT, 'scripts', 'schema-coverage.cjs');

/** Baseline 13 (E8 and earlier) + 8 session read (E10-1) + 8 pod/work read (E10-2) + 8 goal read (E10b-1) + 7 human-gate/permission read (E10b-2). */
const E10_COVERED_OPS = [
  'approvals.list',
  'attention.list',
  'decisions.list',
  'event.replay',
  'goals.get',
  'goals.plan',
  'goals.sessions',
  'goals.source',
  'goals.timeline',
  'kernel.stats',
  'memory.stats',
  'permissions.getMode',
  'permissions.list',
  'permissions.listAllowlist',
  'permissions.listRules',
  'pod.events.list',
  'pods.cost',
  'pods.get',
  'pods.goals',
  'pods.goals.probes',
  'pods.goals.result',
  'pods.goals.reviewItems',
  'pods.goals.revisions',
  'pods.goals.techLead',
  'pods.messages.list',
  'pods.tasks.list',
  'presence.get',
  'project.list',
  'questions.list',
  'session.checkpoints',
  'session.children',
  'session.config',
  'session.diff',
  'session.get',
  'session.list',
  'session.messages',
  'session.queue.list',
  'session.subagents.list',
  'session.todo',
  'session.tokenSummary',
  'session.usageSummary',
  'triage.list',
  'work.overview',
];

const TOTAL_OPS = 316;

function catalogOps(): Array<{ operationId: string; hasResponse: boolean }> {
  return buildRouteCatalog().map((def) => ({
    operationId: def.operationId,
    // RouteDef.response is the catalog's single source for the 200 schema.
    hasResponse: Boolean((def as { response?: unknown }).response),
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
  it('every op covered at E10 close still declares a response schema', () => {
    const byId = new Map(catalogOps().map((op) => [op.operationId, op.hasResponse]));
    const lost = E10_COVERED_OPS.filter((id) => !byId.get(id));
    // Named so the failure says which schema disappeared, not just "expected true".
    expect(lost).toEqual([]);
  });

  it('covered count is >= 44 and the catalog still has exactly 316 ops', () => {
    const ops = catalogOps();
    const covered = ops.filter((op) => op.hasResponse).length;
    expect(covered).toBeGreaterThanOrEqual(E10_COVERED_OPS.length);
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
});
