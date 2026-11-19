/**
 * Session recall quality P1 shadow evaluator (four frozen arms).
 *
 * The P0 evaluator answers "what did the snapshot serve path render". The
 * shadow evaluator answers the diagnostic question "which layer produced the
 * mis-display": the real P0 serve (`snapshot-current`), the same decision with
 * the current-query adapter switched off (`current-query-off`), the live path
 * output captured separately (`live-frozen`), and one deterministic offline
 * candidate (`topic-facet`).
 *
 * Contracts pinned here:
 *
 *   - `snapshot-current` IS `evaluateSessionSnapshotFixture` — no re-scoring.
 *   - `current-query-off` keeps the real `decideSnapshotUse` + FOK gate and then
 *     serves the STORED block; it bypasses only the snapshot current-query
 *     adapter (not the live lexical veto, which this evaluator never measures).
 *   - `live-frozen` consumes a frozen capture; the runner never calls Gateway.
 *     A live capture has no pre-admission pool, so legitimate suppression is
 *     `null` (not measured), never 0%.
 *   - `topic-facet` replaces ONLY the Harmonic support selection: exact evidence
 *     bypasses, every other candidate needs BOTH domain support
 *     (entities/aliases/retrievalKeys) AND raw currentQuery support, and a
 *     neighbour still needs its anchor retained. T1 uses the unchanged adapter.
 *     No usable topic / empty domain / containment < 0.25 falls back to the
 *     current adapter.
 *   - Every arm keeps P0's per-case `displayed` / `suppressed` / `families` /
 *     measurement fields; zero denominators are `null`.
 */
import type { RecallSnapshot } from '../../../src/recall/recall-snapshot';
import {
  evaluateSessionSnapshotFixture,
  summarizeSessionSnapshotQuality,
  type ExpectedAnswerFamily,
  type SessionSnapshotAnnotation,
  type SessionSnapshotQualityFixture,
} from '../../../src/recall/session-quality';
import {
  SESSION_SHADOW_ARMS,
  evaluateSessionShadowFixture,
  summarizeSessionShadow,
  validateSessionShadowFixture,
  type SessionShadowQualityFixture,
  type SessionShadowTopicState,
} from '../../../src/recall/session-quality-shadow';

const NOW = '2026-11-19T09:30:10.000Z';
const BUILT_AT = '2026-11-19T09:30:00.000Z';

type SnapshotMemory = NonNullable<RecallSnapshot['memories']>[number];
type T1Hit = NonNullable<RecallSnapshot['t1Hits']>[number];

/** Full ids whose last 6 chars are the pointer tail the renderer prints. */
const id = (tail: string): string => `mem_1795000000000_${tail}`;
const liveId = (tail: string): string => `mem_1796000000000_${tail}`;

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
const neighborLine = (tail: string, text: string): string => `  \u21b3 - #mem-${tail} "${text}" (E:0.8)`;

function recallBlock(lines: string[]): string {
  return `<recall>\n[\u8054\u60f3\u7ebf\u7d22 \u00b7 \u4f9d\u636e\u524d\u8bf7\u9a8c\u8bc1\uff1a\u53d6\u5168\u6587 \u2192 mafw_get_memory("#mem-\u540e6\u4f4d")]\n${lines.join('\n')}\n</recall>`;
}

interface FixtureInput {
  id: string;
  query: string;
  memories: SnapshotMemory[];
  /** Rendered pointer lines of the stored snapshot block. */
  blockLines: string[];
  annotations: SessionSnapshotAnnotation[];
  families?: ExpectedAnswerFamily[];
  t1Hits?: T1Hit[];
  isNoAnswerControl?: boolean;
  liveCapture?: { capturedAt: string; block: string };
  liveAnnotations?: SessionSnapshotAnnotation[];
  liveFamilies?: ExpectedAnswerFamily[];
  topicState?: SessionShadowTopicState;
}

function makeFixture(input: FixtureInput): SessionShadowQualityFixture {
  const t1Hits = input.t1Hits ?? [];
  return {
    id: input.id,
    origin: 'unit',
    currentQuery: input.query,
    now: NOW,
    isNoAnswerControl: input.isNoAnswerControl ?? false,
    snapshot: {
      query: input.query,
      block: recallBlock(input.blockLines),
      ids: input.memories.filter((memory) => !memory.neighborOf).map((memory) => memory.id),
      builtAt: BUILT_AT,
      fokStatus: 'inject',
      top1prob: 0.9,
      memories: input.memories,
      t1Hits,
      t1Rendered: t1Hits.length > 0,
    },
    annotations: input.annotations,
    expectedAnswerFamilies: input.families ?? [],
    ...(input.liveCapture ? { liveCapture: input.liveCapture } : {}),
    ...(input.liveAnnotations ? { liveAnnotations: input.liveAnnotations } : {}),
    ...(input.liveFamilies ? { liveExpectedAnswerFamilies: input.liveFamilies } : {}),
    ...(input.topicState ? { topicState: input.topicState } : {}),
  };
}

function topic(overrides: Partial<SessionShadowTopicState> = {}): SessionShadowTopicState {
  return {
    sessionId: 'ses_unit',
    topic: 'alpha beta',
    entities: ['alpha-domain'],
    aliases: [],
    retrievalKeys: [],
    openLoops: [],
    active: true,
    revision: 1,
    updatedAt: '2026-11-18T10:05:23.261Z',
    ...overrides,
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** Strip the shadow-only fields to compare an arm against bare P0 output. */
function p0Fields(result: ReturnType<typeof evaluateSessionShadowFixture>[keyof ReturnType<
  typeof evaluateSessionShadowFixture
>]): Record<string, unknown> {
  const {
    arm: _arm,
    replay: _replay,
    blockSource: _blockSource,
    available: _available,
    facetFallback: _facetFallback,
    topicProvided: _topicProvided,
    topicStaleRisk: _topicStaleRisk,
    ...rest
  } = result;
  return rest;
}

describe('four arms', () => {
  test('a fixture evaluates to exactly the four frozen arms', () => {
    const fixture = makeFixture({
      id: 'four-arms',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(Object.keys(arms)).toEqual([...SESSION_SHADOW_ARMS]);
    for (const arm of SESSION_SHADOW_ARMS) {
      expect(arms[arm].arm).toBe(arm);
      expect(arms[arm].id).toBe('four-arms');
    }
  });

  test('snapshot-current is the real P0 evaluator, not a re-scoring', () => {
    const fixture = makeFixture({
      id: 'p0-identity',
      query: 'alpha beta',
      memories: [
        mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] }),
        mem('zeta01', 'zeta unrelated note', { cue_anchors: ['zeta'] }),
      ],
      blockLines: [
        anchorLine('alpha1', 'alpha deployment rule'),
        anchorLine('zeta01', 'zeta unrelated note'),
      ],
      annotations: [
        { id: id('alpha1'), role: 'anchor', label: 'answer' },
        { id: id('zeta01'), role: 'anchor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });

    const arms = evaluateSessionShadowFixture(fixture);
    const p0 = evaluateSessionSnapshotFixture(fixture);

    expect(p0Fields(arms['snapshot-current'])).toEqual(p0);
    expect(arms['snapshot-current'].available).toBe(true);
    expect(arms['snapshot-current'].replay).toBe(false);
    expect(arms['snapshot-current'].blockSource).toBe('adapter');
    // The P0 serve really dropped the unsupported anchor (so the identity above
    // is not vacuous).
    expect(p0.kept.filtered).toBe(true);
    expect(p0.servedBlock).not.toContain('zeta unrelated note');
  });
});

describe('current-query-off', () => {
  test('keeps the decision but serves the stored block verbatim', () => {
    const fixture = makeFixture({
      id: 'off-keeps-block',
      query: 'alpha beta',
      memories: [
        mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] }),
        mem('zeta01', 'zeta unrelated note', { cue_anchors: ['zeta'] }),
      ],
      blockLines: [
        anchorLine('alpha1', 'alpha deployment rule'),
        anchorLine('zeta01', 'zeta unrelated note'),
      ],
      annotations: [
        { id: id('alpha1'), role: 'anchor', label: 'answer' },
        { id: id('zeta01'), role: 'anchor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['current-query-off'].decision).toBe('use');
    expect(arms['current-query-off'].served).toBe(true);
    expect(arms['current-query-off'].servedBlock).toBe(fixture.snapshot.block);
    expect(arms['current-query-off'].kept.filtered).toBe(false);
    expect(arms['current-query-off'].displayed.map((entry) => entry.id)).toEqual([id('alpha1'), id('zeta01')]);
    expect(arms['current-query-off'].blockSource).toBe('stored');
    expect(arms['current-query-off'].replay).toBe(false);
    // The dropped anchor is visible again, so the arm is measuring the adapter.
    expect(arms['current-query-off'].metrics.usefulAnchorPrecision).toEqual({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
  });

  test('still respects a stale decision (decision is not bypassed)', () => {
    const fixture = makeFixture({
      id: 'off-stale',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });
    fixture.now = '2026-11-19T10:30:10.000Z'; // 1h > 10min TTL

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['current-query-off'].decision).toBe('stale');
    expect(arms['current-query-off'].served).toBe(false);
    expect(arms['current-query-off'].fallbackReason).toBe('stale');
    expect(arms['current-query-off'].servedBlock).toBeNull();
  });

  test('scores identically to the P0 arm when the adapter filters nothing', () => {
    const fixture = makeFixture({
      id: 'off-equivalence',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha beta rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha beta rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['snapshot-current'].kept.filtered).toBe(false);
    expect(p0Fields(arms['current-query-off'])).toEqual(p0Fields(arms['snapshot-current']));
  });
});

describe('live-frozen', () => {
  function liveFixture(): SessionShadowQualityFixture {
    return makeFixture({
      id: 'live-case',
      query: 'alpha beta',
      memories: [
        mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] }),
        mem('zeta01', 'zeta unrelated note', { cue_anchors: ['zeta'] }),
      ],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [
        { id: id('alpha1'), role: 'anchor', label: 'answer' },
        { id: id('zeta01'), role: 'anchor', label: 'answer' },
      ],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1'), id('zeta01')] }],
      liveCapture: {
        capturedAt: '2026-11-19T09:04:00.000Z',
        block: '<topic-recall>\n\u4e3b\u9898\uff1a\u672a\u8bbe\u7f6e\n\u76f8\u5173\u8bb0\u5fc6\uff1a\u89c1\u4e0b\u65b9\n</topic-recall>\n\n'
          + recallBlock([
            '- #mem-live01 [2026-11-19 semantic] "alpha answer body" (E:0.8)',
            neighborLine('live02', 'alpha neighbour'),
            '[t1|t1t_live] alpha echo',
          ]),
      },
      liveAnnotations: [
        { id: liveId('live01'), role: 'anchor', label: 'answer' },
        { id: liveId('live02'), role: 'neighbor', label: 'noise' },
        { id: 't1t_live', role: 't1', label: 'repeat' },
      ],
      liveFamilies: [{ id: 'live-family', statement: 'alpha answer', equivalentIds: [liveId('live01')] }],
    });
  }

  test('scores a captured live block with its own ids and annotations', () => {
    const arms = evaluateSessionShadowFixture(liveFixture());
    const live = arms['live-frozen'];

    expect(live.available).toBe(true);
    expect(live.served).toBe(true);
    expect(live.blockSource).toBe('live-capture');
    expect(live.displayed.map((entry) => [entry.id, entry.role])).toEqual([
      [liveId('live01'), 'anchor'],
      [liveId('live02'), 'neighbor'],
      ['t1t_live', 't1'],
    ]);
    expect(live.kept).toEqual({
      anchors: [liveId('live01')],
      neighbors: [liveId('live02')],
      t1: ['t1t_live'],
      filtered: false,
    });
    expect(live.metrics.usefulAnchorPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(live.metrics.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(live.metrics.neighborPrecision).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(live.metrics.t1Repeat).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(live.measurementComplete).toBe(true);
    // The snapshot ids are a different pool: the arms never borrow each other's.
    expect(arms['snapshot-current'].displayed.map((entry) => entry.id)).toEqual([id('alpha1')]);
  });

  test('a live capture has no pre-admission pool, so suppression is not measured', () => {
    const arms = evaluateSessionShadowFixture(liveFixture());

    // The snapshot arm drops one of the two pre-admission answers.
    expect(arms['snapshot-current'].metrics.legitimateSuppression).toEqual({
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(arms['live-frozen'].suppressed).toEqual([]);
    expect(arms['live-frozen'].metrics.legitimateSuppression).toEqual({
      numerator: 0,
      denominator: 0,
      value: null,
    });
  });

  test('a case without a frozen capture is reported as unavailable, not as 0% quality', () => {
    const fixture = liveFixture();
    const withoutCapture: SessionShadowQualityFixture = { ...fixture, id: 'live-missing' };
    delete withoutCapture.liveCapture;
    delete withoutCapture.liveAnnotations;
    delete withoutCapture.liveExpectedAnswerFamilies;

    const arms = evaluateSessionShadowFixture(withoutCapture);
    const live = arms['live-frozen'];

    expect(live.available).toBe(false);
    expect(live.served).toBe(false);
    expect(live.fallbackReason).toBe('no-live-capture');
    expect(live.servedBlock).toBeNull();
    expect(live.displayed).toEqual([]);
    for (const metric of [
      live.metrics.usefulAnchorPrecision,
      live.metrics.answerCoverage,
      live.metrics.falseDisplay,
      live.metrics.legitimateSuppression,
      live.metrics.neighborPrecision,
      live.metrics.t1Repeat,
    ]) {
      expect(metric).toEqual({ numerator: 0, denominator: 0, value: null });
    }
  });

  test('a no-answer control with an empty live body is 0/1 false display, not null', () => {
    const fixture = makeFixture({
      id: 'live-empty-control',
      query: 'alpha beta',
      isNoAnswerControl: true,
      memories: [mem('noise1', 'alpha-adjacent noise', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('noise1', 'alpha-adjacent noise')],
      annotations: [{ id: id('noise1'), role: 'anchor', label: 'noise' }],
      liveCapture: {
        capturedAt: '2026-11-19T09:04:00.000Z',
        block: '<topic-recall>\n\u4e3b\u9898\uff1a\u672a\u8bbe\u7f6e\n\u76f8\u5173\u8bb0\u5fc6\uff1a\u65e0\n</topic-recall>',
      },
      liveAnnotations: [],
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['snapshot-current'].metrics.falseDisplay).toEqual({ numerator: 1, denominator: 1, value: 1 });
    expect(arms['live-frozen'].displayed).toEqual([]);
    expect(arms['live-frozen'].metrics.falseDisplay).toEqual({ numerator: 0, denominator: 1, value: 0 });
    expect(arms['live-frozen'].metrics.usefulAnchorPrecision.value).toBeNull();
  });

  test('a topic-recall shell with no memory pointer is not a served live block', () => {
    const fixture = makeFixture({
      id: 'live-shell-only',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
      liveCapture: {
        capturedAt: '2026-11-19T09:04:00.000Z',
        block: '<topic-recall>\n\u4e3b\u9898\uff1a\u672a\u8bbe\u7f6e\n\u76f8\u5173\u8bb0\u5fc6\uff1a\u65e0\n</topic-recall>',
      },
      liveAnnotations: [],
    });

    const arms = evaluateSessionShadowFixture(fixture);
    const live = arms['live-frozen'];

    // The live path produced no memory block at all: the topic shell is not a
    // serve, and no synthetic `use` decision may claim otherwise.
    expect(live.served).toBe(false);
    expect(live.decision).toBe('no-snapshot');
    expect(live.fallbackReason).toBe('no-memory-pointers');
    expect(live.servedBlock).toBeNull();
    expect(live.families).toEqual([]);
  });

  test('a T1-only live block is still a served memory block', () => {
    const fixture = makeFixture({
      id: 'live-t1-only',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [
        { id: id('alpha1'), role: 'anchor', label: 'answer' },
      ],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
      liveCapture: {
        capturedAt: '2026-11-19T09:04:00.000Z',
        block: '[T1 \u539f\u6587\u8bb0\u5f55]\n[t1|t1t_live] alpha beta quote',
      },
      liveAnnotations: [{ id: 't1t_live', role: 't1', label: 'context' }],
    });

    const arms = evaluateSessionShadowFixture(fixture);
    const live = arms['live-frozen'];

    expect(live.served).toBe(true);
    expect(live.decision).toBe('use');
    expect(live.kept.t1).toEqual(['t1t_live']);
    expect(live.metrics.t1Repeat).toEqual({ numerator: 0, denominator: 1, value: 0 });
  });

  test('the live arm reports the capture query, not the snapshot stand-in', () => {
    const fixture = liveFixture();
    fixture.currentQuery = 'snapshot stand-in text';
    fixture.liveCapture = { ...fixture.liveCapture!, query: 'the live call text' };

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['live-frozen'].currentQuery).toBe('the live call text');
    expect(arms['snapshot-current'].currentQuery).toBe('snapshot stand-in text');
  });

  test('the live arm falls back to the case query when the capture recorded none', () => {
    const fixture = liveFixture();
    const arms = evaluateSessionShadowFixture(fixture);

    expect(fixture.liveCapture?.query).toBeUndefined();
    expect(arms['live-frozen'].currentQuery).toBe(fixture.currentQuery);
  });
});

describe('topic-facet', () => {
  test('rejects a raw-query-supported candidate with no entity/alias/retrievalKey support', () => {
    const fixture = makeFixture({
      id: 'facet-domain',
      query: 'beta quality',
      memories: [
        mem('qual01', 'beta quality note', { cue_anchors: ['quality'] }),
        mem('dom001', 'beta quality ops', { cue_anchors: ['alpha-domain'] }),
      ],
      blockLines: [
        anchorLine('qual01', 'beta quality note'),
        anchorLine('dom001', 'beta quality ops'),
      ],
      annotations: [
        { id: id('qual01'), role: 'anchor', label: 'noise' },
        { id: id('dom001'), role: 'anchor', label: 'answer' },
      ],
      families: [{ id: 'f', statement: 'domain ops rule', equivalentIds: [id('dom001')] }],
      topicState: topic({ topic: 'beta quality', entities: ['alpha-domain'] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    // The current adapter keeps both (both share a word unit with the query).
    expect(arms['snapshot-current'].displayed.map((entry) => entry.id)).toEqual([id('qual01'), id('dom001')]);
    // The facet keeps only the domain-supported one.
    expect(arms['topic-facet'].displayed.map((entry) => entry.id)).toEqual([id('dom001')]);
    expect(arms['topic-facet'].metrics.usefulAnchorPrecision).toEqual({
      numerator: 1,
      denominator: 1,
      value: 1,
    });
    expect(arms['topic-facet'].facetFallback).toBeNull();
    expect(arms['topic-facet'].blockSource).toBe('facet-render');
    expect(arms['topic-facet'].replay).toBe(true);
  });

  test('exact evidence bypasses the domain requirement', () => {
    const fixture = makeFixture({
      id: 'facet-exact',
      query: 'alpha beta',
      memories: [
        mem('exact1', 'alpha beta', { cue_anchors: [] }),
        mem('plain1', 'alpha beta plus', { cue_anchors: ['beta'] }),
      ],
      blockLines: [anchorLine('exact1', 'alpha beta'), anchorLine('plain1', 'alpha beta plus')],
      annotations: [
        { id: id('exact1'), role: 'anchor', label: 'answer' },
        { id: id('plain1'), role: 'anchor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('exact1')] }],
      // The only entity is unrelated, so neither candidate earns domain support.
      topicState: topic({ entities: ['gamma'] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['topic-facet'].displayed.map((entry) => entry.id)).toEqual([id('exact1')]);
    expect(arms['topic-facet'].metrics.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  test('a neighbour still needs its anchor, even when it is domain- and query-supported', () => {
    const fixture = makeFixture({
      id: 'facet-neighbour',
      query: 'alpha beta',
      memories: [
        mem('anch01', 'alpha beta', { cue_anchors: ['alpha-domain'] }),
        mem('anch02', 'beta thing', { cue_anchors: ['beta'] }),
        mem('nb0001', 'beta thing two', { cue_anchors: ['beta'], neighborOf: id('anch01') }),
        mem('nb0002', 'beta echo', { cue_anchors: ['alpha-domain'], neighborOf: id('anch02') }),
      ],
      blockLines: [
        anchorLine('anch01', 'alpha beta'),
        neighborLine('nb0001', 'beta thing two'),
        anchorLine('anch02', 'beta thing'),
        neighborLine('nb0002', 'beta echo'),
      ],
      annotations: [
        { id: id('anch01'), role: 'anchor', label: 'answer' },
        { id: id('anch02'), role: 'anchor', label: 'noise' },
        { id: id('nb0001'), role: 'neighbor', label: 'noise' },
        { id: id('nb0002'), role: 'neighbor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('anch01')] }],
      topicState: topic(),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    // The current adapter keeps both anchors and both neighbours.
    expect(arms['snapshot-current'].kept.neighbors).toEqual([id('nb0001'), id('nb0002')]);
    // `anch02` loses its anchor, so `nb0002` must go too; `nb0001` never earns
    // domain support.
    expect(arms['topic-facet'].kept.anchors).toEqual([id('anch01')]);
    expect(arms['topic-facet'].kept.neighbors).toEqual([]);
    expect(arms['topic-facet'].servedBlock).not.toContain('\u21b3');
  });

  test('T1 keeps the current adapter rules (domain support never rescues a T1 line)', () => {
    const fixture = makeFixture({
      id: 'facet-t1',
      query: 'alpha beta',
      memories: [mem('anch01', 'alpha beta', { cue_anchors: ['alpha-domain'] })],
      blockLines: [anchorLine('anch01', 'alpha beta')],
      annotations: [
        { id: id('anch01'), role: 'anchor', label: 'answer' },
        { id: 't1t_off_topic', role: 't1', label: 'noise' },
        { id: 't1t_on_topic', role: 't1', label: 'context' },
        { id: 't1t_dupe', role: 't1', label: 'repeat' },
      ],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('anch01')] }],
      t1Hits: [
        { sessionId: 'ses_unit', turnId: 1, traceId: 't1t_off_topic', cosine: 0, excerpt: 'zeta unrelated echo' },
        { sessionId: 'ses_unit', turnId: 2, traceId: 't1t_on_topic', cosine: 0, excerpt: 'alpha beta echo' },
        { sessionId: 'ses_unit', turnId: 3, traceId: 't1t_dupe', cosine: 0, excerpt: 'alpha beta echo' },
      ],
      // `zeta` is a facet term; it must not make the off-topic T1 line survive.
      topicState: topic({ entities: ['alpha-domain', 'zeta'] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['topic-facet'].kept.t1).toEqual(['t1t_on_topic']);
    expect(arms['topic-facet'].displayed.filter((entry) => entry.role === 't1').map((entry) => entry.id))
      .toEqual(['t1t_on_topic']);
    expect(arms['topic-facet'].metrics.t1Repeat).toEqual({ numerator: 0, denominator: 1, value: 0 });
  });

  test('falls back to the current adapter when there is no topic', () => {
    const fixture = makeFixture({
      id: 'facet-no-topic',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['topic-facet'].facetFallback).toBe('no-topic');
    expect(p0Fields(arms['topic-facet'])).toEqual(p0Fields(arms['snapshot-current']));
    expect(arms['topic-facet'].replay).toBe(false);
  });

  test('a domain made only of unitless terms falls back instead of filtering everything out', () => {
    const fixture = makeFixture({
      id: 'facet-unitless-domain',
      query: '\u8d28\u91cf',
      memories: [mem('qual01', '\u8d28\u91cf\u7b14\u8bb0', { cue_anchors: ['\u8d28\u91cf'] })],
      blockLines: [anchorLine('qual01', '\u8d28\u91cf\u7b14\u8bb0')],
      annotations: [{ id: id('qual01'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: '\u8d28\u91cf', equivalentIds: [id('qual01')] }],
      // A single CJK character carries no word-level unit: it is not evidence.
      topicState: topic({ topic: '\u8d28\u91cf', entities: ['\u8d28'], aliases: [], retrievalKeys: [] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['topic-facet'].facetFallback).toBe('empty-domain');
    expect(p0Fields(arms['topic-facet'])).toEqual(p0Fields(arms['snapshot-current']));
    expect(arms['topic-facet'].metrics.answerCoverage).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  test('a single-CJK-character entity never counts as domain evidence', () => {
    const fixture = makeFixture({
      id: 'facet-unitless-term',
      query: '\u8d28\u91cf \u5206\u6790',
      memories: [
        mem('qual01', '\u8d28\u91cf note', { cue_anchors: ['\u8d28'] }),
        mem('dom001', '\u8d28\u91cf ops', { cue_anchors: ['alpha-domain'] }),
      ],
      blockLines: [anchorLine('qual01', '\u8d28\u91cf note'), anchorLine('dom001', '\u8d28\u91cf ops')],
      annotations: [
        { id: id('qual01'), role: 'anchor', label: 'noise' },
        { id: id('dom001'), role: 'anchor', label: 'answer' },
      ],
      families: [{ id: 'f', statement: 'domain ops', equivalentIds: [id('dom001')] }],
      topicState: topic({ topic: '\u8d28\u91cf', entities: ['\u8d28', 'alpha-domain'], aliases: [], retrievalKeys: [] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    // Both are raw-query supported; only the real entity/alias/key term counts.
    expect(arms['snapshot-current'].displayed.map((entry) => entry.id)).toEqual([id('qual01'), id('dom001')]);
    expect(arms['topic-facet'].facetFallback).toBeNull();
    expect(arms['topic-facet'].displayed.map((entry) => entry.id)).toEqual([id('dom001')]);
  });

  test('falls back when the topic is inactive or the domain lists are empty', () => {
    const base = {
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor' as const, label: 'answer' as const }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
    };

    const inactive = evaluateSessionShadowFixture(makeFixture({
      ...base,
      id: 'facet-inactive',
      topicState: topic({ active: false }),
    }));
    const emptyDomain = evaluateSessionShadowFixture(makeFixture({
      ...base,
      id: 'facet-empty-domain',
      topicState: topic({ entities: [], aliases: [], retrievalKeys: [] }),
    }));

    expect(inactive['topic-facet'].facetFallback).toBe('inactive-topic');
    expect(p0Fields(inactive['topic-facet'])).toEqual(p0Fields(inactive['snapshot-current']));
    expect(emptyDomain['topic-facet'].facetFallback).toBe('empty-domain');
    expect(p0Fields(emptyDomain['topic-facet'])).toEqual(p0Fields(emptyDomain['snapshot-current']));
  });

  test('falls back when topic/summary containment against the raw query is below 0.25', () => {
    const fixture = makeFixture({
      id: 'facet-low-containment',
      query: 'alpha beta',
      memories: [mem('alpha1', 'alpha deployment rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('alpha1', 'alpha deployment rule')],
      annotations: [{ id: id('alpha1'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('alpha1')] }],
      topicState: topic({ topic: 'gamma delta', entities: ['alpha-domain'] }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    expect(arms['topic-facet'].facetFallback).toBe('low-containment');
    expect(p0Fields(arms['topic-facet'])).toEqual(p0Fields(arms['snapshot-current']));
  });

  test('carries the frozen TopicState stale-risk audit verdict (never re-derives it)', () => {
    const reasons = ['summary claims the mis-injection was cleared', 'retrievalKeys still holds implicit 2/10'];
    const fixture = makeFixture({
      id: 'facet-stale-risk',
      query: 'alpha beta',
      memories: [mem('anch01', 'alpha beta', { cue_anchors: ['alpha-domain'] })],
      blockLines: [anchorLine('anch01', 'alpha beta')],
      annotations: [{ id: id('anch01'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('anch01')] }],
      topicState: topic({ audit: { staleRisk: reasons } }),
    });

    const arms = evaluateSessionShadowFixture(fixture);

    for (const arm of SESSION_SHADOW_ARMS) {
      expect(arms[arm].topicStaleRisk).toEqual(reasons);
    }
  });
});

describe('input contract', () => {
  test('the fixture is never mutated', () => {
    const fixture = deepFreeze(makeFixture({
      id: 'frozen-input',
      query: 'alpha beta',
      memories: [
        mem('anch01', 'alpha beta', { cue_anchors: ['alpha-domain'] }),
        mem('nb0001', 'beta neighbour', { cue_anchors: ['beta'], neighborOf: id('anch01') }),
      ],
      blockLines: [anchorLine('anch01', 'alpha beta'), neighborLine('nb0001', 'beta neighbour')],
      annotations: [
        { id: id('anch01'), role: 'anchor', label: 'answer' },
        { id: id('nb0001'), role: 'neighbor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('anch01')] }],
      topicState: topic(),
      liveCapture: {
        capturedAt: '2026-11-19T09:04:00.000Z',
        block: recallBlock(['- #mem-live01 "alpha body" (E:0.8)']),
      },
      liveAnnotations: [{ id: liveId('live01'), role: 'anchor', label: 'answer' }],
      liveFamilies: [{ id: 'lf', statement: 'alpha body', equivalentIds: [liveId('live01')] }],
    }));
    const before = JSON.stringify(fixture);

    expect(() => evaluateSessionShadowFixture(fixture)).not.toThrow();
    expect(JSON.stringify(fixture)).toBe(before);
  });

  test('rejects a live answer label that is not in a live answer family', () => {
    const fixture = makeFixture({
      id: 'live-bad-family',
      query: 'alpha beta',
      memories: [mem('anch05', 'alpha rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('anch05', 'alpha rule')],
      annotations: [{ id: id('anch05'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('anch05')] }],
      liveCapture: { capturedAt: '2026-11-19T09:04:00.000Z', block: recallBlock(['- #mem-live01 "alpha live" (E:0.8)']) },
      liveAnnotations: [{ id: liveId('live01'), role: 'anchor', label: 'answer' }],
      liveFamilies: [],
    });

    expect(() => validateSessionShadowFixture(fixture)).toThrow(/live .*answer.*family/i);
  });

  test('rejects a live capture without independent annotations', () => {
    const fixture = makeFixture({
      id: 'live-no-annotations',
      query: 'alpha beta',
      memories: [mem('anch05', 'alpha rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('anch05', 'alpha rule')],
      annotations: [{ id: id('anch05'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('anch05')] }],
      liveCapture: { capturedAt: '2026-11-19T09:04:00.000Z', block: recallBlock(['- #mem-live01 "alpha live" (E:0.8)']) },
    });

    expect(() => validateSessionShadowFixture(fixture)).toThrow(/liveAnnotations/);
  });

  test('rejects a live annotation whose id is not displayed by the capture', () => {
    const fixture = makeFixture({
      id: 'live-unmeasured',
      query: 'alpha beta',
      memories: [mem('anch05', 'alpha rule', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('anch05', 'alpha rule')],
      annotations: [{ id: id('anch05'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha rule', equivalentIds: [id('anch05')] }],
      liveCapture: { capturedAt: '2026-11-19T09:04:00.000Z', block: recallBlock(['- #mem-live01 "alpha live" (E:0.8)']) },
      liveAnnotations: [
        { id: liveId('live01'), role: 'anchor', label: 'answer' },
        { id: liveId('live02'), role: 'neighbor', label: 'noise' },
      ],
      liveFamilies: [{ id: 'lf', statement: 'alpha live', equivalentIds: [liveId('live01')] }],
    });

    expect(() => validateSessionShadowFixture(fixture)).toThrow(/not displayed/);
  });
});

describe('shadow summary', () => {
  test('aggregates every P0 metric per arm and excludes unavailable cases', () => {
    const withLive = makeFixture({
      id: 'summary-live',
      query: 'alpha beta',
      memories: [
        mem('ansr01', 'alpha beta rule', { cue_anchors: ['alpha'] }),
        mem('nois01', 'beta noise', { cue_anchors: ['beta'] }),
      ],
      blockLines: [anchorLine('ansr01', 'alpha beta rule'), anchorLine('nois01', 'beta noise')],
      annotations: [
        { id: id('ansr01'), role: 'anchor', label: 'answer' },
        { id: id('nois01'), role: 'anchor', label: 'noise' },
      ],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('ansr01')] }],
      topicState: topic({ entities: ['alpha-domain'] }),
      liveCapture: { capturedAt: '2026-11-19T09:04:00.000Z', block: recallBlock(['- #mem-live01 "alpha body" (E:0.8)']) },
      liveAnnotations: [{ id: liveId('live01'), role: 'anchor', label: 'answer' }],
      liveFamilies: [{ id: 'lf', statement: 'alpha body', equivalentIds: [liveId('live01')] }],
    });
    const withoutLive = makeFixture({
      id: 'summary-no-live',
      query: 'alpha beta',
      memories: [mem('nois02', 'alpha noise', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('nois02', 'alpha noise')],
      annotations: [{ id: id('nois02'), role: 'anchor', label: 'noise' }],
      topicState: topic({ entities: ['alpha-domain'] }),
    });

    const results = [
      ...Object.values(evaluateSessionShadowFixture(withLive)),
      ...Object.values(evaluateSessionShadowFixture(withoutLive)),
    ];
    const summary = summarizeSessionShadow(results);

    expect(summary.cases).toBe(2);
    for (const arm of SESSION_SHADOW_ARMS) {
      expect(summary.arms[arm].arm).toBe(arm);
      expect(summary.arms[arm].cases).toBe(2);
    }
    expect(summary.arms['snapshot-current'].measuredCases).toBe(2);
    expect(summary.arms['live-frozen'].measuredCases).toBe(1);
    expect(summary.arms['live-frozen'].unmeasuredCases).toBe(1);
    expect(summary.arms['live-frozen'].unmeasuredCaseIds).toEqual(['summary-no-live']);
    // A case without a capture is NOT a "fallback": it has no measurement at all.
    expect(summary.arms['live-frozen'].serve.notServed).toBe(0);
    expect(summary.arms['live-frozen'].serve.served).toBe(1);
    expect(summary.arms['live-frozen'].usefulAnchorPrecision).toEqual({ numerator: 1, denominator: 1, value: 1 });
    // The snapshot arm still shows the two noise anchors.
    expect(summary.arms['snapshot-current'].usefulAnchorPrecision).toEqual({
      numerator: 1,
      denominator: 3,
      value: 0.3333,
    });
    // P0's own summarizer must agree with the shadow wrapper.
    const p0Only = results.filter((result) => result.arm === 'snapshot-current');
    const { results: _ignored, ...p0Summary } = summarizeSessionSnapshotQuality(p0Only);
    const { arm: _arm, measuredCases: _measured, unmeasuredCases: _unmeasured, unmeasuredCaseIds: _unmeasuredIds, ...shadowSnapshotSummary } = summary.arms['snapshot-current'];
    expect(shadowSnapshotSummary).toEqual(p0Summary);
  });

  test('an absent live capture is excluded from serve counts and rate denominators', () => {
    const capture = {
      capturedAt: '2026-11-19T09:04:00.000Z',
      block: recallBlock(['- #mem-live01 "alpha noise body" (E:0.8)']),
    };
    const control = (caseId: string, withCapture: boolean) => makeFixture({
      id: caseId,
      query: 'alpha beta',
      isNoAnswerControl: true,
      memories: [mem('noise1', 'alpha noise', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('noise1', 'alpha noise')],
      annotations: [{ id: id('noise1'), role: 'anchor', label: 'noise' }],
      ...(withCapture
        ? {
            liveCapture: capture,
            liveAnnotations: [{ id: liveId('live01'), role: 'anchor', label: 'noise' }],
          }
        : {}),
    });

    const summary = summarizeSessionShadow([
      ...Object.values(evaluateSessionShadowFixture(control('unmeasured-with', true))),
      ...Object.values(evaluateSessionShadowFixture(control('unmeasured-without', false))),
    ]);
    const live = summary.arms['live-frozen'];

    expect(live.cases).toBe(2);
    expect(live.measuredCases).toBe(1);
    expect(live.unmeasuredCases).toBe(1);
    expect(live.unmeasuredCaseIds).toEqual(['unmeasured-without']);
    expect(live.serve.served).toBe(1);
    // The absent capture must not be counted as a fallback/not-served case...
    expect(live.serve.notServed).toBe(0);
    expect(live.serve.fallback).toBe(0);
    // ...and must not inflate the safety denominator (1 measured control, not 2).
    expect(live.falseDisplay).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  test('reports the topic audit: cases with topic, facet fallbacks and stale risks', () => {
    const risky = makeFixture({
      id: 'audit-risky',
      query: 'alpha beta',
      memories: [mem('anch01', 'alpha beta', { cue_anchors: ['alpha-domain'] })],
      blockLines: [anchorLine('anch01', 'alpha beta')],
      annotations: [{ id: id('anch01'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f', statement: 'alpha beta', equivalentIds: [id('anch01')] }],
      topicState: topic({ audit: { staleRisk: ['summary is from the previous revision'] } }),
    });
    const noTopic = makeFixture({
      id: 'audit-no-topic',
      query: 'alpha beta',
      memories: [mem('anch02', 'alpha beta', { cue_anchors: ['alpha'] })],
      blockLines: [anchorLine('anch02', 'alpha beta')],
      annotations: [{ id: id('anch02'), role: 'anchor', label: 'answer' }],
      families: [{ id: 'f2', statement: 'alpha beta', equivalentIds: [id('anch02')] }],
    });

    const summary = summarizeSessionShadow([
      ...Object.values(evaluateSessionShadowFixture(risky)),
      ...Object.values(evaluateSessionShadowFixture(noTopic)),
    ]);

    expect(summary.topicAudit.casesWithTopic).toBe(1);
    expect(summary.topicAudit.facetsApplied).toBe(1);
    expect(summary.topicAudit.facetFallbacks).toEqual({ 'no-topic': 1 });
    expect(summary.topicAudit.staleRisk).toEqual([
      { caseId: 'audit-risky', reasons: ['summary is from the previous revision'] },
    ]);
  });
});

describe('shadow runner API', () => {
  test('the shadow fingerprint covers the exact-evidence dependency and the runner itself', () => {
    const runner = require('../../../../evaluation/session-recall/run-shadow') as typeof import(
      '../../../../evaluation/session-recall/run-shadow'
    );

    const fingerprint = runner.computeShadowCodeFingerprint();

    expect(fingerprint.files.map((file) => file.path)).toEqual([
      'gateway/src/recall/session-quality.ts',
      'gateway/src/recall/snapshot-current-query.ts',
      'gateway/src/recall/lexical-support.ts',
      'gateway/src/recall/recall-snapshot.ts',
      'gateway/src/recall/inject-format.ts',
      'gateway/src/recall/verbatim-recall.ts',
      'gateway/src/recall/exact-evidence.ts',
      'gateway/src/recall/session-quality-shadow.ts',
      'evaluation/session-recall/run-shadow.ts',
    ]);
    for (const file of fingerprint.files) expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test('importing the runner does not execute main', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    try {
      process.exitCode = undefined;
      jest.isolateModules(() => {
        const isolated = require('../../../../evaluation/session-recall/run-shadow') as typeof import(
          '../../../../evaluation/session-recall/run-shadow'
        );
        expect(typeof isolated.runShadowEvaluation).toBe('function');
        expect(typeof isolated.loadShadowFixtureFile).toBe('function');
        expect(typeof isolated.summarizeSessionShadow).toBe('function');
      });
      expect(errorSpy).not.toHaveBeenCalled();
      expect(process.exitCode ?? 0).toBe(0);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
