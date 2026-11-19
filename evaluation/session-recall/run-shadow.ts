/**
 * Session recall quality P1 shadow runner.
 *
 * Reads the frozen fixture file (the P0 file, extended with the frozen live
 * captures and the audited TopicState), evaluates every case along all four
 * shadow arms (`gateway/src/recall/session-quality-shadow.ts`) and writes a
 * reproducible JSON baseline next to the P0 one.
 *
 * No DB read, no live gateway request, no model calls, no writes outside the
 * requested output file. The `live-frozen` arm consumes the block captured into
 * the fixture; this runner never asks Gateway for anything.
 *
 * Usage:
 *   npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run-shadow.ts \
 *     --out evaluation/session-recall/shadow-baseline.json \
 *     --generated-at 2026-11-19T10:00:00.000Z
 *
 * Optional: --fixtures <path>  --snapshot-config <json>  --help
 *
 * Importable by the consistency test (`run-shadow` must not execute `main` on
 * import): `loadShadowFixtureFile` + `runShadowEvaluation` are the API.
 *
 * The numeric output is a pure function of the frozen fixture file, its frozen
 * `snapshotConfig` (or an explicit override) and the recorded code fingerprint:
 * re-running with the same inputs reproduces every numerator/denominator. Only
 * `generatedAt` reflects wall-clock time (pass `--generated-at` for a
 * byte-identical report).
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SnapshotConfig } from '../../gateway/src/recall/recall-snapshot';
import type { QualityRate } from '../../gateway/src/recall/session-quality';
import {
  SESSION_SHADOW_ARMS,
  evaluateSessionShadowFixture,
  summarizeSessionShadow,
  validateSessionShadowFixture,
  type SessionShadowArm,
  type SessionShadowArms,
  type SessionShadowQualityFixture,
  type SessionShadowSummary,
} from '../../gateway/src/recall/session-quality-shadow';
import {
  FINGERPRINT_SOURCES,
  loadFixtureFile,
  runEvaluation,
  type CodeFingerprint,
  type FixtureFile,
} from './run';

export const SHADOW_EVALUATOR = 'gateway/src/recall/session-quality-shadow.ts';

/**
 * Re-exported so the consistency gate (and Task 2) can drive the shadow
 * evaluator through the runner module alone.
 */
export { SESSION_SHADOW_ARMS, evaluateSessionShadowFixture, summarizeSessionShadow, validateSessionShadowFixture };

const RUNNER = 'npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run-shadow.ts';
const REPO_ROOT = path.resolve(__dirname, '../..');

/**
 * Sources whose SHA256 the shadow baseline records: the P0 serve-path list, the
 * exact-evidence module the facet arm calls directly, the shadow evaluator
 * itself, and this runner.
 *
 * This is a fixed, reviewable list — NOT a proof of complete transitive coverage.
 * A new module that can move these numbers must be added here explicitly (a
 * dependency reached through an already-listed file is only covered when that
 * file's own content changes).
 */
export const SHADOW_FINGERPRINT_SOURCES = [
  ...FINGERPRINT_SOURCES,
  'gateway/src/recall/exact-evidence.ts',
  SHADOW_EVALUATOR,
  'evaluation/session-recall/run-shadow.ts',
] as const;

export type ShadowConfigSource = 'frozen' | 'override';

/** Frozen corpus-level TopicState audit metadata (declared by the fixture file). */
export interface ShadowFixtureTopicAudit {
  /** Read-only seed the audit came from. */
  source: string;
  /** Sessions audited. */
  total: number;
  /** Sessions with an active topic. */
  active: number;
  /** Field coverage across the ACTIVE sessions, as recorded by the audit. */
  fieldCoverage: Record<string, string>;
  notes?: string[];
}

export interface ShadowFixtureFile extends FixtureFile {
  topicAudit?: ShadowFixtureTopicAudit;
  cases: SessionShadowQualityFixture[];
}

export interface ShadowCaseResult {
  id: string;
  arms: SessionShadowArms;
}

export interface ShadowBaselineReport {
  bootstrap: true;
  notAPublicBenchmark: true;
  evaluator: typeof SHADOW_EVALUATOR;
  /** Arm order, so consumers do not depend on object key order. */
  arms: SessionShadowArm[];
  /** SHA256 over the serve-path sources the shadow evaluator consumes. */
  codeFingerprint: CodeFingerprint;
  command: string;
  /** Where `snapshotConfig` came from: the frozen fixture or --snapshot-config. */
  configSource: ShadowConfigSource;
  snapshotConfig: SnapshotConfig;
  fixture: {
    path: string;
    version: number;
    status: string;
    frozenAt: string | null;
    seed: string | null;
    notes: string[];
    cases: number;
    /** Cases that froze a live capture. */
    liveCases: number;
    /** Cases that froze a TopicState. */
    topicCases: number;
    /** Corpus-level audit metadata, frozen with the fixtures (no re-derivation). */
    topicAudit: ShadowFixtureTopicAudit | null;
  };
  generatedAt: string;
  summary: SessionShadowSummary;
  /** Per case, per arm — the same P0 per-case fields, plus the arm label. */
  cases: ShadowCaseResult[];
}

/**
 * Top-level report fields that are part of the MEASUREMENT and must match
 * exactly (value-compared by `diffShadowBaseline`).
 */
export const SHADOW_BASELINE_COMPARED_FIELDS = [
  'evaluator',
  'arms',
  'codeFingerprint',
  'configSource',
  'snapshotConfig',
  'fixture',
  'summary',
  'cases',
] as const;

/**
 * Contract flags. They are constants of the report, but they are still compared:
 * a re-run that silently changed its own claim ("bootstrap", "not a benchmark")
 * must fail instead of being taken from the baseline.
 */
export const SHADOW_BASELINE_FLAG_FIELDS = ['bootstrap', 'notAPublicBenchmark'] as const;

/**
 * Invocation metadata, deliberately excluded from the comparison: the same
 * fixtures + config + code reproduce the same numbers from a different `--out`
 * path or timestamp. The checked-in values are still pinned by the gate suite.
 */
export const SHADOW_BASELINE_UNCOMPARED_FIELDS = ['command', 'generatedAt'] as const;

/**
 * Every top-level field the gate knows about. Nothing else may appear in a
 * baseline or a fresh report: an unknown key is a measurement field the gate
 * would otherwise ignore (or a report shape the gate does not understand), and
 * it is reported as a mismatch rather than silently skipped.
 */
export const SHADOW_BASELINE_KNOWN_FIELDS = [
  ...SHADOW_BASELINE_COMPARED_FIELDS,
  ...SHADOW_BASELINE_FLAG_FIELDS,
  ...SHADOW_BASELINE_UNCOMPARED_FIELDS,
] as const;

const SHADOW_BASELINE_KNOWN_FIELD_SET: ReadonlySet<string> = new Set(SHADOW_BASELINE_KNOWN_FIELDS);

/** One leaf-level difference between a baseline and a fresh re-run. */
export interface ShadowBaselineMismatch {
  /** Dotted path into the report, e.g. `summary.arms.topic-facet.usefulAnchorPrecision.numerator`. */
  path: string;
  baseline: unknown;
  actual: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectShadowBaselineMismatches(
  expected: unknown,
  actual: unknown,
  path: string,
  out: ShadowBaselineMismatch[],
): void {
  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      collectShadowBaselineMismatches(expected[key], actual[key], `${path}.${key}`, out);
    }
    return;
  }
  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push({ path: `${path}.length`, baseline: expected.length, actual: actual.length });
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index++) {
      collectShadowBaselineMismatches(expected[index], actual[index], `${path}[${index}]`, out);
    }
    return;
  }
  if (!Object.is(expected, actual)) out.push({ path, baseline: expected, actual });
}

/**
 * Compare a checked-in shadow baseline with a fresh report.
 *
 * Returns every leaf-level difference (empty = the baseline describes the code,
 * fixtures and config under test). The comparison is field-scoped — the eight
 * measurement fields, the two contract flags — and it rejects any top-level key
 * outside `SHADOW_BASELINE_KNOWN_FIELDS` on either side, so a future field cannot
 * bypass the gate by being unknown to it. Only `command` / `generatedAt` are
 * excluded (invocation metadata); their checked-in values are pinned by the gate
 * suite.
 */
export function diffShadowBaseline(
  baseline: ShadowBaselineReport,
  actual: ShadowBaselineReport,
): ShadowBaselineMismatch[] {
  const mismatches: ShadowBaselineMismatch[] = [];
  for (const field of SHADOW_BASELINE_COMPARED_FIELDS) {
    collectShadowBaselineMismatches(baseline[field], actual[field], field, mismatches);
  }
  for (const field of SHADOW_BASELINE_FLAG_FIELDS) {
    collectShadowBaselineMismatches(baseline[field], actual[field], field, mismatches);
  }
  collectUnknownTopLevelFields(baseline, 'baseline', mismatches);
  collectUnknownTopLevelFields(actual, 'actual', mismatches);
  return mismatches;
}

/**
 * A key the gate does not know about is a gate hole: report it instead of
 * skipping it. Both a stale baseline and a fresh report are checked, so neither
 * side can smuggle a field past the comparison.
 */
function collectUnknownTopLevelFields(
  report: ShadowBaselineReport,
  side: 'baseline' | 'actual',
  out: ShadowBaselineMismatch[],
): void {
  for (const [key, value] of Object.entries(report as unknown as Record<string, unknown>)) {
    if (SHADOW_BASELINE_KNOWN_FIELD_SET.has(key)) continue;
    out.push({
      path: `unknownField.${key}`,
      baseline: side === 'baseline' ? value : '<absent>',
      actual: side === 'actual' ? value : '<absent>',
    });
  }
}

/** A checked-in shadow baseline that no longer describes the code under test. */
export class ShadowBaselineMismatchError extends Error {
  readonly mismatches: ShadowBaselineMismatch[];

  constructor(mismatches: ShadowBaselineMismatch[]) {
    const shown = mismatches.slice(0, 10).map((mismatch) => (
      `  ${mismatch.path}: baseline ${formatValue(mismatch.baseline)}, actual ${formatValue(mismatch.actual)}`
    ));
    const more = mismatches.length > shown.length ? [`  ... and ${mismatches.length - shown.length} more`] : [];
    super(
      `shadow baseline is STALE: ${mismatches.length} field(s) differ from a re-run of the frozen fixtures.\n`
        + `${[...shown, ...more].join('\n')}\n`
        + `Regenerate it in the same change: ${RUNNER} `
        + '--out evaluation/session-recall/shadow-baseline.json '
        + '--generated-at <baseline generatedAt>',
    );
    this.name = 'ShadowBaselineMismatchError';
    this.mismatches = mismatches;
  }
}

function formatValue(value: unknown): string {
  const text = value === undefined ? 'undefined' : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/**
 * Throw `ShadowBaselineMismatchError` unless the baseline reproduces exactly.
 * This is the assertion the checked-in gate suite uses; a stale baseline must be
 * a hard failure, never a warning.
 */
export function assertShadowBaselineConsistent(
  baseline: ShadowBaselineReport,
  actual: ShadowBaselineReport,
): void {
  const mismatches = diffShadowBaseline(baseline, actual);
  if (mismatches.length > 0) throw new ShadowBaselineMismatchError(mismatches);
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Fingerprint the shadow code under test without invoking `git`.
 * CRLF is normalised to LF so a Windows and a Linux checkout of the same sources produce
 * the same digest.
 */
export function computeShadowCodeFingerprint(rootDir: string = REPO_ROOT): CodeFingerprint {
  const files = SHADOW_FINGERPRINT_SOURCES.map((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');
    return { path: relativePath, sha256: sha256(source) };
  });
  return {
    algorithm: 'sha256',
    digest: sha256(files.map((file) => `${file.path}:${file.sha256}`).join('\n')),
    files,
  };
}

function validateTopicAuditMetadata(audit: unknown): ShadowFixtureTopicAudit {
  if (!audit || typeof audit !== 'object' || Array.isArray(audit)) {
    throw new Error('fixture.topicAudit must be an object when present');
  }
  const candidate = audit as ShadowFixtureTopicAudit;
  if (typeof candidate.source !== 'string' || candidate.source.trim() === '') {
    throw new Error('fixture.topicAudit.source must be a non-empty string');
  }
  for (const key of ['total', 'active'] as const) {
    const value = candidate[key];
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`fixture.topicAudit.${key} must be a non-negative integer`);
    }
  }
  if (candidate.active > candidate.total) {
    throw new Error('fixture.topicAudit.active cannot exceed fixture.topicAudit.total');
  }
  if (!candidate.fieldCoverage || typeof candidate.fieldCoverage !== 'object' || Array.isArray(candidate.fieldCoverage)) {
    throw new Error('fixture.topicAudit.fieldCoverage must be an object');
  }
  for (const [field, coverage] of Object.entries(candidate.fieldCoverage)) {
    if (typeof coverage !== 'string' || coverage.trim() === '') {
      throw new Error(`fixture.topicAudit.fieldCoverage.${field} must be a non-empty string`);
    }
  }
  return candidate;
}

/**
 * Load the shadow fixture file: the P0 loader validates version/status/frozen
 * config/cases, then every case is checked for the frozen live/topic material.
 */
export function loadShadowFixtureFile(fixturePath: string): ShadowFixtureFile {
  const file = loadFixtureFile(fixturePath) as ShadowFixtureFile;
  for (const fixture of file.cases) validateSessionShadowFixture(fixture);
  if (file.topicAudit !== undefined) validateTopicAuditMetadata(file.topicAudit);
  return file;
}

const SNAPSHOT_CONFIG_KEYS = new Set([
  'enabled',
  'ttlMs',
  'maxTurns',
  'maxChars',
  'topicShiftThreshold',
  't1K',
  't1MaxChars',
]);

/** Explicit experiment override: a partial SnapshotConfig JSON object. */
function parseSnapshotConfigOverride(json: string): SnapshotConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error(
      `--snapshot-config must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--snapshot-config must be a JSON object');
  }
  const config = parsed as SnapshotConfig;
  for (const key of Object.keys(config)) {
    if (!SNAPSHOT_CONFIG_KEYS.has(key)) throw new Error(`--snapshot-config has unknown key "${key}"`);
  }
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error('--snapshot-config.enabled must be a boolean when present');
  }
  if (config.ttlMs !== undefined && (!Number.isFinite(config.ttlMs) || config.ttlMs <= 0)) {
    throw new Error('--snapshot-config.ttlMs must be a positive number');
  }
  if (
    config.topicShiftThreshold !== undefined
    && (!Number.isFinite(config.topicShiftThreshold)
      || config.topicShiftThreshold < 0
      || config.topicShiftThreshold > 1)
  ) {
    throw new Error('--snapshot-config.topicShiftThreshold must be a number in [0, 1]');
  }
  if (config.t1MaxChars !== undefined && (!Number.isFinite(config.t1MaxChars) || config.t1MaxChars <= 0)) {
    throw new Error('--snapshot-config.t1MaxChars must be a positive number');
  }
  return config;
}

export function runShadowEvaluation(
  fixtureFile: ShadowFixtureFile,
  fixturePath: string,
  generatedAt: string,
  options: {
    command: string;
    snapshotConfig?: SnapshotConfig;
    configSource: ShadowConfigSource;
    /** Root used to resolve the fingerprint sources (tests / alternate checkouts). */
    rootDir?: string;
  } = {
    command: RUNNER,
    configSource: 'frozen',
  },
): ShadowBaselineReport {
  // The P0 runner resolves and records the effective serve config, so the arms
  // run with exactly the P0 configuration (no second merge implementation).
  const p0 = runEvaluation(fixtureFile, fixturePath, generatedAt, {
    command: options.command,
    configSource: options.configSource,
    ...(options.snapshotConfig ? { snapshotConfig: options.snapshotConfig } : {}),
    ...(options.rootDir ? { rootDir: options.rootDir } : {}),
  });

  const cases: ShadowCaseResult[] = fixtureFile.cases.map((fixture) => ({
    id: fixture.id,
    arms: evaluateSessionShadowFixture(fixture, { snapshotConfig: p0.snapshotConfig }),
  }));
  const summary = summarizeSessionShadow(
    cases.flatMap((entry) => SESSION_SHADOW_ARMS.map((arm) => entry.arms[arm])),
  );

  return {
    bootstrap: true,
    notAPublicBenchmark: true,
    evaluator: SHADOW_EVALUATOR,
    arms: [...SESSION_SHADOW_ARMS],
    codeFingerprint: computeShadowCodeFingerprint(options.rootDir),
    command: options.command,
    configSource: options.configSource,
    snapshotConfig: p0.snapshotConfig,
    fixture: {
      path: fixturePath,
      version: fixtureFile.version,
      status: fixtureFile.status,
      frozenAt: fixtureFile.frozenAt ?? null,
      seed: fixtureFile.seed ?? null,
      notes: fixtureFile.notes ?? [],
      cases: fixtureFile.cases.length,
      liveCases: fixtureFile.cases.filter((fixture) => fixture.liveCapture !== undefined).length,
      topicCases: fixtureFile.cases.filter((fixture) => fixture.topicState !== undefined).length,
      topicAudit: fixtureFile.topicAudit ?? null,
    },
    generatedAt,
    summary,
    cases,
  };
}

function parseArgs(argv: string[]): {
  out: string | null;
  fixtures: string | null;
  snapshotConfig: string | null;
  generatedAt: string | null;
  help: boolean;
} {
  const args = {
    out: null as string | null,
    fixtures: null as string | null,
    snapshotConfig: null as string | null,
    generatedAt: null as string | null,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value == null) throw new Error(`missing value for ${flag}`);
      return value;
    };
    if (flag === '--out') args.out = next();
    else if (flag === '--fixtures') args.fixtures = next();
    else if (flag === '--snapshot-config') args.snapshotConfig = next();
    else if (flag === '--generated-at') args.generatedAt = next();
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function pct(value: number | null): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function counts(rate: QualityRate): string {
  return `${rate.numerator}/${rate.denominator}`;
}

function formatShadowSummary(report: ShadowBaselineReport): string {
  const { summary, snapshotConfig } = report;
  const lines: string[] = [];
  lines.push(
    `shadow session recall quality - ${summary.cases} cases, ${report.arms.length} arms `
      + `(not a benchmark; P1 shadow pilot)`,
  );
  lines.push(
    `snapshot config (${report.configSource}): ttl ${snapshotConfig.ttlMs ?? '?'}ms, `
      + `topic-shift ${snapshotConfig.topicShiftThreshold ?? '?'}, `
      + `t1MaxChars ${snapshotConfig.t1MaxChars ?? '?'}`,
  );
  for (const arm of report.arms) {
    const entry = summary.arms[arm];
    lines.push(
      `${arm.padEnd(18)} serve ${entry.serve.served}/${entry.cases} (filtered ${entry.serve.filtered}, `
        + `not served ${entry.serve.notServed}, measured ${entry.measuredCases}`
        + `${entry.unmeasuredCases > 0 ? `, unmeasured ${entry.unmeasuredCases}` : ''})  `
        + `precision ${pct(entry.usefulAnchorPrecision.value)} (${counts(entry.usefulAnchorPrecision)})  `
        + `coverage ${pct(entry.answerCoverage.value)} (${counts(entry.answerCoverage)})  `
        + `false-display ${pct(entry.falseDisplay.value)} (${counts(entry.falseDisplay)})  `
        + `suppression ${pct(entry.legitimateSuppression.value)} (${counts(entry.legitimateSuppression)})  `
        + `neighbor ${pct(entry.neighborPrecision.value)} (${counts(entry.neighborPrecision)})  `
        + `t1-repeat ${pct(entry.t1Repeat.value)} (${counts(entry.t1Repeat)})`,
    );
  }
  const audit = summary.topicAudit;
  lines.push(
    `topic audit: ${audit.casesWithTopic}/${summary.cases} case(s) froze a TopicState; `
      + `facet applied ${audit.facetsApplied}; fallbacks `
      + `${Object.entries(audit.facetFallbacks).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}`,
  );
  for (const entry of audit.staleRisk) {
    lines.push(`  ! stale-risk ${entry.caseId}: ${entry.reasons.join('; ')}`);
  }
  for (const arm of report.arms) {
    const incomplete = summary.arms[arm];
    if (!incomplete.measurementComplete) {
      lines.push(`  WARNING ${arm}: measurement incomplete (${incomplete.unannotatedDisplayed.length} unannotated)`);
    }
    for (const warning of incomplete.warnings) lines.push(`    ! ${warning}`);
  }
  lines.push('per case (arm: serve / anchor precision / coverage / suppression):');
  for (const entry of report.cases) {
    for (const arm of report.arms) {
      const result = entry.arms[arm];
      lines.push(
        `  ${entry.id}  ${arm}  `
          + `${result.available ? (result.served ? 'served' : `fallback:${result.fallbackReason}`) : 'not-measured'}  `
          + `precision ${pct(result.metrics.usefulAnchorPrecision.value)} `
          + `(${counts(result.metrics.usefulAnchorPrecision)})  `
          + `coverage ${pct(result.metrics.answerCoverage.value)} (${counts(result.metrics.answerCoverage)})  `
          + `suppression ${counts(result.metrics.legitimateSuppression)}`
          + `${result.facetFallback ? `  facet-fallback:${result.facetFallback}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

export function main(argv: string[] = process.argv.slice(2)): ShadowBaselineReport | null {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'usage: npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run-shadow.ts '
        + '--out <json-path> [--fixtures <path>] [--snapshot-config <json>] [--generated-at <iso>]',
    );
    return null;
  }
  if (!args.out) throw new Error('--out <json-path> is required');
  const fixturePath = args.fixtures
    ? path.resolve(args.fixtures)
    : path.resolve(__dirname, 'fixtures.json');
  const outPath = path.resolve(args.out);
  const fixtureFile = loadShadowFixtureFile(fixturePath);

  const generatedAt = args.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error(`--generated-at must be a parseable ISO timestamp, got "${generatedAt}"`);
  }

  const command = [RUNNER, ...argv].join(' ').trim();
  const override = args.snapshotConfig ? parseSnapshotConfigOverride(args.snapshotConfig) : undefined;
  const report = runShadowEvaluation(
    fixtureFile,
    path.relative(REPO_ROOT, fixturePath).split(path.sep).join('/'),
    generatedAt,
    {
      command,
      configSource: override ? 'override' : 'frozen',
      ...(override ? { snapshotConfig: override } : {}),
    },
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(formatShadowSummary(report));
  console.log(`code fingerprint (${report.codeFingerprint.algorithm}): ${report.codeFingerprint.digest}`);
  console.log(`shadow baseline written: ${outPath}`);
  console.log(
    'NOTE: 3-case P1 pilot shadow set - not a benchmark; do not tune production admission on it.',
  );
  return report;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
