/**
 * Session-shaped recall quality evaluator (P0 bootstrap).
 *
 * The evaluator must measure what the SERVE path actually rendered, using the
 * real `decideSnapshotUse` + `adaptSnapshotToCurrentQuery` functions — not a
 * copy of their admission rules. Metrics are block-level, annotation-driven:
 *
 *   - usefulAnchorPrecision: displayed anchors labelled answer|context / anchors
 *   - answerCoverage:        expected answer families covered by a displayed
 *                            ANCHOR (neighbour-only never counts)
 *   - falseDisplay:          no-answer controls that displayed a noise body
 *   - legitimateSuppression: pre-admission answer|context candidates dropped
 *                            (pool misses are not suppression)
 *
 * Zero denominators are `null`, never 100%.
 */
import type { RecallSnapshot } from '../../../src/recall/recall-snapshot';
import {
  evaluateSessionSnapshotFixture,
  summarizeSessionSnapshotQuality,
  validateSessionSnapshotQualityFixture,
  type SessionSnapshotQualityFixture,
} from '../../../src/recall/session-quality';

const NOW = '2026-11-19T09:30:10.000Z';
const BUILT_AT = '2026-11-19T09:30:00.000Z';

const STALE_NOW = '2026-11-19T10:30:10.000Z';

type SnapshotMemory = NonNullable<RecallSnapshot['memories']>[number];

/** Full ids whose last 6 chars are the pointer tail used by the renderer. */
const id = (tail: string): string => `mem_1750000000000_${tail}`;

function mem(tail: string, abstraction: string, extra: Partial<SnapshotMemory> = {}): SnapshotMemory {
  return {
    id: id(tail),
    type: 'semantic',
    abstraction,
    date: '2026-11-19T09:00:00.000Z',
    energy: 0.8,
    cue_anchors: [],
    ...extra,
  };
}

const anchorLine = (tail: string, text: string): string => `- #mem-${tail} "${text}" (E:0.8)`;
const neighborLine = (tail: string, text: string): string => `  ↳ - #mem-${tail} "${text}" (E:0.8)`;

function block(lines: string[]): string {
  return `<recall>\n[联想线索 · 依据前请验证：取全文 → mafw_get_memory("#mem-后6位")]\n${lines.join('\n')}\n</recall>`;
}

/** Mixed anchors: one answers, one is topically supported noise. */
function mixedFixture(): SessionSnapshotQualityFixture {
  return {
    id: 'mixed-anchor-noise',
    origin: 'unit',
    currentQuery: 'alpha beta',
    now: NOW,
    isNoAnswerControl: false,
    snapshot: {
      query: 'alpha beta',
      block: block([
        anchorLine('alpha1', 'alpha deployment rule'),
        anchorLine('noise1', 'beta unrelated note'),
      ]),
      ids: [id('alpha1'), id('noise1')],
      builtAt: BUILT_AT,
      fokStatus: 'inject',
      top1prob: 0.91,
      memories: [mem('alpha1', 'alpha deployment rule'), mem('noise1', 'beta unrelated note')],
      t1Hits: [],
      t1Rendered: false,
    },
    annotations: [
      { id: id('alpha1'), role: 'anchor', label: 'answer' },
      { id: id('noise1'), role: 'anchor', label: 'noise' },
    ],
    expectedAnswerFamilies: [
      { id: 'alpha-rule', statement: 'alpha deployment rule', equivalentIds: [id('alpha1')] },
    ],
  };
}

/**
 * The real 2026-11-19 user-reported mis-display: 「现在记忆系统质量和效率」
 * served a delivery-process reminder and a "research first" workflow note.
 * The ids are the seed's 6-char pointer tails (the full ids were not captured);
 * they are used verbatim, not re-derived.
 */
function realNegativeFixture(): SessionSnapshotQualityFixture {
  return {
    id: 'quality-negative-2026-11-19',
    origin: 'seed:qualityNegative',
    currentQuery: '现在记忆系统质量和效率',
    now: '2026-11-19T08:22:30.000Z',
    isNoAnswerControl: true,
    snapshot: {
      query: '现在记忆系统质量和效率',
      block: block([
        anchorLine('q15k2p', '功能完成并通过review后先提交再总结；验证摘要按新增测试数/总通过数汇报'),
        anchorLine('7lsgaw', 'MAFW提升记忆质量与检索效率时先调研再差距分析后动手'),
      ]),
      ids: ['q15k2p', '7lsgaw'],
      builtAt: '2026-11-19T08:22:16.515Z',
      fokStatus: 'inject',
      top1prob: 0.99,
      memories: [
        {
          id: 'q15k2p',
          type: 'procedural',
          abstraction: '功能完成并通过review后先提交再总结；验证摘要按新增测试数/总通过数汇报',
          date: '2026-11-11',
          cue_anchors: ['质量', '交付'],
        },
        {
          id: '7lsgaw',
          type: 'procedural',
          abstraction: 'MAFW提升记忆质量与检索效率时先调研再差距分析后动手',
          date: '2026-11-11',
          cue_anchors: ['记忆质量', '检索效率'],
        },
      ],
      t1Hits: [],
      t1Rendered: false,
    },
    annotations: [
      { id: 'q15k2p', role: 'anchor', label: 'noise' },
      { id: '7lsgaw', role: 'anchor', label: 'noise' },
    ],
    expectedAnswerFamilies: [],
  };
}

/** Two legitimately answerable candidates are dropped by the lexical gate. */
function suppressionFixture(): SessionSnapshotQualityFixture {
  return {
    id: 'legit-suppression',
    origin: 'unit',
    currentQuery: 'recall latency',
    now: NOW,
    isNoAnswerControl: false,
    snapshot: {
      query: 'recall latency',
      block: block([anchorLine('keep01', 'recall latency budget')]),
      ids: [id('keep01'), id('keep02'), id('dropa1'), id('dropc1')],
      builtAt: BUILT_AT,
      fokStatus: 'inject',
      top1prob: 0.86,
      memories: [
        mem('keep01', 'recall latency budget'),
        mem('keep02', 'latency dashboard'),
        mem('dropa1', 'unrelated zeta'),
        mem('dropc1', 'context gamma'),
      ],
      t1Hits: [],
      t1Rendered: false,
    },
    annotations: [
      { id: id('keep01'), role: 'anchor', label: 'answer' },
      { id: id('keep02'), role: 'anchor', label: 'context' },
      { id: id('dropa1'), role: 'anchor', label: 'answer' },
      { id: id('dropc1'), role: 'anchor', label: 'context' },
    ],
    expectedAnswerFamilies: [
      { id: 'served-answer', statement: 'recall latency budget', equivalentIds: [id('keep01')] },
      { id: 'dropped-answer', statement: 'unrelated zeta', equivalentIds: [id('dropa1')] },
    ],
  };
}

/** The expected answer is displayed only as a neighbour, never as an anchor. */
function neighborOnlyFixture(): SessionSnapshotQualityFixture {
  return {
    id: 'neighbor-only',
    origin: 'unit',
    currentQuery: 'alpha beta',
    now: NOW,
    isNoAnswerControl: false,
    snapshot: {
      query: 'alpha beta',
      block: block([
        anchorLine('anchr1', 'alpha rule'),
        anchorLine('anchr2', 'beta note'),
        neighborLine('neigh1', 'alpha evidence'),
      ]),
      ids: [id('anchr1'), id('anchr2')],
      builtAt: BUILT_AT,
      fokStatus: 'inject',
      top1prob: 0.88,
      memories: [
        mem('anchr1', 'alpha rule'),
        mem('anchr2', 'beta note'),
        mem('neigh1', 'alpha evidence', { neighborOf: id('anchr1') }),
      ],
      t1Hits: [],
      t1Rendered: false,
    },
    annotations: [
      { id: id('anchr1'), role: 'anchor', label: 'context' },
      { id: id('anchr2'), role: 'anchor', label: 'noise' },
      { id: id('neigh1'), role: 'neighbor', label: 'answer' },
    ],
    expectedAnswerFamilies: [
      { id: 'alpha-evidence', statement: 'alpha evidence', equivalentIds: [id('neigh1')] },
    ],
  };
}

/**
 * A re-rendered (filtered) serve that carries one T1 line: the render budget
 * only applies on the filtered path (`serveVerbatim` keeps the stored block).
 */
function t1BudgetFixture(): SessionSnapshotQualityFixture {
  return {
    id: 't1-budget',
    origin: 'unit',
    currentQuery: 'alpha beta',
    now: NOW,
    isNoAnswerControl: false,
    snapshot: {
      query: 'alpha beta',
      block: block([anchorLine('ans01', 'alpha answer')]),
      ids: [id('ans01'), id('noise1'), id('drop01')],
      builtAt: BUILT_AT,
      fokStatus: 'inject',
      top1prob: 0.9,
      memories: [
        mem('ans01', 'alpha answer'),
        mem('noise1', 'beta note'),
        mem('drop01', 'unrelated zeta'),
      ],
      t1Hits: [
        {
          sessionId: 's1',
          turnId: 9,
          traceId: 't1t_alpha',
          cosine: 0.9,
          excerpt: `alpha evidence ${'x'.repeat(80)}`,
        },
      ],
      t1Rendered: true,
    },
    annotations: [
      { id: id('ans01'), role: 'anchor', label: 'answer' },
      { id: id('noise1'), role: 'anchor', label: 'noise' },
      { id: id('drop01'), role: 'anchor', label: 'noise' },
      { id: 't1t_alpha', role: 't1', label: 'repeat' },
    ],
    expectedAnswerFamilies: [
      { id: 'alpha-answer', statement: 'alpha answer', equivalentIds: [id('ans01')] },
    ],
  };
}

describe('evaluateSessionSnapshotFixture — displayed block metrics', () => {
  test('a supported answer anchor plus a supported noise anchor reports honest precision/coverage', () => {
    const result = evaluateSessionSnapshotFixture(mixedFixture());

    expect(result.decision).toBe('use');
    expect(result.served).toBe(true);
    expect(result.fallbackReason).toBeNull();
    expect(result.kept.anchors).toEqual([id('alpha1'), id('noise1')]);
    expect(result.kept.filtered).toBe(false);

    expect(result.displayed).toEqual([
      { id: id('alpha1'), role: 'anchor', label: 'answer' },
      { id: id('noise1'), role: 'anchor', label: 'noise' },
    ]);

    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.metrics.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(result.metrics.neighborPrecision).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(result.metrics.t1Repeat).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(result.metrics.falseDisplay).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  test('a no-answer control that still serves its noise anchors reports false display', () => {
    const result = evaluateSessionSnapshotFixture(realNegativeFixture());

    expect(result.decision).toBe('use');
    expect(result.served).toBe(true);
    expect(result.isNoAnswerControl).toBe(true);

    // Honest baseline: the real 2026-11-19 mis-display is still displayed.
    expect(result.metrics.falseDisplay).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.falseDisplayIds).toEqual(['q15k2p', '7lsgaw']);
    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 0, denominator: 2, value: 0 });
    // No answer family exists in this pool: 0/0 is null, not 100%.
    expect(result.metrics.answerCoverage).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  test('legitimately answerable answer/context candidates dropped by admission are suppression', () => {
    const result = evaluateSessionSnapshotFixture(suppressionFixture());

    expect(result.served).toBe(true);
    expect(result.kept.filtered).toBe(true);
    expect(result.kept.anchors).toEqual([id('keep01'), id('keep02')]);
    expect(result.displayed.map((entry) => entry.id)).toEqual([id('keep01'), id('keep02')]);

    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 2, denominator: 2, value: 1 });
    // keep01 (displayed) covers `served-answer`; dropa1 (dropped) does not.
    expect(result.metrics.answerCoverage).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 2, denominator: 4, value: 0.5 });
    expect(result.suppressed).toEqual([
      { id: id('dropa1'), label: 'answer' },
      { id: id('dropc1'), label: 'context' },
    ]);
  });

  test('an answer shown only as a neighbour does not satisfy answer coverage', () => {
    const result = evaluateSessionSnapshotFixture(neighborOnlyFixture());

    expect(result.served).toBe(true);
    expect(result.displayed).toEqual([
      { id: id('anchr1'), role: 'anchor', label: 'context' },
      { id: id('anchr2'), role: 'anchor', label: 'noise' },
      { id: id('neigh1'), role: 'neighbor', label: 'answer' },
    ]);
    // Displayed everywhere, but never as an anchor.
    expect(result.metrics.answerCoverage).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(result.metrics.neighborPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    // A neighbour still counts as shown: it was not suppressed.
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 0, denominator: 2, value: 0 });
  });

  test('an anchor line carrying a gist hint stays an anchor (label still applies)', () => {
    const fixture = mixedFixture();
    fixture.snapshot.block = block([
      `${anchorLine('alpha1', 'alpha deployment rule')} ↳ gist 已蒸馏（get_memory 可取）：xyz789`,
      anchorLine('noise1', 'beta unrelated note'),
    ]);

    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.displayed).toEqual([
      { id: id('alpha1'), role: 'anchor', label: 'answer' },
      { id: id('noise1'), role: 'anchor', label: 'noise' },
    ]);
    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(result.metrics.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.unannotatedDisplayed).toEqual([]);
    expect(result.measurementComplete).toBe(true);
  });

  test('a displayed pointer outside the pool is surfaced instead of silently ignored', () => {
    const fixture = realNegativeFixture();
    fixture.snapshot.block = block([
      anchorLine('q15k2p', '功能完成并通过review后先提交再总结'),
      anchorLine('ghost1', 'pointer that has no annotation'),
    ]);

    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.served).toBe(true);
    expect(result.unannotatedDisplayed).toEqual([{ id: 'ghost1', role: 'anchor' }]);
    expect(result.measurementComplete).toBe(false);
    // The unknown pointer is NOT reclassified as noise; only the frozen label counts.
    expect(result.falseDisplayIds).toEqual(['q15k2p']);
    expect(result.metrics.falseDisplay).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 0, denominator: 2, value: 0 });

    const summary = summarizeSessionSnapshotQuality([result]);
    expect(summary.measurementComplete).toBe(false);
    expect(summary.unannotatedDisplayed).toEqual([
      { caseId: 'quality-negative-2026-11-19', id: 'ghost1', role: 'anchor' },
    ]);
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain('ghost1');
    expect(summary.warnings[0]).toContain('falseDisplay');
  });
});

describe('evaluateSessionSnapshotFixture — zero denominators and admission fallbacks', () => {
  test('a case with nothing displayed reports null (never 100%) with explicit 0/0', () => {
    const fixture: SessionSnapshotQualityFixture = {
      id: 'nothing-displayed',
      origin: 'unit',
      currentQuery: '??',
      now: NOW,
      isNoAnswerControl: false,
      snapshot: {
        query: 'alpha beta',
        block: block([anchorLine('noise1', 'beta unrelated note')]),
        ids: [id('noise1')],
        builtAt: BUILT_AT,
        fokStatus: 'inject',
        top1prob: 0.5,
        memories: [mem('noise1', 'beta unrelated note')],
        t1Hits: [],
        t1Rendered: false,
      },
      annotations: [{ id: id('noise1'), role: 'anchor', label: 'noise' }],
      expectedAnswerFamilies: [],
    };

    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.served).toBe(false);
    expect(result.decision).toBe('topic-shift');
    for (const key of [
      'usefulAnchorPrecision',
      'answerCoverage',
      'falseDisplay',
      'legitimateSuppression',
      'neighborPrecision',
      't1Repeat',
    ] as const) {
      expect(result.metrics[key]).toEqual({ numerator: 0, denominator: 0, value: null });
    }
  });

  test('stale snapshot → not served, answer family honestly uncovered', () => {
    const fixture = mixedFixture();
    fixture.now = STALE_NOW;
    const result = evaluateSessionSnapshotFixture(fixture);

    expect(result.decision).toBe('stale');
    expect(result.served).toBe(false);
    expect(result.fallbackReason).toBe('stale');
    expect(result.displayed).toEqual([]);
    expect(result.metrics.usefulAnchorPrecision).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(result.metrics.answerCoverage).toEqual({ numerator: 0, denominator: 1, value: 0 });
    // Nothing was served: an admission fallback is not evidence of a wrongly
    // suppressed candidate, so suppression is not measured (0/0 → null).
    expect(result.suppressed).toEqual([]);
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(result.measurementComplete).toBe(true);

    const summary = summarizeSessionSnapshotQuality([result]);
    expect(summary.serve.served).toBe(0);
    expect(summary.serve.notServed).toBe(1);
    expect(summary.legitimateSuppression).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  test('topic-shift → not served', () => {
    const fixture = mixedFixture();
    fixture.currentQuery = 'completely different topic';
    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.decision).toBe('topic-shift');
    expect(result.served).toBe(false);
    expect(result.fallbackReason).toBe('topic-shift');
  });

  test('the real adapter fallback (no current support) is reported, not bypassed', () => {
    const fixture = mixedFixture();
    fixture.currentQuery = 'alpha beta';
    fixture.snapshot.query = 'alpha beta gamma';
    fixture.snapshot.memories = [mem('unrel1', 'unrelated zeta')];
    fixture.snapshot.ids = [id('unrel1')];
    fixture.snapshot.block = block([anchorLine('unrel1', 'unrelated zeta')]);
    fixture.annotations = [{ id: id('unrel1'), role: 'anchor', label: 'answer' }];
    fixture.expectedAnswerFamilies = [
      { id: 'unrel', statement: 'unrelated zeta', equivalentIds: [id('unrel1')] },
    ];

    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.decision).toBe('use');
    expect(result.served).toBe(false);
    expect(result.fallbackReason).toBe('no-current-support');
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 0, denominator: 0, value: null });
  });

  test('a low-confidence FOK snapshot is not served (route parity)', () => {
    const fixture = mixedFixture();
    fixture.snapshot.fokStatus = 'low-confidence';
    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.decision).toBe('use');
    expect(result.served).toBe(false);
    expect(result.fallbackReason).toBe('fok');
    expect(result.metrics.legitimateSuppression).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});

describe('evaluateSessionSnapshotFixture — production snapshot config', () => {
  test('a custom TTL drives the stale decision', () => {
    const fixture = mixedFixture(); // now is builtAt + 10s
    const strict = evaluateSessionSnapshotFixture(fixture, { snapshotConfig: { ttlMs: 5_000 } });
    expect(strict.decision).toBe('stale');
    expect(strict.served).toBe(false);

    const relaxed = evaluateSessionSnapshotFixture(fixture, { snapshotConfig: { ttlMs: 60_000 } });
    expect(relaxed.decision).toBe('use');
    expect(relaxed.served).toBe(true);
  });

  test('a custom topic-shift threshold drives the decision', () => {
    const fixture = mixedFixture();
    fixture.snapshot.query = 'alpha gamma';
    fixture.currentQuery = 'alpha beta'; // containment 1/2 = 0.5

    expect(
      evaluateSessionSnapshotFixture(fixture, { snapshotConfig: { topicShiftThreshold: 0.75 } }).decision,
    ).toBe('topic-shift');
    expect(
      evaluateSessionSnapshotFixture(fixture, { snapshotConfig: { topicShiftThreshold: 0.4 } }).decision,
    ).toBe('use');
  });

  test('a custom T1 budget changes the rendered line while the annotation still applies', () => {
    const fixture = t1BudgetFixture();
    const full = evaluateSessionSnapshotFixture(fixture);
    const short = evaluateSessionSnapshotFixture(fixture, { snapshotConfig: { t1MaxChars: 40 } });

    expect(full.served).toBe(true);
    expect(short.served).toBe(true);
    expect(full.kept.t1).toEqual(['t1t_alpha']);
    expect(short.kept.t1).toEqual(['t1t_alpha']);
    expect(short.servedBlock).not.toBeNull();
    expect(full.servedBlock).not.toBeNull();
    expect(short.servedBlock!.length).toBeLessThan(full.servedBlock!.length);
    expect(short.displayed).toContainEqual({ id: 't1t_alpha', role: 't1', label: 'repeat' });
    expect(short.metrics.t1Repeat).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(short.measurementComplete).toBe(true);
  });
});

describe('evaluateSessionSnapshotFixture — immutable input', () => {
  test('a deeply frozen fixture is evaluated without mutation', () => {
    const fixture = mixedFixture();
    const before = JSON.stringify(fixture);
    const deepFreeze = <T,>(value: T): T => {
      if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
      }
      return value;
    };
    deepFreeze(fixture);

    const result = evaluateSessionSnapshotFixture(fixture);
    expect(result.metrics.answerCoverage.value).toBe(1);
    expect(JSON.stringify(fixture)).toBe(before);
  });
});

describe('validateSessionSnapshotQualityFixture', () => {
  test('a well-formed fixture validates', () => {
    expect(validateSessionSnapshotQualityFixture(mixedFixture())).toBe(true);
  });

  test('an annotation without an id is rejected', () => {
    const fixture = mixedFixture();
    (fixture.annotations[0] as unknown as Record<string, unknown>).id = '';
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/missing a non-empty id/);
  });

  test('an annotation id absent from the snapshot pool is rejected', () => {
    const fixture = mixedFixture();
    fixture.annotations[0].id = id('ghost1');
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/unknown annotation id/);
  });

  test('a duplicate annotation role is rejected', () => {
    const fixture = mixedFixture();
    fixture.annotations.push({ id: id('alpha1'), role: 'anchor', label: 'answer' });
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/duplicate annotation role/);
  });

  test('a pool entry without an annotation is rejected', () => {
    const fixture = mixedFixture();
    fixture.annotations = fixture.annotations.filter((entry) => entry.id !== id('noise1'));
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/missing annotation for anchor/);
  });

  test('a t1 hit without an annotation is rejected', () => {
    const fixture = mixedFixture();
    fixture.snapshot.t1Hits = [
      { sessionId: 's1', turnId: 7, traceId: 't1t_abc', cosine: 0.9, excerpt: 'alpha excerpt' },
    ];
    fixture.snapshot.t1Rendered = true;
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/missing annotation for t1 t1t_abc/);
  });

  test('an unknown label is rejected', () => {
    const fixture = mixedFixture();
    (fixture.annotations[0] as unknown as Record<string, unknown>).label = 'answer-ish';
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/unknown annotation label/);
  });

  test('an annotation role that contradicts the snapshot structure is rejected', () => {
    const fixture = mixedFixture();
    fixture.annotations[1] = { id: id('noise1'), role: 'neighbor', label: 'noise' };
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/role mismatch/);
  });

  test('an answerable case whose answer annotation has no expected answer family is rejected', () => {
    const fixture = mixedFixture();
    fixture.expectedAnswerFamilies = [];
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/not in any expected answer family/);
  });

  test('an answer annotation outside every family equivalentIds is rejected', () => {
    const fixture = mixedFixture();
    fixture.expectedAnswerFamilies = [
      { id: 'other', statement: 'something else', equivalentIds: [id('noise1')] },
    ];
    expect(() => validateSessionSnapshotQualityFixture(fixture)).toThrow(/not in any expected answer family/);
  });

  test('answer annotations may be covered by different families', () => {
    const fixture = mixedFixture();
    fixture.annotations[1].label = 'answer';
    fixture.expectedAnswerFamilies.push({
      id: 'beta-note',
      statement: 'beta note',
      equivalentIds: [id('noise1')],
    });
    expect(validateSessionSnapshotQualityFixture(fixture)).toBe(true);
  });

  test('a no-answer control may not annotate an answer or declare answer families', () => {
    const withAnswer = realNegativeFixture();
    withAnswer.annotations[0].label = 'answer';
    expect(() => validateSessionSnapshotQualityFixture(withAnswer)).toThrow(/no-answer control/);

    const withFamily = realNegativeFixture();
    withFamily.expectedAnswerFamilies = [
      { id: 'f', statement: 'statement', equivalentIds: ['q15k2p'] },
    ];
    expect(() => validateSessionSnapshotQualityFixture(withFamily)).toThrow(/no-answer control/);
  });
});

describe('summarizeSessionSnapshotQuality', () => {
  test('aggregates numerators/denominators and keeps per-case results', () => {
    const results = [
      evaluateSessionSnapshotFixture(mixedFixture()),
      evaluateSessionSnapshotFixture(realNegativeFixture()),
      evaluateSessionSnapshotFixture(neighborOnlyFixture()),
    ];
    const summary = summarizeSessionSnapshotQuality(results);

    expect(summary.cases).toBe(3);
    expect(summary.answerableCases).toBe(2);
    expect(summary.noAnswerControls).toBe(1);
    expect(summary.serve).toEqual({
      served: 3,
      filtered: 0,
      fallback: 0,
      notServed: 0,
      decisions: { use: 3 },
      fallbackReasons: {},
    });
    expect(summary.measurementComplete).toBe(true);
    expect(summary.unannotatedDisplayed).toEqual([]);
    expect(summary.warnings).toEqual([]);
    expect(summary.usefulAnchorPrecision).toEqual({ numerator: 2, denominator: 6, value: 0.3333 });
    expect(summary.answerCoverage).toEqual({ numerator: 1, denominator: 2, value: 0.5 });
    expect(summary.falseDisplay).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(summary.legitimateSuppression).toEqual({ numerator: 0, denominator: 3, value: 0 });
    expect(summary.neighborPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(summary.t1Repeat).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(summary.falseDisplayIds).toEqual(['q15k2p', '7lsgaw']);
    expect(summary.results).toHaveLength(3);
    expect(summary.results.map((entry) => entry.id)).toEqual([
      'mixed-anchor-noise',
      'quality-negative-2026-11-19',
      'neighbor-only',
    ]);
  });

  test('an empty result set reports null rates with 0/0', () => {
    const summary = summarizeSessionSnapshotQuality([]);
    expect(summary.cases).toBe(0);
    expect(summary.serve.notServed).toBe(0);
    expect(summary.measurementComplete).toBe(true);
    expect(summary.usefulAnchorPrecision).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(summary.answerCoverage).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(summary.falseDisplay).toEqual({ numerator: 0, denominator: 0, value: null });
    expect(summary.legitimateSuppression).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});
