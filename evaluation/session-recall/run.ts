/**
 * Session-shaped recall quality runner (P0 bootstrap baseline).
 *
 * Reads the frozen fixture file, evaluates every case with the REAL snapshot
 * decision + serve adapter (`gateway/src/recall/session-quality.ts`) and writes
 * a reproducible JSON baseline. No DB read, no live gateway config, no model
 * calls, no writes outside the requested output file.
 *
 * Usage:
 *   npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run.ts \
 *     --out evaluation/session-recall/baseline.json
 *
 * Optional: --fixtures <path>  --snapshot-config <json>  --generated-at <iso>
 *           --help
 *
 * The numeric metrics are a pure function of the frozen fixture file and its
 * frozen top-level `snapshotConfig` (or an explicit `--snapshot-config` JSON
 * override): re-running with the same fixtures and the same code fingerprint
 * reproduces every numerator/denominator (`command` alone is not provenance —
 * it does not say which code ran). Only `generatedAt` reflects wall-clock time
 * (pass --generated-at for a byte-identical report).
 *
 * The report also records a deterministic SHA256 fingerprint of the serve-path
 * sources the evaluator actually consumes (read with `fs`, never `git`), so a
 * code change that can move the numbers changes the fingerprint.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SNAPSHOT_DEFAULTS, type SnapshotConfig } from '../../gateway/src/recall/recall-snapshot';
import {
  evaluateSessionSnapshotFixture,
  summarizeSessionSnapshotQuality,
  validateSessionSnapshotQualityFixture,
  type QualityRate,
  type SessionSnapshotQualityFixture,
  type SessionSnapshotQualityResult,
  type SessionSnapshotQualitySummary,
} from '../../gateway/src/recall/session-quality';

const SUPPORTED_FIXTURE_VERSION = 1;
const RUNNER = 'npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run.ts';
const REPO_ROOT = path.resolve(__dirname, '../..');

type SnapshotConfigSource = 'frozen' | 'override';

/**
 * The serve-path modules the evaluator imports, in fingerprint order. This is
 * the slice that decides what the measured block renders: the evaluator itself,
 * the current-query adapter, lexical support, the snapshot decision/defaults,
 * the block renderer and the T1 renderer. Deliberately a fixed list (no import
 * graph parser): adding a module here is an explicit, reviewable change.
 */
export const FINGERPRINT_SOURCES = [
  'gateway/src/recall/session-quality.ts',
  'gateway/src/recall/snapshot-current-query.ts',
  'gateway/src/recall/lexical-support.ts',
  'gateway/src/recall/recall-snapshot.ts',
  'gateway/src/recall/inject-format.ts',
  'gateway/src/recall/verbatim-recall.ts',
] as const;

export interface CodeFingerprintFile {
  /** Repo-relative path. */
  path: string;
  /** SHA256 of the file content with line endings normalised to LF. */
  sha256: string;
}

export interface CodeFingerprint {
  algorithm: 'sha256';
  /** SHA256 over the `path:sha256` manifest lines, in `files` order. */
  digest: string;
  files: CodeFingerprintFile[];
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Fingerprint the code under test without invoking `git`.
 *
 * Line endings are normalised to LF before hashing, so a Windows checkout and a
 * Linux checkout of the same commit produce the same fingerprint. File order is
 * the declared `FINGERPRINT_SOURCES` order, and the digest covers the manifest,
 * so it is deterministic across machines and runs.
 */
export function computeCodeFingerprint(rootDir: string = REPO_ROOT): CodeFingerprint {
  const files = FINGERPRINT_SOURCES.map((relativePath) => {
    const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8').replace(/\r\n/g, '\n');
    return { path: relativePath, sha256: sha256(source) };
  });
  return {
    algorithm: 'sha256',
    digest: sha256(files.map((file) => `${file.path}:${file.sha256}`).join('\n')),
    files,
  };
}

/** Effective snapshot config the run used (defaults resolved). */
interface EffectiveSnapshotConfig {
  /** Informational only: the evaluator measures the serve path itself. */
  enabled: boolean;
  ttlMs: number;
  topicShiftThreshold: number;
  t1MaxChars: number;
}

/**
 * Merge the frozen capture config with an explicit override. The runner never
 * reads the live gateway config: a frozen baseline must not change just because
 * the local machine (or an env var) tuned `config.search.snapshot`.
 */
function effectiveSnapshotConfig(
  frozen: SnapshotConfig,
  override?: SnapshotConfig,
): EffectiveSnapshotConfig {
  const merged = { ...frozen, ...(override ?? {}) };
  return {
    enabled: merged.enabled === true,
    ttlMs: merged.ttlMs ?? SNAPSHOT_DEFAULTS.ttlMs,
    topicShiftThreshold: merged.topicShiftThreshold ?? SNAPSHOT_DEFAULTS.topicShiftThreshold,
    t1MaxChars: merged.t1MaxChars ?? SNAPSHOT_DEFAULTS.t1MaxChars,
  };
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

function validateSnapshotConfigFields(config: SnapshotConfig, label: string): void {
  if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
    throw new Error(`${label}.enabled must be a boolean when present`);
  }
  if (config.ttlMs !== undefined && (!Number.isFinite(config.ttlMs) || config.ttlMs <= 0)) {
    throw new Error(`${label}.ttlMs must be a positive number`);
  }
  if (
    config.topicShiftThreshold !== undefined
    && (!Number.isFinite(config.topicShiftThreshold)
      || config.topicShiftThreshold < 0
      || config.topicShiftThreshold > 1)
  ) {
    throw new Error(`${label}.topicShiftThreshold must be a number in [0, 1]`);
  }
  if (config.t1MaxChars !== undefined && (!Number.isFinite(config.t1MaxChars) || config.t1MaxChars <= 0)) {
    throw new Error(`${label}.t1MaxChars must be a positive number`);
  }
}

function validateFrozenSnapshotConfig(value: unknown): SnapshotConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('fixture.snapshotConfig must be an object (frozen capture config)');
  }
  const config = value as SnapshotConfig;
  validateSnapshotConfigFields(config, 'fixture.snapshotConfig');
  if (config.ttlMs === undefined) throw new Error('fixture.snapshotConfig.ttlMs is required');
  if (config.topicShiftThreshold === undefined) {
    throw new Error('fixture.snapshotConfig.topicShiftThreshold is required');
  }
  if (config.t1MaxChars === undefined) throw new Error('fixture.snapshotConfig.t1MaxChars is required');
  return config;
}

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
  validateSnapshotConfigFields(config, '--snapshot-config');
  return config;
}

export interface FixtureFile {
  version: number;
  status: string;
  notAPublicBenchmark: boolean;
  frozenAt?: string;
  seed?: string;
  notes?: string[];
  /** Frozen capture-time snapshot config (no live config read). */
  snapshotConfig: SnapshotConfig;
  cases: SessionSnapshotQualityFixture[];
}

export interface BaselineReport {
  bootstrap: true;
  notAPublicBenchmark: true;
  evaluator: 'gateway/src/recall/session-quality.ts';
  /** SHA256 over the serve-path sources the evaluator consumes (no git call). */
  codeFingerprint: CodeFingerprint;
  command: string;
  /** Where `snapshotConfig` came from: the frozen fixture or --snapshot-config. */
  configSource: SnapshotConfigSource;
  snapshotConfig: EffectiveSnapshotConfig;
  fixture: {
    path: string;
    version: number;
    status: string;
    frozenAt: string | null;
    seed: string | null;
    notes: string[];
    cases: number;
  };
  generatedAt: string;
  summary: AggregateSummary;
  cases: SessionSnapshotQualityResult[];
}

type AggregateSummary = Omit<SessionSnapshotQualitySummary, 'results'>;

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

export function loadFixtureFile(fixturePath: string): FixtureFile {
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as FixtureFile;
  if (!raw || typeof raw !== 'object') throw new Error('fixture file must be an object');
  if (raw.version !== SUPPORTED_FIXTURE_VERSION) {
    throw new Error(
      `unsupported fixture version ${String(raw.version)} (evaluator supports ${SUPPORTED_FIXTURE_VERSION})`,
    );
  }
  if (raw.status !== 'bootstrap') {
    throw new Error(`fixture status must be "bootstrap" (got "${raw.status}"); this set is not a public benchmark`);
  }
  if (raw.notAPublicBenchmark !== true) {
    throw new Error('fixture must declare notAPublicBenchmark: true');
  }
  validateFrozenSnapshotConfig(raw.snapshotConfig);
  if (!Array.isArray(raw.cases) || raw.cases.length === 0) {
    throw new Error('fixture.cases must be a non-empty array');
  }
  const seen = new Set<string>();
  for (const fixture of raw.cases) {
    validateSessionSnapshotQualityFixture(fixture);
    if (seen.has(fixture.id)) throw new Error(`duplicate fixture id: ${fixture.id}`);
    seen.add(fixture.id);
  }
  return raw;
}

function pct(value: number | null): string {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function counts(rate: QualityRate): string {
  return `${rate.numerator}/${rate.denominator}`;
}

function formatSummary(
  summary: AggregateSummary,
  cases: readonly SessionSnapshotQualityResult[],
  snapshotConfig: EffectiveSnapshotConfig,
  configSource: SnapshotConfigSource,
): string {
  const lines: string[] = [];
  lines.push(
    `bootstrap session recall quality - ${summary.cases} cases `
      + `(answerable ${summary.answerableCases}, no-answer controls ${summary.noAnswerControls})`,
  );
  lines.push(
    `snapshot config (${configSource}): ttl ${snapshotConfig.ttlMs}ms, `
      + `topic-shift ${snapshotConfig.topicShiftThreshold}, t1MaxChars ${snapshotConfig.t1MaxChars} `
      + `(enabled=${snapshotConfig.enabled}, informational)`,
  );
  const decisions = Object.entries(summary.serve.decisions)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
  const reasons = Object.entries(summary.serve.fallbackReasons)
    .map(([key, count]) => `${key}=${count}`)
    .join(', ');
  lines.push(
    `serve: ${summary.serve.served} (filtered ${summary.serve.filtered}, not served ${summary.serve.notServed}) `
      + `decisions ${decisions || 'none'}${reasons ? `; fallbacks ${reasons}` : ''}`,
  );
  lines.push(`useful anchor precision   ${pct(summary.usefulAnchorPrecision.value)} (${counts(summary.usefulAnchorPrecision)})`);
  lines.push(`answer coverage           ${pct(summary.answerCoverage.value)} (${counts(summary.answerCoverage)})`);
  lines.push(
    `false display             ${pct(summary.falseDisplay.value)} `
      + `(${counts(summary.falseDisplay)} controls, ${summary.falseDisplayIds.length} noise ids)`,
  );
  lines.push(`legitimate suppression    ${pct(summary.legitimateSuppression.value)} (${counts(summary.legitimateSuppression)})`);
  lines.push(`neighbor precision        ${pct(summary.neighborPrecision.value)} (${counts(summary.neighborPrecision)})`);
  lines.push(`t1 repeat                 ${pct(summary.t1Repeat.value)} (${counts(summary.t1Repeat)})`);
  if (summary.falseDisplayIds.length > 0) {
    lines.push(`false display ids: ${summary.falseDisplayIds.join(', ')}`);
  }
  if (summary.suppressedIds.length > 0) {
    lines.push(`suppressed ids: ${summary.suppressedIds.join(', ')}`);
  }
  if (!summary.measurementComplete) {
    lines.push(`WARNING: measurement incomplete (${summary.unannotatedDisplayed.length} unannotated display(s))`);
    for (const warning of summary.warnings) lines.push(`  ! ${warning}`);
  }
  lines.push('per case:');
  for (const entry of cases) {
    const anchors = entry.displayed.filter((displayed) => displayed.role === 'anchor').length;
    const noise = entry.falseDisplayIds.length;
    lines.push(
      `  ${entry.id}  ${entry.decision}/${entry.served ? 'served' : `fallback:${entry.fallbackReason}`}  `
        + `anchors ${anchors}  precision ${pct(entry.metrics.usefulAnchorPrecision.value)} `
        + `(${counts(entry.metrics.usefulAnchorPrecision)})  `
        + `coverage ${pct(entry.metrics.answerCoverage.value)} (${counts(entry.metrics.answerCoverage)})  `
        + `suppressed ${counts(entry.metrics.legitimateSuppression)}`
        + `${noise > 0 ? `  false-display noise ${noise}` : ''}`,
    );
  }
  return lines.join('\n');
}

export function runEvaluation(
  fixtureFile: FixtureFile,
  fixturePath: string,
  generatedAt: string,
  options: {
    command: string;
    snapshotConfig?: SnapshotConfig;
    configSource: SnapshotConfigSource;
    /** Root used to resolve the fingerprint sources (tests / alternate checkouts). */
    rootDir?: string;
  } = {
    command: RUNNER,
    configSource: 'frozen',
  },
): BaselineReport {
  const snapshotConfig = effectiveSnapshotConfig(fixtureFile.snapshotConfig, options.snapshotConfig);
  const results = fixtureFile.cases.map((fixture) =>
    evaluateSessionSnapshotFixture(fixture, { snapshotConfig }),
  );
  const summary = summarizeSessionSnapshotQuality(results);
  const { results: perCase, ...aggregate } = summary;
  return {
    bootstrap: true,
    notAPublicBenchmark: true,
    evaluator: 'gateway/src/recall/session-quality.ts',
    codeFingerprint: computeCodeFingerprint(options.rootDir),
    command: options.command,
    configSource: options.configSource,
    snapshotConfig,
    fixture: {
      path: fixturePath,
      version: fixtureFile.version,
      status: fixtureFile.status,
      frozenAt: fixtureFile.frozenAt ?? null,
      seed: fixtureFile.seed ?? null,
      notes: fixtureFile.notes ?? [],
      cases: fixtureFile.cases.length,
    },
    generatedAt,
    summary: aggregate,
    cases: perCase,
  };
}

export function main(argv: string[] = process.argv.slice(2)): BaselineReport | null {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      'usage: npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run.ts '
        + '--out <json-path> [--fixtures <path>] [--snapshot-config <json>] [--generated-at <iso>]',
    );
    return null;
  }
  if (!args.out) throw new Error('--out <json-path> is required');
  const fixturePath = args.fixtures
    ? path.resolve(args.fixtures)
    : path.resolve(__dirname, 'fixtures.json');
  const outPath = path.resolve(args.out);
  const fixtureFile = loadFixtureFile(fixturePath);

  const generatedAt = args.generatedAt ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new Error(`--generated-at must be a parseable ISO timestamp, got "${generatedAt}"`);
  }

  const command = [RUNNER, ...argv].join(' ').trim();
  const override = args.snapshotConfig ? parseSnapshotConfigOverride(args.snapshotConfig) : undefined;
  const configSource: SnapshotConfigSource = override ? 'override' : 'frozen';
  const report = runEvaluation(
    fixtureFile,
    path.relative(path.resolve(__dirname, '../..'), fixturePath).split(path.sep).join('/'),
    generatedAt,
    { command, snapshotConfig: override, configSource },
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(formatSummary(report.summary, report.cases, report.snapshotConfig, report.configSource));
  console.log(`code fingerprint (${report.codeFingerprint.algorithm}): ${report.codeFingerprint.digest}`);
  console.log(`baseline written: ${outPath}`);
  console.log('NOTE: bootstrap set only - not a public benchmark; do not tune production admission on 3 cases.');
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
