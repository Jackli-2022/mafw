/**
 * Checked-in baseline consistency gate for the P1 shadow runner.
 *
 * The P0 gate (`session-quality-runner.test.ts`) covers the snapshot serve path.
 * This suite covers `evaluation/session-recall/run-shadow.ts`, which is outside
 * `gateway/tsconfig.json` and therefore outside the type gate as well:
 *
 *   - importing the runner must not execute `main` (the module is required by
 *     this test and by tooling);
 *   - re-running the frozen fixtures at the baseline's `generatedAt` must
 *     reproduce `arms` / `configSource` / `snapshotConfig` / `fixture` /
 *     `summary` / `cases` / `codeFingerprint` exactly;
 *   - a **stale** baseline (different code fingerprint, config, or numbers) must
 *     fail loudly instead of being accepted, which is what makes the checked-in
 *     file a gate rather than a snapshot;
 *   - the 3-case pilot head-line numbers are asserted literally, so regenerating
 *     the baseline cannot silently bless a regression;
 *   - an explicit config override must change the measured decision (the gate
 *     measures, it does not echo a constant).
 *
 * The fingerprinted source list includes `run-shadow.ts` itself: editing the
 * runner invalidates the checked-in baseline by design, so the same change must
 * regenerate `shadow-baseline.json`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SHADOW_BASELINE_COMPARED_FIELDS,
  SHADOW_BASELINE_FLAG_FIELDS,
  SHADOW_BASELINE_KNOWN_FIELDS,
  SHADOW_BASELINE_UNCOMPARED_FIELDS,
  SHADOW_FINGERPRINT_SOURCES,
  assertShadowBaselineConsistent,
  diffShadowBaseline,
  loadShadowFixtureFile,
  runShadowEvaluation,
  type ShadowBaselineReport,
} from '../../../../evaluation/session-recall/run-shadow';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES = path.join(REPO_ROOT, 'evaluation/session-recall/fixtures.json');
const BASELINE = path.join(REPO_ROOT, 'evaluation/session-recall/shadow-baseline.json');
/** The repo-relative path the baseline records for `fixture.path`. */
const FIXTURE_REPORT_PATH = 'evaluation/session-recall/fixtures.json';

/** The serve-path + shadow sources the fingerprint must cover (runner order). */
const SHADOW_FINGERPRINT_PATHS = [
  'gateway/src/recall/session-quality.ts',
  'gateway/src/recall/snapshot-current-query.ts',
  'gateway/src/recall/lexical-support.ts',
  'gateway/src/recall/recall-snapshot.ts',
  'gateway/src/recall/inject-format.ts',
  'gateway/src/recall/verbatim-recall.ts',
  'gateway/src/recall/exact-evidence.ts',
  'gateway/src/recall/session-quality-shadow.ts',
  'evaluation/session-recall/run-shadow.ts',
];

const ARMS = ['snapshot-current', 'current-query-off', 'live-frozen', 'topic-facet'] as const;

function readBaseline(): ShadowBaselineReport {
  return JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as ShadowBaselineReport;
}

function rerun(baseline: ShadowBaselineReport): ShadowBaselineReport {
  return runShadowEvaluation(
    loadShadowFixtureFile(FIXTURES),
    FIXTURE_REPORT_PATH,
    baseline.generatedAt,
    { command: baseline.command, configSource: 'frozen' },
  );
}

/** A structurally valid copy of the checked-in baseline that a test can corrupt. */
function copyBaseline(): ShadowBaselineReport {
  return JSON.parse(JSON.stringify(readBaseline())) as ShadowBaselineReport;
}

/** The mismatch paths a corrupted baseline produces against a real re-run. */
function mismatchPaths(baseline: ShadowBaselineReport): string[] {
  return diffShadowBaseline(baseline, rerun(baseline)).map((mismatch) => mismatch.path);
}

describe('session recall shadow runner — import contract', () => {
  test('importing the runner exposes the API without executing main', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      jest.isolateModules(() => {
        // A live `main()` would reject the (missing) --out argument, so the
        // guard is observable: an error log and exitCode=1 would appear.
        const isolated = require('../../../../evaluation/session-recall/run-shadow') as typeof import(
          '../../../../evaluation/session-recall/run-shadow'
        );
        expect(typeof isolated.runShadowEvaluation).toBe('function');
        expect(typeof isolated.loadShadowFixtureFile).toBe('function');
        expect(typeof isolated.assertShadowBaselineConsistent).toBe('function');
      });
      expect(errorSpy).not.toHaveBeenCalled();
      // `main()` prints a summary; a silent import must print nothing at all.
      expect(logSpy).not.toHaveBeenCalled();
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  test('the fingerprint source list is the fixed, reviewable 9-file list', () => {
    expect([...SHADOW_FINGERPRINT_SOURCES]).toEqual(SHADOW_FINGERPRINT_PATHS);
  });
});

describe('session recall shadow runner — checked-in baseline gate', () => {
  test('re-running at the baseline generatedAt reproduces the checked-in baseline', () => {
    const baseline = readBaseline();
    const report = rerun(baseline);

    expect(report.generatedAt).toBe(baseline.generatedAt);
    expect(report.configSource).toBe('frozen');
    expect(report.evaluator).toBe(baseline.evaluator);
    expect(report.arms).toEqual(baseline.arms);
    expect(report.snapshotConfig).toEqual(baseline.snapshotConfig);
    expect(report.fixture).toEqual(baseline.fixture);
    expect(report.summary).toEqual(baseline.summary);
    expect(report.cases).toEqual(baseline.cases);
    // The baseline must describe the code that produced it.
    expect(report.codeFingerprint).toEqual(baseline.codeFingerprint);

    expect(diffShadowBaseline(baseline, report)).toEqual([]);
    expect(() => assertShadowBaselineConsistent(baseline, report)).not.toThrow();
  });

  test('the baseline records the reproduction command and the layout contract', () => {
    const baseline = readBaseline();

    expect(baseline.bootstrap).toBe(true);
    expect(baseline.notAPublicBenchmark).toBe(true);
    expect(baseline.evaluator).toBe('gateway/src/recall/session-quality-shadow.ts');
    expect(baseline.arms).toEqual([...ARMS]);
    expect(baseline.generatedAt).toBe('2026-11-19T10:00:00.000Z');
    expect(baseline.command).toBe(
      'npx ts-node --project gateway/tsconfig.json evaluation/session-recall/run-shadow.ts '
        + '--out evaluation/session-recall/shadow-baseline.json --generated-at 2026-11-19T10:00:00.000Z',
    );
    expect(baseline.configSource).toBe('frozen');
    expect(baseline.snapshotConfig).toEqual({
      enabled: true,
      ttlMs: 600000,
      topicShiftThreshold: 0.25,
      t1MaxChars: 600,
    });
    expect(baseline.fixture).toMatchObject({
      path: FIXTURE_REPORT_PATH,
      version: 1,
      status: 'bootstrap',
      frozenAt: '2026-11-19',
      cases: 3,
      liveCases: 3,
      topicCases: 3,
    });
  });

  test('the code fingerprint covers the shadow sources and is stable', () => {
    const baseline = readBaseline();
    const fingerprint = baseline.codeFingerprint;

    expect(fingerprint.algorithm).toBe('sha256');
    expect(fingerprint.files.map((file) => file.path)).toEqual(SHADOW_FINGERPRINT_PATHS);
    for (const file of fingerprint.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(fingerprint.digest).toMatch(/^[0-9a-f]{64}$/);

    // Same code passed in twice -> same digest (deterministic, no timestamps).
    const rerunA = rerun(baseline);
    const rerunB = rerun(baseline);
    expect(rerunA.codeFingerprint).toEqual(rerunB.codeFingerprint);
    expect(rerunA.codeFingerprint.digest).toBe(fingerprint.digest);
  });

  test('the frozen pilot head-line numbers are asserted literally per arm', () => {
    const { summary } = readBaseline();
    expect(summary.cases).toBe(3);

    // snapshot-current: the real P0 evaluator, delegated verbatim.
    expect(summary.arms['snapshot-current']).toMatchObject({
      arm: 'snapshot-current',
      cases: 3,
      answerableCases: 1,
      noAnswerControls: 2,
      serve: { served: 3, filtered: 2, fallback: 0, notServed: 0, decisions: { use: 3 } },
      usefulAnchorPrecision: { numerator: 2, denominator: 8, value: 0.25 },
      answerCoverage: { numerator: 1, denominator: 1, value: 1 },
      falseDisplay: { numerator: 2, denominator: 2, value: 1 },
      legitimateSuppression: { numerator: 0, denominator: 2, value: 0 },
      neighborPrecision: { numerator: 0, denominator: 2, value: 0 },
      t1Repeat: { numerator: 3, denominator: 3, value: 1 },
      falseDisplayIds: ['q15k2p', '7lsgaw', 'q15k2p', '7lsgaw', 'cifyzn'],
      suppressedIds: [],
      unannotatedDisplayed: [],
      measurementComplete: true,
      warnings: [],
      measuredCases: 3,
      unmeasuredCases: 0,
      unmeasuredCaseIds: [],
    });

    // current-query-off: only the adapter is skipped, so the stored block serves
    // verbatim (filtered 0) and two extra neighbours / one extra T1 line appear.
    expect(summary.arms['current-query-off']).toMatchObject({
      arm: 'current-query-off',
      serve: { served: 3, filtered: 0, fallback: 0, notServed: 0, decisions: { use: 3 } },
      usefulAnchorPrecision: { numerator: 2, denominator: 8, value: 0.25 },
      answerCoverage: { numerator: 1, denominator: 1, value: 1 },
      falseDisplay: { numerator: 2, denominator: 2, value: 1 },
      legitimateSuppression: { numerator: 0, denominator: 2, value: 0 },
      neighborPrecision: { numerator: 0, denominator: 4, value: 0 },
      t1Repeat: { numerator: 4, denominator: 4, value: 1 },
      falseDisplayIds: ['q15k2p', '7lsgaw', 'q15k2p', '7lsgaw', 'cifyzn'],
      measuredCases: 3,
      unmeasuredCases: 0,
    });

    // live-frozen: a LATER live call for the same text; both negative captures
    // are bare topic shells (no pointer printed), so they are not served.
    expect(summary.arms['live-frozen']).toMatchObject({
      arm: 'live-frozen',
      serve: {
        served: 1,
        filtered: 0,
        fallback: 2,
        notServed: 2,
        decisions: { 'no-snapshot': 2, use: 1 },
        fallbackReasons: { 'no-memory-pointers': 2 },
      },
      usefulAnchorPrecision: { numerator: 2, denominator: 3, value: 0.6667 },
      answerCoverage: { numerator: 1, denominator: 1, value: 1 },
      falseDisplay: { numerator: 0, denominator: 2, value: 0 },
      legitimateSuppression: { numerator: 0, denominator: 0, value: null },
      neighborPrecision: { numerator: 0, denominator: 4, value: 0 },
      t1Repeat: { numerator: 0, denominator: 0, value: null },
      falseDisplayIds: [],
      measuredCases: 3,
      unmeasuredCases: 0,
    });

    // topic-facet: the process-note noise q15k2p is dropped from both negatives,
    // two same-domain noise anchors remain, and one case falls back.
    expect(summary.arms['topic-facet']).toMatchObject({
      arm: 'topic-facet',
      serve: { served: 3, filtered: 2, fallback: 0, notServed: 0, decisions: { use: 3 } },
      usefulAnchorPrecision: { numerator: 2, denominator: 6, value: 0.3333 },
      answerCoverage: { numerator: 1, denominator: 1, value: 1 },
      falseDisplay: { numerator: 2, denominator: 2, value: 1 },
      legitimateSuppression: { numerator: 0, denominator: 2, value: 0 },
      neighborPrecision: { numerator: 0, denominator: 2, value: 0 },
      t1Repeat: { numerator: 3, denominator: 3, value: 1 },
      falseDisplayIds: ['7lsgaw', '7lsgaw', 'cifyzn'],
      measuredCases: 3,
      unmeasuredCases: 0,
    });
  });

  test('the per-case pilot evidence is asserted literally', () => {
    const { cases } = readBaseline();
    expect(cases.map((entry) => entry.id)).toEqual([
      'quality-negative-2026-11-19',
      'research-negative-2026-11-19',
      'model-preference-live-2026-11-19',
    ]);

    const [quality, research, preference] = cases;

    // The two real negatives: the snapshot path still displays their noise.
    expect(quality.arms['snapshot-current'].kept.anchors).toEqual(['q15k2p', '7lsgaw']);
    expect(quality.arms['snapshot-current'].metrics.falseDisplay).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
    expect(research.arms['snapshot-current'].kept.anchors).toEqual(['q15k2p', '7lsgaw', 'cifyzn']);
    expect(research.arms['snapshot-current'].kept.filtered).toBe(true);

    // The off arm serves the stored blocks verbatim (no filtering, more lines).
    expect(quality.arms['current-query-off'].kept.filtered).toBe(false);
    expect(research.arms['current-query-off'].kept.anchors).toEqual([
      'q15k2p',
      '7lsgaw',
      'cifyzn',
      'o4tutz',
    ]);
    expect(research.arms['current-query-off'].kept.t1).toEqual([
      't1t_600a545d-a44d-4210-8ba5-6306b6c4d997',
    ]);

    // The live captures: no pointer at all on the negatives, a real block on the
    // mixed case (3 anchors, 4 neighbours, no T1).
    for (const control of [quality, research]) {
      const live = control.arms['live-frozen'];
      expect(live.served).toBe(false);
      expect(live.decision).toBe('no-snapshot');
      expect(live.fallbackReason).toBe('no-memory-pointers');
      expect(live.servedBlock).toBeNull();
    }
    expect(preference.arms['live-frozen']).toMatchObject({
      served: true,
      decision: 'use',
      blockSource: 'live-capture',
      kept: {
        anchors: ['cc1urw', 'kothi1', 'nzi4oy'],
        neighbors: ['s4bnsz', 'gpesz7', '148zik', '3ipzxz'],
        t1: [],
        filtered: false,
      },
    });

    // The facet arm drops exactly one noise anchor per negative and keeps the
    // third case on the current adapter (stale topic -> low containment).
    expect(quality.arms['topic-facet']).toMatchObject({
      served: true,
      blockSource: 'facet-render',
      facetFallback: null,
      kept: { anchors: ['7lsgaw'], neighbors: [], t1: [], filtered: false },
    });
    expect(research.arms['topic-facet']).toMatchObject({
      served: true,
      blockSource: 'facet-render',
      facetFallback: null,
      kept: { anchors: ['7lsgaw', 'cifyzn'], neighbors: [], t1: [], filtered: true },
    });
    expect(preference.arms['topic-facet']).toMatchObject({
      served: true,
      blockSource: 'adapter',
      facetFallback: 'low-containment',
      kept: {
        anchors: ['mem_1795064682252_yvk0df', 'mem_1795014293850_nzi4oy', 'mem_1791169315762_xqjlsn'],
        neighbors: ['mem_1795064666806_rqgqkh', 'mem_1791169320089_ls3vcr'],
        filtered: true,
      },
    });
  });

  test('the frozen TopicState audit numbers are asserted literally', () => {
    const audit = readBaseline().summary.topicAudit;

    expect(audit.casesWithTopic).toBe(3);
    expect(audit.facetsApplied).toBe(2);
    expect(audit.facetFallbacks).toEqual({ 'low-containment': 1 });
    expect(audit.staleRisk.map((entry) => entry.caseId)).toEqual([
      'quality-negative-2026-11-19',
      'research-negative-2026-11-19',
      'model-preference-live-2026-11-19',
    ]);
    for (const entry of audit.staleRisk) {
      // The stale-risk verdict is frozen data, not re-derived from text.
      expect(entry.reasons).toHaveLength(3);
      expect(entry.reasons.join('\n')).toContain('implicit 2/10');
      expect(entry.reasons.join('\n')).toContain('2026-11-18T10:05:23.261Z');
    }

    // The corpus-level audit metadata travels with the frozen fixture file.
    expect(readBaseline().fixture.topicAudit).toMatchObject({
      total: 9,
      active: 5,
      fieldCoverage: {
        summary: '4/5',
        entities: '4/5',
        aliases: '0/5',
        openLoops: '4/5',
        retrievalKeys: '4/5',
      },
    });
  });
});

describe('session recall shadow runner — stale baselines fail', () => {
  test('a baseline from different code (fingerprint) fails', () => {
    const stale = copyBaseline();
    // A baseline produced by other code has both a different per-file hash and a
    // different manifest digest.
    stale.codeFingerprint = {
      ...stale.codeFingerprint,
      digest: 'e'.repeat(64),
      files: stale.codeFingerprint.files.map((file, index) => (
        index === 0 ? { ...file, sha256: 'f'.repeat(64) } : file
      )),
    };

    const paths = mismatchPaths(stale);
    expect(paths).toContain('codeFingerprint.files[0].sha256');
    expect(paths).toContain('codeFingerprint.digest');
    expect(() => assertShadowBaselineConsistent(stale, rerun(stale))).toThrow(/codeFingerprint/);
  });

  test('a baseline from a different serve config fails', () => {
    const stale = copyBaseline();
    stale.snapshotConfig = { ...stale.snapshotConfig, ttlMs: 1 };

    // A re-run uses the fixture's frozen config, so a baseline claiming another
    // config is stale on the config field itself — even before numbers move.
    expect(mismatchPaths(stale)).toEqual(['snapshotConfig.ttlMs']);

    let error: unknown;
    try {
      assertShadowBaselineConsistent(stale, rerun(stale));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/snapshotConfig\.ttlMs/);
    expect((error as Error).message).toMatch(/session-recall\/run-shadow\.ts/);
    expect((error as Error).message).toMatch(/STALE/);
  });

  test('a baseline whose measured numbers moved fails', () => {
    const stale = copyBaseline();
    stale.summary.arms['topic-facet'].usefulAnchorPrecision = {
      numerator: 3,
      denominator: 6,
      value: 0.5,
    };

    expect(mismatchPaths(stale)).toEqual([
      'summary.arms.topic-facet.usefulAnchorPrecision.numerator',
      'summary.arms.topic-facet.usefulAnchorPrecision.value',
    ]);
    expect(() => assertShadowBaselineConsistent(stale, rerun(stale))).toThrow(
      /summary\.arms\.topic-facet\.usefulAnchorPrecision/,
    );
  });

  test('a baseline with a different case set fails', () => {
    const stale = copyBaseline();
    stale.cases = stale.cases.slice(0, 2);

    const paths = mismatchPaths(stale);
    expect(paths).toContain('cases.length');
    expect(() => assertShadowBaselineConsistent(stale, rerun(stale))).toThrow(/cases/);
  });

  test('the comparison ignores invocation-only fields (command, generatedAt)', () => {
    const baseline = copyBaseline();
    const report = rerun(baseline);
    const relocated: ShadowBaselineReport = {
      ...report,
      command: `${report.command} --out C:/tmp/elsewhere.json`,
      generatedAt: '2030-01-01T00:00:00.000Z',
    };

    // `command`/`generatedAt` describe the invocation, not the measurement: a
    // report regenerated elsewhere is still the same measurement.
    expect(diffShadowBaseline(baseline, relocated)).toEqual([]);
  });
});

describe('session recall shadow runner — top-level field guard', () => {
  test('every top-level field is classified, so a future field cannot bypass the gate', () => {
    expect([...SHADOW_BASELINE_COMPARED_FIELDS]).toEqual([
      'evaluator',
      'arms',
      'codeFingerprint',
      'configSource',
      'snapshotConfig',
      'fixture',
      'summary',
      'cases',
    ]);
    expect([...SHADOW_BASELINE_FLAG_FIELDS]).toEqual(['bootstrap', 'notAPublicBenchmark']);
    expect([...SHADOW_BASELINE_UNCOMPARED_FIELDS]).toEqual(['command', 'generatedAt']);

    // The three buckets are disjoint and cover the report exactly (12 keys).
    const known = [...SHADOW_BASELINE_KNOWN_FIELDS];
    expect(known).toHaveLength(12);
    expect(new Set(known).size).toBe(known.length);
    expect([...known].sort()).toEqual(Object.keys(readBaseline()).sort());
  });

  test('a fresh report carrying an unknown top-level field fails', () => {
    const baseline = readBaseline();
    const report = rerun(baseline) as ShadowBaselineReport & { extraMetric: number };
    report.extraMetric = 1;

    const paths = diffShadowBaseline(baseline, report).map((mismatch) => mismatch.path);
    expect(paths).toContain('unknownField.extraMetric');
    expect(() => assertShadowBaselineConsistent(baseline, report)).toThrow(
      /unknownField\.extraMetric/,
    );
  });

  test('a baseline carrying an unknown top-level field fails', () => {
    const stale = copyBaseline() as ShadowBaselineReport & { legacyMetric: number };
    stale.legacyMetric = 3;

    expect(mismatchPaths(stale)).toContain('unknownField.legacyMetric');
    expect(() => assertShadowBaselineConsistent(stale, rerun(stale))).toThrow(
      /unknownField\.legacyMetric/,
    );
  });

  test('the bootstrap flags are compared, not assumed', () => {
    const baseline = readBaseline();
    const flags: Array<[keyof Pick<ShadowBaselineReport, 'bootstrap' | 'notAPublicBenchmark'>, boolean]> = [
      ['bootstrap', false],
      ['notAPublicBenchmark', false],
    ];

    for (const [field, value] of flags) {
      const report: ShadowBaselineReport = { ...rerun(baseline), [field]: value };
      expect(diffShadowBaseline(baseline, report).map((mismatch) => mismatch.path)).toContain(field);
      expect(() => assertShadowBaselineConsistent(baseline, report)).toThrow(new RegExp(field));
    }
  });
});

describe('session recall shadow runner — the gate measures, it does not echo', () => {
  test('an explicit config override changes the decision', () => {
    const baseline = readBaseline();
    const report = runShadowEvaluation(
      loadShadowFixtureFile(FIXTURES),
      FIXTURE_REPORT_PATH,
      baseline.generatedAt,
      { command: baseline.command, snapshotConfig: { ttlMs: 1 }, configSource: 'override' },
    );

    expect(report.configSource).toBe('override');
    expect(report.snapshotConfig.ttlMs).toBe(1);
    // Every frozen `now` is later than its snapshot build by more than 1 ms, so
    // the real decideSnapshotUse goes stale on all three cases.
    for (const arm of ['snapshot-current', 'current-query-off', 'topic-facet'] as const) {
      expect(report.summary.arms[arm].serve.notServed).toBe(3);
      expect(report.summary.arms[arm].serve.decisions).toEqual({ stale: 3 });
      expect(report.summary.arms[arm].usefulAnchorPrecision).toEqual({
        numerator: 0,
        denominator: 0,
        value: null,
      });
    }
    // The frozen live capture has no snapshot decision, so it is unaffected.
    expect(report.summary.arms['live-frozen'].usefulAnchorPrecision).toEqual({
      numerator: 2,
      denominator: 3,
      value: 0.6667,
    });

    const paths = diffShadowBaseline(baseline, report);
    expect(paths.map((mismatch) => mismatch.path)).toContain('configSource');
    expect(paths.map((mismatch) => mismatch.path)).toContain('snapshotConfig.ttlMs');
    // The config that produced the numbers moved, so the numbers are named too.
    expect(paths.map((mismatch) => mismatch.path)).toContain(
      'summary.arms.snapshot-current.serve.notServed',
    );
    expect(paths.map((mismatch) => mismatch.path)).toContain(
      'summary.arms.snapshot-current.serve.decisions.stale',
    );
    expect(report.summary).not.toEqual(baseline.summary);
  });
});
