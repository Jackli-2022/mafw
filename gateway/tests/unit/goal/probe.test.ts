import {
  DEFAULT_PROBE_LIMITS,
  PROBE_COMMAND_CLASSES,
  redactProbeReport,
  redactProbeText,
  validateProbeReport,
  validateProbeRequest,
} from '../../../src/core/goal/probe';

function baseRequest(): Record<string, any> {
  return {
    id: 'p1',
    podId: 'pod_1',
    goalId: 'g1',
    revision: 1,
    question: '  Does the metadata index support prefix search?  ',
    hypothesis: 'BM25 index is enough for the first release.',
    scope: {
      paths: ['./src', 'docs/plan.md', 'src/', 'src\\lib'],
      commandClasses: ['read', 'test', 'read'],
      network: false,
      credentials: [],
    },
    budget: { maxMinutes: 10, maxUsd: 0.5 },
    evidenceRequired: ['query timing', 'query timing'],
    affects: {
      planAssertions: ['no new index'],
      evalMethods: ['p95 < 50ms'],
      options: ['A'],
    },
  };
}

function baseReport(): Record<string, any> {
  return {
    probeId: 'p1',
    conclusion: 'supports',
    commands: ['npm test -- --runInBand'],
    keyOutput: 'p95 41ms on the sample query set',
    repro: ['npm run seed && npm test'],
    remainingAssumptions: ['production data is larger'],
    impact: { plan: 'keep BM25', goalEval: 'p95 < 50ms is achievable' },
  };
}

describe('validateProbeRequest', () => {
  test('accepts a machine-readable request and normalizes scope lists', () => {
    const request = validateProbeRequest(baseRequest());

    expect(request).toMatchObject({
      id: 'p1',
      podId: 'pod_1',
      goalId: 'g1',
      revision: 1,
      question: 'Does the metadata index support prefix search?',
      hypothesis: 'BM25 index is enough for the first release.',
      scope: {
        paths: ['src', 'docs/plan.md', 'src/lib'],
        commandClasses: ['read', 'test'],
        network: false,
        credentials: [],
      },
      budget: { maxMinutes: 10, maxUsd: 0.5 },
      evidenceRequired: ['query timing'],
      affects: {
        planAssertions: ['no new index'],
        evalMethods: ['p95 < 50ms'],
        options: ['A'],
      },
    });
  });

  test('defaults affects to an empty object when omitted', () => {
    const raw = baseRequest();
    delete raw.affects;

    expect(validateProbeRequest(raw).affects).toEqual({});
  });

  test('requires a question and a hypothesis', () => {
    const noQuestion = baseRequest();
    noQuestion.question = '   ';
    expect(() => validateProbeRequest(noQuestion)).toThrow(/question is required/);

    const noHypothesis = baseRequest();
    delete noHypothesis.hypothesis;
    expect(() => validateProbeRequest(noHypothesis)).toThrow(/hypothesis is required/);
  });

  test('requires at least one command class from the closed vocabulary', () => {
    const empty = baseRequest();
    empty.scope.commandClasses = [];
    expect(() => validateProbeRequest(empty)).toThrow(/commandClasses/);

    const unknown = baseRequest();
    unknown.scope.commandClasses = ['read', 'deploy_to_production'];
    expect(() => validateProbeRequest(unknown)).toThrow(/unknown probe command class/);

    expect(PROBE_COMMAND_CLASSES).toContain('read');
    expect(PROBE_COMMAND_CLASSES).toContain('test');
  });

  test('rejects absolute, traversing, or otherwise escaping scope paths', () => {
    const cases = ['/etc/passwd', 'C:\\Windows\\system32', '\\\\server\\share', '../outside', 'src/../../x', 'src\0evil'];
    for (const value of cases) {
      const raw = baseRequest();
      raw.scope.paths = [value];
      expect(() => validateProbeRequest(raw)).toThrow(/scope path/);
    }
  });

  test('requires network to be an explicit boolean', () => {
    const raw = baseRequest();
    raw.scope.network = 'no';
    expect(() => validateProbeRequest(raw)).toThrow(/network must be boolean/);
  });

  test('rejects wildcard or malformed credential names', () => {
    for (const value of ['*', 'bad name', 'a/b']) {
      const raw = baseRequest();
      raw.scope.credentials = [value];
      expect(() => validateProbeRequest(raw)).toThrow(/credential/);
    }

    const raw = baseRequest();
    raw.scope.credentials = ['dashscope', 'dashscope', '   '];
    expect(validateProbeRequest(raw).scope.credentials).toEqual(['dashscope']);
  });

  test('requires a positive bounded budget', () => {
    const zeroMinutes = baseRequest();
    zeroMinutes.budget = { maxMinutes: 0, maxUsd: 0 };
    expect(() => validateProbeRequest(zeroMinutes)).toThrow(/maxMinutes/);

    const negativeUsd = baseRequest();
    negativeUsd.budget = { maxMinutes: 5, maxUsd: -1 };
    expect(() => validateProbeRequest(negativeUsd)).toThrow(/maxUsd/);

    const infinite = baseRequest();
    infinite.budget = { maxMinutes: Number.POSITIVE_INFINITY, maxUsd: 0 };
    expect(() => validateProbeRequest(infinite)).toThrow(/maxMinutes/);

    const oversize = baseRequest();
    oversize.budget = { maxMinutes: DEFAULT_PROBE_LIMITS.maxMinutes + 1, maxUsd: 0 };
    expect(() => validateProbeRequest(oversize)).toThrow(/maxMinutes/);

    const overCost = baseRequest();
    overCost.budget = { maxMinutes: 1, maxUsd: DEFAULT_PROBE_LIMITS.maxUsd + 1 };
    expect(() => validateProbeRequest(overCost)).toThrow(/maxUsd/);
  });

  test('honours caller-supplied budget caps without mutating defaults', () => {
    const raw = baseRequest();
    raw.budget = { maxMinutes: 20, maxUsd: 1 };

    expect(validateProbeRequest(raw, { maxMinutes: 30, maxUsd: 2 }).budget.maxMinutes).toBe(20);
    expect(() => validateProbeRequest(raw, { maxMinutes: 10 })).toThrow(/maxMinutes/);
    expect(DEFAULT_PROBE_LIMITS.maxMinutes).toBeGreaterThanOrEqual(30);
  });

  test('requires at least one piece of evidence', () => {
    const raw = baseRequest();
    raw.evidenceRequired = [];
    expect(() => validateProbeRequest(raw)).toThrow(/evidenceRequired/);
  });

  test('rejects unknown affect keys and non-string affect items', () => {
    const unknown = baseRequest();
    unknown.affects = { planAssertions: ['x'], unrelated: ['y'] };
    expect(() => validateProbeRequest(unknown)).toThrow(/affects/);

    const badItem = baseRequest();
    badItem.affects = { evalMethods: ['ok', 42] };
    expect(() => validateProbeRequest(badItem)).toThrow(/affects/);
  });

  test('requires a positive integer revision and safe identifiers', () => {
    const revision = baseRequest();
    revision.revision = 0;
    expect(() => validateProbeRequest(revision)).toThrow(/revision/);

    const fractional = baseRequest();
    fractional.revision = 1.5;
    expect(() => validateProbeRequest(fractional)).toThrow(/revision/);

    const badId = baseRequest();
    badId.id = '../escape';
    expect(() => validateProbeRequest(badId)).toThrow(/id/);

    const badGoal = baseRequest();
    badGoal.goalId = 'g 1';
    expect(() => validateProbeRequest(badGoal)).toThrow(/goalId/);
  });
});

describe('validateProbeReport', () => {
  test('accepts a well-formed report', () => {
    expect(validateProbeReport(baseReport())).toEqual({
      probeId: 'p1',
      conclusion: 'supports',
      commands: ['npm test -- --runInBand'],
      keyOutput: 'p95 41ms on the sample query set',
      repro: ['npm run seed && npm test'],
      remainingAssumptions: ['production data is larger'],
      impact: { plan: 'keep BM25', goalEval: 'p95 < 50ms is achievable' },
    });
  });

  test('enforces the conclusion vocabulary', () => {
    const raw = baseReport();
    raw.conclusion = 'probably';
    expect(() => validateProbeReport(raw)).toThrow(/conclusion/);
  });

  test('requires key output and a probe id', () => {
    const noOutput = baseReport();
    noOutput.keyOutput = '   ';
    expect(() => validateProbeReport(noOutput)).toThrow(/keyOutput/);

    const noProbe = baseReport();
    delete noProbe.probeId;
    expect(() => validateProbeReport(noProbe)).toThrow(/probeId/);
  });

  test('rejects malformed string lists and impact fields', () => {
    const commands = baseReport();
    commands.commands = ['ok', 7];
    expect(() => validateProbeReport(commands)).toThrow(/commands/);

    const impact = baseReport();
    impact.impact = { plan: 42 };
    expect(() => validateProbeReport(impact)).toThrow(/impact/);

    const impactUnknown = baseReport();
    impactUnknown.impact = { unrelated: 'x' };
    expect(() => validateProbeReport(impactUnknown)).toThrow(/impact/);
  });

  test('normalizes absent impact and remaining assumptions', () => {
    const raw = baseReport();
    delete raw.impact;
    delete raw.remainingAssumptions;

    expect(validateProbeReport(raw)).toMatchObject({
      remainingAssumptions: [],
      impact: {},
    });
  });
});

describe('redactProbeReport', () => {
  test('redacts secret-looking output before it can be persisted', () => {
    const report = validateProbeReport({
      ...baseReport(),
      commands: ['curl -H "Authorization: Bearer abcdefghijklmnopqrst" https://example.test'],
      keyOutput: 'token sk-secret and api_key=supersecretvalue',
      repro: ['export GITHUB_TOKEN=ghp_abcdefghijklmnopqrst'],
      remainingAssumptions: ['the token sk-abcdefghijklmnop1234 still works'],
      impact: { plan: 'rotate password=hunter2hunter2' },
    });

    const redacted = redactProbeReport(report);
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain('sk-secret');
    expect(serialized).not.toContain('supersecretvalue');
    expect(serialized).not.toContain('ghp_abcdefghijklmnopqrst');
    expect(serialized).not.toContain('sk-abcdefghijklmnop1234');
    expect(serialized).not.toContain('hunter2hunter2');
    expect(redacted.conclusion).toBe('supports');
  });

  test('keeps ordinary prose intact', () => {
    const report = validateProbeReport({
      ...baseReport(),
      keyOutput: 'the token budget is 4k; the secret sauce is caching',
    });

    expect(redactProbeReport(report).keyOutput)
      .toBe('the token budget is 4k; the secret sauce is caching');
  });

  test('exposes the same redaction for free-form failure text', () => {
    const redacted = redactProbeText(
      'probe failed: token sk-secret / ghp_abcdef and api_key=supersecretvalue',
    );

    expect(redacted).not.toContain('sk-secret');
    expect(redacted).not.toContain('ghp_abcdef');
    expect(redacted).not.toContain('supersecretvalue');
    expect(redacted).toContain('[REDACTED]');
    expect(redactProbeText('timed out after 60s')).toBe('timed out after 60s');
  });
});
