/**
 * Checked-in baseline regression gate for the session-shaped quality runner.
 *
 * `gateway/tsconfig.json` only includes `src/**`, so the evaluation runner was
 * previously outside any type/test gate: editing a fixture (or the evaluator)
 * could change the reported numbers without anyone noticing that the checked-in
 * `baseline.json` no longer matched.
 *
 * This suite closes that hole. It drives the REAL runner entry point
 * (`runEvaluation`) over the frozen fixtures, freezes `generatedAt`, and compares
 * the result with the checked-in baseline:
 *
 *   - `summary` (all numerators/denominators), per-case `cases`, the effective
 *     `snapshotConfig` and the fixture metadata must match exactly;
 *   - the code fingerprint (SHA256 over the serve-path sources the evaluator
 *     actually imports) must match the one recorded in the baseline, so a baseline
 *     can never describe a different code state than the one under test;
 *   - the six head-line numbers are asserted literally, so regenerating the
 *     baseline cannot silently bless a regression;
 *   - a deliberate config override must change the summary (the gate measures,
 *     it does not echo a constant).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  loadFixtureFile,
  runEvaluation,
  type BaselineReport,
  type FixtureFile,
} from '../../../../evaluation/session-recall/run';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES = path.join(REPO_ROOT, 'evaluation/session-recall/fixtures.json');
const BASELINE = path.join(REPO_ROOT, 'evaluation/session-recall/baseline.json');
/** The repo-relative path the baseline records for `fixture.path`. */
const FIXTURE_REPORT_PATH = 'evaluation/session-recall/fixtures.json';

/** The serve-path sources the fingerprint must cover (runner order). */
const FINGERPRINT_PATHS = [
  'gateway/src/recall/session-quality.ts',
  'gateway/src/recall/snapshot-current-query.ts',
  'gateway/src/recall/lexical-support.ts',
  'gateway/src/recall/recall-snapshot.ts',
  'gateway/src/recall/inject-format.ts',
  'gateway/src/recall/verbatim-recall.ts',
];

function readBaseline(): BaselineReport {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as BaselineReport;
}

function rerun(fixtureFile: FixtureFile, baseline: BaselineReport): BaselineReport {
  return runEvaluation(fixtureFile, FIXTURE_REPORT_PATH, baseline.generatedAt, {
    command: baseline.command,
    configSource: 'frozen',
  });
}

describe('session recall quality runner — checked-in baseline gate', () => {
  test('importing the runner exposes the API without executing main', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      jest.isolateModules(() => {
        // A live `main()` would reject the (missing) --out argument, so the
        // guard is observable: both an error log and exitCode=1 would appear.
        const isolated = require('../../../../evaluation/session-recall/run') as typeof import(
          '../../../../evaluation/session-recall/run'
        );
        expect(typeof isolated.runEvaluation).toBe('function');
        expect(typeof isolated.loadFixtureFile).toBe('function');
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  test('re-running the frozen fixtures reproduces the checked-in baseline', () => {
    const baseline = readBaseline();
    const report = rerun(loadFixtureFile(FIXTURES), baseline);

    expect(report.generatedAt).toBe(baseline.generatedAt);
    expect(report.configSource).toBe('frozen');
    expect(report.snapshotConfig).toEqual(baseline.snapshotConfig);
    expect(report.fixture).toEqual(baseline.fixture);
    expect(report.summary).toEqual(baseline.summary);
    expect(report.cases).toEqual(baseline.cases);
    // The baseline must describe the code that produced it.
    expect(report.codeFingerprint).toEqual(baseline.codeFingerprint);
  });

  test('the code fingerprint covers the consumed serve-path sources', () => {
    const baseline = readBaseline();

    expect(baseline.codeFingerprint.algorithm).toBe('sha256');
    expect(baseline.codeFingerprint.files.map((file) => file.path)).toEqual(FINGERPRINT_PATHS);
    for (const file of baseline.codeFingerprint.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(baseline.codeFingerprint.digest).toMatch(/^[0-9a-f]{64}$/);

    // Same code passed in twice -> same digest (deterministic, no timestamps).
    const rerunA = rerun(loadFixtureFile(FIXTURES), baseline);
    const rerunB = rerun(loadFixtureFile(FIXTURES), baseline);
    expect(rerunA.codeFingerprint).toEqual(rerunB.codeFingerprint);
    expect(rerunA.codeFingerprint.digest).toBe(baseline.codeFingerprint.digest);
  });

  test('the frozen head-line numbers are asserted literally (real regression gate)', () => {
    const baseline = readBaseline();
    const summary = baseline.summary;

    expect(summary.cases).toBe(3);
    expect(summary.answerableCases).toBe(1);
    expect(summary.noAnswerControls).toBe(2);
    expect(summary.serve).toMatchObject({
      served: 3,
      filtered: 2,
      fallback: 0,
      notServed: 0,
      decisions: { use: 3 },
    });
    expect(summary.usefulAnchorPrecision).toEqual({ numerator: 2, denominator: 8, value: 0.25 });
    expect(summary.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(summary.falseDisplay).toEqual({ numerator: 2, denominator: 2, value: 1 });
    expect(summary.legitimateSuppression).toEqual({ numerator: 0, denominator: 2, value: 0 });
    expect(summary.neighborPrecision).toEqual({ numerator: 0, denominator: 2, value: 0 });
    expect(summary.t1Repeat).toEqual({ numerator: 3, denominator: 3, value: 1 });
    expect(summary.falseDisplayIds).toEqual(['q15k2p', '7lsgaw', 'q15k2p', '7lsgaw', 'cifyzn']);
    expect(summary.measurementComplete).toBe(true);
    expect(summary.unannotatedDisplayed).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });

  test('a deliberate config override changes the measured summary', () => {
    const baseline = readBaseline();
    const report = runEvaluation(loadFixtureFile(FIXTURES), FIXTURE_REPORT_PATH, baseline.generatedAt, {
      command: baseline.command,
      snapshotConfig: { ttlMs: 1 },
      configSource: 'override',
    });

    expect(report.configSource).toBe('override');
    expect(report.snapshotConfig.ttlMs).toBe(1);
    // Every frozen `now` is later than its snapshot by more than 1 ms.
    expect(report.summary.serve.notServed).toBe(3);
    expect(report.summary.serve.decisions).toEqual({ stale: 3 });
    expect(report.summary).not.toEqual(baseline.summary);
  });
});
