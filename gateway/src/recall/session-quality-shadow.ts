/**
 * Session recall quality P1 shadow evaluator: four frozen arms.
 *
 * P0 (`session-quality.ts`) answers one question: "what did the snapshot serve
 * path render for this frozen case". A mis-display still has three candidate
 * causes — the snapshot decision, the current-query adapter, or the snapshot
 * pool itself — and one unmeasured alternative (the live path). This module
 * freezes all four answers for the SAME case so the cause can be attributed:
 *
 *   1. `snapshot-current`  — the real P0 result, delegated verbatim to
 *      `evaluateSessionSnapshotFixture` (no re-scoring, no rule copy);
 *   2. `current-query-off` — the SAME `decideSnapshotUse` + FOK gate, then the
 *      stored block served verbatim. This switches off only the snapshot
 *      current-query adapter (`adaptSnapshotToCurrentQuery`); it does NOT model
 *      (and must never be described as) "the whole live lexical veto is off" —
 *      the live veto is not part of the snapshot serve path at all;
 *   3. `live-frozen`       — a block captured from the live boundary path and
 *      frozen in the fixture. This evaluator never calls Gateway: it consumes
 *      the frozen block only. A live capture has NO pre-admission pool, so
 *      legitimate suppression is `0/0 → null` (not measurable), never 0%;
 *   4. `topic-facet`       — one deterministic offline candidate rule. It
 *      replaces ONLY the Harmonic support selection (never the renderer, never
 *      the T1 dedupe/redundancy rules, never the stored snapshot):
 *        - exact evidence (`findExactRecallEvidence`, metadata only) bypasses;
 *        - every other candidate needs domain support from
 *          `entities` / `aliases` / `retrievalKeys` AND raw currentQuery
 *          support (the same `selectLexicallySupportedCandidates` the adapter
 *          uses);
 *        - a neighbour still needs its anchor retained;
 *        - no/inactive topic, empty domain list, or
 *          `snapshotContainment(topic + summary, rawQuery) < 0.25` falls back
 *          to the current adapter unchanged.
 *
 * `topic` and `summary` are used for the containment/uncertainty gate ONLY —
 * they are never domain evidence, so a word like 「质量」cannot become a domain
 * shortcut. TopicState is a possibly-stale attention state, not a fact source:
 * the audit verdict (`topicState.audit.staleRisk`) is frozen data that is
 * carried into the result, never re-derived from the text here.
 *
 * Every arm keeps P0's per-case `displayed` / `suppressed` / `families` /
 * measurement fields. Arms that re-render something mark `replay: true` and say
 * which block they measure (`blockSource`), so no custom arm can be mistaken for
 * a captured serve. Read-only and pure: no DB, no model, no writes, and the
 * fixture is never mutated.
 */
import type { RecallSnapshot } from './recall-snapshot';
import { SNAPSHOT_DEFAULTS, decideSnapshotUse, snapshotContainment } from './recall-snapshot';
import type { SnapshotDecision } from './recall-snapshot';
import { adaptSnapshotToCurrentQuery } from './snapshot-current-query';
import { selectLexicallySupportedCandidates, type LexicalSupportCandidate } from './lexical-support';
import { findExactRecallEvidence } from './exact-evidence';
import { formatRecallContext } from './inject-format';
import { renderT1Lines, T1_POINTER_HEADER } from './verbatim-recall';
import {
  evaluateSessionSnapshotFixture,
  summarizeSessionSnapshotQuality,
  validateSessionSnapshotQualityFixture,
  type ExpectedAnswerFamily,
  type QualityRate,
  type SessionAnnotationLabel,
  type SessionAnnotationRole,
  type SessionDisplayedEntry,
  type SessionFamilyResult,
  type SessionKeptRoles,
  type SessionSnapshotAnnotation,
  type SessionSnapshotQualityFixture,
  type SessionSnapshotQualityMetrics,
  type SessionSnapshotQualityOptions,
  type SessionSnapshotQualityResult,
  type SessionSnapshotQualitySummary,
  type UnannotatedDisplayedEntry,
} from './session-quality';

// ── Arms ─────────────────────────────────────────────────────────────────────

export const SESSION_SHADOW_ARMS = [
  'snapshot-current',
  'current-query-off',
  'live-frozen',
  'topic-facet',
] as const;

export type SessionShadowArm = (typeof SESSION_SHADOW_ARMS)[number];

/** Which block an arm measured — never inferred from the arm name alone. */
export type SessionShadowBlockSource = 'stored' | 'adapter' | 'live-capture' | 'facet-render';

/**
 * Why `topic-facet` did not apply and fell back to the current adapter. `null`
 * means the facet rule ran (or the serve never reached admission).
 */
export type SessionShadowFacetFallback =
  | 'no-topic'
  | 'inactive-topic'
  | 'empty-domain'
  | 'low-containment'
  | 'no-metadata'
  | 'no-query-units';

/** Domain/containment gate for the facet rule: fixed, not config-driven. */
export const TOPIC_FACET_MIN_CONTAINMENT = 0.25;

// ── Fixture extension ────────────────────────────────────────────────────────

export interface SessionShadowLiveCapture {
  /** ISO timestamp of the capture (provenance only; not a scoring input). */
  capturedAt: string;
  /**
   * The query the captured live serve was answering, when the capture recorded
   * one. Provenance only: it may differ from the case's `currentQuery` (which is
   * the snapshot-side replay query), and it never changes the scoring.
   */
  query?: string;
  /** Frozen live boundary-path output, pointer tails exactly as printed. */
  block: string;
}

/**
 * Frozen copy of `TopicState` (see `recall/topic-state.ts`) plus the frozen
 * audit verdict. `audit.staleRisk` is a human/audit judgement recorded with the
 * capture: the evaluator reports it and never tries to detect staleness from
 * the text.
 */
export interface SessionShadowTopicState {
  sessionId?: string;
  topic: string;
  summary?: string;
  entities: string[];
  aliases: string[];
  retrievalKeys: string[];
  openLoops?: string[];
  active: boolean;
  revision?: number;
  updatedAt?: string;
  audit?: { staleRisk?: string[] };
}

/**
 * A P0 fixture plus the frozen live/topic material. Live ids may differ from
 * snapshot ids (the capture only printed pointer tails), so live annotations and
 * live answer families are registered separately.
 */
export interface SessionShadowQualityFixture extends SessionSnapshotQualityFixture {
  liveCapture?: SessionShadowLiveCapture;
  liveAnnotations?: SessionSnapshotAnnotation[];
  liveExpectedAnswerFamilies?: ExpectedAnswerFamily[];
  topicState?: SessionShadowTopicState;
}

// ── Result / summary ─────────────────────────────────────────────────────────

export interface SessionShadowArmResult extends SessionSnapshotQualityResult {
  arm: SessionShadowArm;
  /** True when this arm re-rendered its block instead of reading a captured one. */
  replay: boolean;
  /** Which block was measured (`null` when nothing was served). */
  blockSource: SessionShadowBlockSource | null;
  /** False only for `live-frozen` without a frozen capture (not measured). */
  available: boolean;
  /** `topic-facet` only: why the facet rule was skipped. */
  facetFallback: SessionShadowFacetFallback | null;
  /** True when the fixture froze a TopicState for this case. */
  topicProvided: boolean;
  /** Frozen audit verdict carried through unchanged (may be empty). */
  topicStaleRisk: string[];
}

export type SessionShadowArms = Record<SessionShadowArm, SessionShadowArmResult>;

export type SessionShadowArmSummary = Omit<SessionSnapshotQualitySummary, 'results'> & {
  arm: SessionShadowArm;
  /**
   * Rows for this arm. Every other field (serve counts, rates, warnings) covers
   * `measuredCases` only: an arm with no measurement behind a case (a live arm
   * without a frozen capture) is excluded from `serve.notServed` / `fallback`
   * and from every rate denominator, and listed in `unmeasuredCaseIds`.
   */
  cases: number;
  /** Cases with an actual measurement behind them. */
  measuredCases: number;
  /** Cases excluded because the arm has no measurement for them. */
  unmeasuredCases: number;
  unmeasuredCaseIds: string[];
};

export interface SessionShadowTopicAuditSummary {
  /** Cases that froze a TopicState. */
  casesWithTopic: number;
  /** Cases where the facet rule actually ran. */
  facetsApplied: number;
  /** Fallback reason → count, across the `topic-facet` arms. */
  facetFallbacks: Record<string, number>;
  /** Frozen stale-risk verdicts, per case (never re-derived). */
  staleRisk: Array<{ caseId: string; reasons: string[] }>;
}

export interface SessionShadowSummary {
  /** Distinct fixture cases. */
  cases: number;
  arms: Record<SessionShadowArm, SessionShadowArmSummary>;
  topicAudit: SessionShadowTopicAuditSummary;
}

// ── Small helpers (mirrors of the P0 scoring surface) ────────────────────────

const USEFUL_LABELS = new Set<SessionAnnotationLabel>(['answer', 'context']);
const LABELS = new Set<string>(['answer', 'context', 'noise', 'repeat', 'stale-or-conflict']);
const ANNOTATION_ROLES = new Set<SessionAnnotationRole>(['anchor', 'neighbor', 't1']);

const POINTER_RE = /#mem-([0-9a-z]{6})(?![0-9a-z])/g;
const T1_POINTER_RE = /\[t1\|([^\]]+)\]/g;
const NEIGHBOR_LINE_RE = /^\s*↳/;

function rate(numerator: number, denominator: number): QualityRate {
  const value = denominator > 0 ? Math.round((numerator / denominator) * 10_000) / 10_000 : null;
  return { numerator, denominator, value };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function annotationKey(role: SessionAnnotationRole, id: string): string {
  return `${role}:${id}`;
}

function isUseful(label: SessionAnnotationLabel | null): boolean {
  return label !== null && USEFUL_LABELS.has(label);
}

/**
 * Pointer tail → full id. P0 builds this from `snapshot.memories` + `snapshot.ids`;
 * the live arm builds it from the frozen annotations (a capture has no pool) and
 * keeps the printed tail as the id when the capture never recorded a full id.
 */
function buildTailIndex(ids: readonly string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const id of ids) index.set(id.slice(-6), id);
  return index;
}

/**
 * Same parser as P0 (`session-quality.parseDisplayedBlock`): the served block is
 * the ground truth, `↳` at line start is a neighbour, unknown pointers stay
 * `label: null` (measurement gap, never silently dropped).
 */
function parseDisplayedBlock(
  block: string,
  tailIndex: Map<string, string>,
  annotations: Map<string, SessionSnapshotAnnotation>,
): SessionDisplayedEntry[] {
  const displayed: SessionDisplayedEntry[] = [];
  for (const line of String(block ?? '').split(/\r?\n/)) {
    const t1Pointers = [...line.matchAll(T1_POINTER_RE)];
    if (t1Pointers.length > 0) {
      for (const match of t1Pointers) {
        const traceId = match[1].trim();
        if (!traceId) continue;
        displayed.push({
          id: traceId,
          role: 't1',
          label: annotations.get(annotationKey('t1', traceId))?.label ?? null,
        });
      }
      continue;
    }
    const role: SessionAnnotationRole = NEIGHBOR_LINE_RE.test(line) ? 'neighbor' : 'anchor';
    for (const match of line.matchAll(POINTER_RE)) {
      const id = tailIndex.get(match[1]) ?? match[1];
      displayed.push({
        id,
        role,
        label: annotations.get(annotationKey(role, id))?.label ?? null,
      });
    }
  }
  return displayed;
}

interface ScoredBlock {
  displayed: SessionDisplayedEntry[];
  unannotatedDisplayed: UnannotatedDisplayedEntry[];
  measurementComplete: boolean;
  suppressed: Array<{ id: string; label: SessionAnnotationLabel }>;
  families: SessionFamilyResult[];
  falseDisplayIds: string[];
  metrics: SessionSnapshotQualityMetrics;
}

/**
 * Score one rendered block with P0's metric definitions.
 *
 * `preAdmissionPool` is `null` for a live capture: there was no snapshot pool, so
 * suppression has no denominator and is reported `null` instead of a fake 100%.
 */
function scoreServedBlock(input: {
  /** Served block, or null when nothing was served. */
  block: string | null;
  annotations: readonly SessionSnapshotAnnotation[];
  expectedAnswerFamilies: readonly ExpectedAnswerFamily[];
  isNoAnswerControl: boolean;
  /** Ids the block may reference (anchor/neighbour full ids). */
  knownIds: readonly string[];
  /** `null` → no pre-admission pool (live capture): suppression not measurable. */
  preAdmissionPool: readonly SessionSnapshotAnnotation[] | null;
}): ScoredBlock {
  const annotationMap = new Map<string, SessionSnapshotAnnotation>(
    input.annotations.map((annotation) => [annotationKey(annotation.role, annotation.id), annotation]),
  );
  const tailIndex = buildTailIndex(input.knownIds);
  const served = input.block !== null;
  const displayed = served
    ? parseDisplayedBlock(input.block as string, tailIndex, annotationMap)
    : [];

  const displayedAnchors = displayed.filter((entry) => entry.role === 'anchor');
  const displayedNeighbors = displayed.filter((entry) => entry.role === 'neighbor');
  const displayedT1 = displayed.filter((entry) => entry.role === 't1');
  const displayedMemory = displayed.filter((entry) => entry.role !== 't1');

  const unannotatedDisplayed: UnannotatedDisplayedEntry[] = displayed
    .filter((entry) => entry.label === null)
    .map((entry) => ({ id: entry.id, role: entry.role }));

  const anchorIds = new Set(displayedAnchors.map((entry) => entry.id));
  const families: SessionFamilyResult[] = input.expectedAnswerFamilies.map((family) => {
    const matchedIds = family.equivalentIds.filter((id) => anchorIds.has(id));
    return { id: family.id, statement: family.statement, covered: matchedIds.length > 0, matchedIds };
  });

  const usefulAnchors = displayedAnchors.filter((entry) => isUseful(entry.label)).length;
  const usefulNeighbors = displayedNeighbors.filter((entry) => isUseful(entry.label)).length;

  // Suppression is pre-admission pool only and served-only, exactly as in P0.
  const poolCandidates = input.preAdmissionPool === null || !served
    ? null
    : input.preAdmissionPool.filter((annotation) => annotation.role !== 't1' && isUseful(annotation.label));
  const displayedMemoryIds = new Set(displayedMemory.map((entry) => entry.id));
  const suppressed = (poolCandidates ?? [])
    .filter((annotation) => !displayedMemoryIds.has(annotation.id))
    .map((annotation) => ({ id: annotation.id, label: annotation.label }));

  const falseDisplayIds = input.isNoAnswerControl
    ? displayedMemory.filter((entry) => entry.label === 'noise').map((entry) => entry.id)
    : [];
  const falseDisplay = input.isNoAnswerControl
    ? rate(falseDisplayIds.length > 0 ? 1 : 0, 1)
    : rate(0, 0);

  const coveredFamilies = families.filter((family) => family.covered).length;
  const repeatedT1 = displayedT1.filter((entry) => entry.label === 'repeat').length;

  return {
    displayed,
    unannotatedDisplayed,
    measurementComplete: unannotatedDisplayed.length === 0,
    suppressed,
    families,
    falseDisplayIds,
    metrics: {
      usefulAnchorPrecision: rate(usefulAnchors, displayedAnchors.length),
      answerCoverage: rate(coveredFamilies, families.length),
      falseDisplay,
      legitimateSuppression: rate(suppressed.length, poolCandidates?.length ?? 0),
      neighborPrecision: rate(usefulNeighbors, displayedNeighbors.length),
      t1Repeat: rate(repeatedT1, displayedT1.length),
    },
  };
}

/** An arm with no measurement behind it: every rate is `0/0 → null`. */
function emptyScore(): ScoredBlock {
  return {
    displayed: [],
    unannotatedDisplayed: [],
    measurementComplete: true,
    suppressed: [],
    families: [],
    falseDisplayIds: [],
    metrics: {
      usefulAnchorPrecision: rate(0, 0),
      answerCoverage: rate(0, 0),
      falseDisplay: rate(0, 0),
      legitimateSuppression: rate(0, 0),
      neighborPrecision: rate(0, 0),
      t1Repeat: rate(0, 0),
    },
  };
}

/** P0's `kept` fields for a snapshot that was served without adaptation. */
function keptFromSnapshot(snapshot: RecallSnapshot): SessionKeptRoles {
  return {
    anchors: [...(snapshot.ids ?? [])],
    neighbors: (snapshot.memories ?? [])
      .filter((memory) => Boolean(memory.neighborOf))
      .map((memory) => memory.id),
    t1: snapshot.t1Rendered === true
      ? (snapshot.t1Hits ?? [])
          .map((hit) => hit.traceId ?? '')
          .filter((traceId): traceId is string => traceId.length > 0)
      : [],
    filtered: false,
  };
}

function snapshotKnownIds(snapshot: RecallSnapshot): string[] {
  const ids = new Set<string>();
  for (const memory of snapshot.memories ?? []) if (isNonEmptyString(memory?.id)) ids.add(memory.id);
  for (const id of snapshot.ids ?? []) if (isNonEmptyString(id)) ids.add(id);
  return [...ids];
}

function memoryCandidate(memory: NonNullable<RecallSnapshot['memories']>[number]): LexicalSupportCandidate {
  return {
    primary_abstraction: memory.abstraction ?? '',
    cue_anchors: Array.isArray(memory.cue_anchors) ? memory.cue_anchors : [],
  };
}

/** Same renderer input mapping the adapter uses (render-only; no admission). */
function toRenderable(memory: NonNullable<RecallSnapshot['memories']>[number]): {
  id: string;
  primary_abstraction: string;
  type?: string;
  created_at?: string;
  energy?: number;
} {
  return {
    id: memory.id,
    primary_abstraction: memory.abstraction ?? '',
    ...(memory.type ? { type: memory.type } : {}),
    ...(memory.date ? { created_at: memory.date } : {}),
    ...(typeof memory.energy === 'number' && Number.isFinite(memory.energy) ? { energy: memory.energy } : {}),
  };
}

/**
 * Re-render the facet-reduced pool with the SAME renderer the adapter uses.
 *
 * This block is only ever served by the adapter when it filters nothing (then
 * the adapter serves the stored block as-is, by design). Whenever the adapter
 * does filter — a dropped/duplicated T1 line included — it re-renders with its
 * own code and this block is discarded, so the T1 rules stay the adapter's.
 */
function renderFacetBlock(
  snapshot: RecallSnapshot,
  anchors: NonNullable<RecallSnapshot['memories']>,
  neighbors: NonNullable<RecallSnapshot['memories']>,
  t1MaxChars: number,
): string | null {
  const status = snapshot.fokStatus ?? 'inject';
  const neighborsByAnchor = new Map<string, ReturnType<typeof toRenderable>[]>();
  for (const memory of neighbors) {
    const anchorId = memory.neighborOf as string;
    const list = neighborsByAnchor.get(anchorId) ?? [];
    list.push(toRenderable(memory));
    neighborsByAnchor.set(anchorId, list);
  }
  const harmonic = anchors.length > 0
    ? formatRecallContext(anchors.map(toRenderable), {
        status,
        ...(neighborsByAnchor.size > 0 ? { neighbors: neighborsByAnchor } : {}),
      }).pointers
    : null;
  const t1Hits = Array.isArray(snapshot.t1Hits) ? snapshot.t1Hits : [];
  const t1Lines = t1Hits.length > 0
    ? renderT1Lines(t1Hits, { k: t1Hits.length, maxChars: t1MaxChars })
    : '';
  return harmonic && t1Lines
    ? `${harmonic}\n${t1Lines}`
    : harmonic ?? (t1Lines ? `${T1_POINTER_HEADER}\n${t1Lines}` : null);
}

// ── Fixture validation ───────────────────────────────────────────────────────

function validateLiveSide(fixture: SessionShadowQualityFixture, where: string): void {
  const capture = fixture.liveCapture;
  const annotations = fixture.liveAnnotations;

  if (!capture) {
    if (annotations !== undefined) {
      throw new Error(`${where}: liveAnnotations require a liveCapture (there is no live block to measure)`);
    }
    if (fixture.liveExpectedAnswerFamilies !== undefined) {
      throw new Error(`${where}: liveExpectedAnswerFamilies require a liveCapture`);
    }
    return;
  }

  if (typeof capture !== 'object' || Array.isArray(capture)) {
    throw new Error(`${where}: liveCapture must be an object`);
  }
  if (!isNonEmptyString(capture.capturedAt) || Number.isNaN(Date.parse(capture.capturedAt))) {
    throw new Error(`${where}: liveCapture.capturedAt must be a parseable ISO timestamp`);
  }
  if (!isNonEmptyString(capture.block)) {
    throw new Error(`${where}: liveCapture.block must be a non-empty string`);
  }
  if (capture.query !== undefined && typeof capture.query !== 'string') {
    throw new Error(`${where}: liveCapture.query must be a string when present`);
  }
  if (!Array.isArray(annotations)) {
    throw new Error(
      `${where}: liveCapture requires liveAnnotations (the live block is annotated independently of the snapshot)`,
    );
  }

  // A live capture is judged with its OWN answer-family registry: snapshot
  // families are keyed on snapshot ids and a live block cannot display them.
  const families = fixture.liveExpectedAnswerFamilies ?? [];
  if (!Array.isArray(families)) throw new Error(`${where}: liveExpectedAnswerFamilies must be an array`);
  const familyIds = new Set<string>();
  for (const family of families) {
    if (!family || !isNonEmptyString(family.id)) {
      throw new Error(`${where}: every live expected answer family needs a non-empty id`);
    }
    if (familyIds.has(family.id)) {
      throw new Error(`${where}: duplicate live expected answer family id "${family.id}"`);
    }
    familyIds.add(family.id);
    if (!isNonEmptyString(family.statement)) {
      throw new Error(`${where}: live expected answer family "${family.id}" needs a reference statement`);
    }
    if (
      !Array.isArray(family.equivalentIds)
      || family.equivalentIds.length === 0
      || family.equivalentIds.some((id) => !isNonEmptyString(id))
    ) {
      throw new Error(`${where}: live expected answer family "${family.id}" needs a non-empty equivalentIds string[]`);
    }
  }
  const familyEquivalentIds = new Set(families.flatMap((family) => family.equivalentIds));

  // The live block is the only pool: every displayed pointer must be annotated,
  // and an annotation for something the capture never displayed is unmeasurable.
  const tails = new Map<string, string>();
  const seen = new Set<string>();
  for (const annotation of annotations) {
    if (!annotation || typeof annotation !== 'object') {
      throw new Error(`${where}: every live annotation must be an object`);
    }
    if (!isNonEmptyString(annotation.id)) {
      throw new Error(`${where}: live annotation is missing a non-empty id`);
    }
    if (!LABELS.has(annotation.label)) {
      throw new Error(`${where}: unknown live annotation label "${annotation.label}" for ${annotation.id}`);
    }
    if (!ANNOTATION_ROLES.has(annotation.role)) {
      throw new Error(`${where}: unknown live annotation role "${annotation.role}" for ${annotation.id}`);
    }
    const key = annotationKey(annotation.role, annotation.id);
    if (seen.has(key)) {
      throw new Error(`${where}: duplicate live annotation role ${annotation.role} for ${annotation.id}`);
    }
    seen.add(key);
    if (annotation.role === 't1') continue;
    const tail = annotation.id.slice(-6);
    const previous = tails.get(tail);
    if (previous && previous !== annotation.id) {
      throw new Error(`${where}: live ids "${previous}" and "${annotation.id}" share pointer tail "${tail}"`);
    }
    tails.set(tail, annotation.id);
  }

  const liveKnownIds = annotations
    .filter((annotation) => annotation.role !== 't1')
    .map((annotation) => annotation.id);
  const displayed = parseDisplayedBlock(
    capture.block,
    buildTailIndex(liveKnownIds),
    new Map(annotations.map((annotation) => [annotationKey(annotation.role, annotation.id), annotation])),
  );
  const displayedKeys = new Set(displayed.map((entry) => annotationKey(entry.role, entry.id)));
  for (const annotation of annotations) {
    const key = annotationKey(annotation.role, annotation.id);
    if (!displayedKeys.has(key)) {
      throw new Error(
        `${where}: live annotation ${annotation.id} (${annotation.role}) is not displayed by liveCapture.block `
          + '(an annotation for an undisplayed body cannot be measured)',
      );
    }
  }

  if (!fixture.isNoAnswerControl) {
    for (const annotation of annotations) {
      if (annotation.label !== 'answer') continue;
      if (!familyEquivalentIds.has(annotation.id)) {
        throw new Error(
          `${where}: live annotation ${annotation.id} (${annotation.role}) is labelled "answer" but is not in any `
            + 'live expected answer family (add it to a liveExpectedAnswerFamilies.equivalentIds or relabel it)',
        );
      }
    }
  }

  if (fixture.isNoAnswerControl) {
    if (families.length > 0) {
      throw new Error(`${where}: a no-answer control must not declare live expected answer families`);
    }
    if (annotations.some((annotation) => annotation.label === 'answer')) {
      throw new Error(`${where}: a no-answer control must not annotate a live body as answer`);
    }
  }
}

function validateTopicState(topic: SessionShadowTopicState | undefined, where: string): void {
  if (topic === undefined) return;
  if (!topic || typeof topic !== 'object' || Array.isArray(topic)) {
    throw new Error(`${where}: topicState must be an object when present`);
  }
  if (!isNonEmptyString(topic.topic)) throw new Error(`${where}: topicState.topic must be a non-empty string`);
  if (typeof topic.active !== 'boolean') throw new Error(`${where}: topicState.active must be a boolean`);
  for (const key of ['entities', 'aliases', 'retrievalKeys', 'openLoops'] as const) {
    const value = topic[key];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      throw new Error(`${where}: topicState.${key} must be a string[] when present`);
    }
  }
  if (topic.audit !== undefined) {
    if (!topic.audit || typeof topic.audit !== 'object' || Array.isArray(topic.audit)) {
      throw new Error(`${where}: topicState.audit must be an object when present`);
    }
    const reasons = topic.audit.staleRisk;
    if (
      reasons !== undefined
      && (!Array.isArray(reasons) || reasons.some((reason) => !isNonEmptyString(reason)))
    ) {
      throw new Error(`${where}: topicState.audit.staleRisk must be a non-empty string[] when present`);
    }
  }
}

/**
 * Structural + semantic validation of the shadow fixture: P0 validation for the
 * snapshot side, plus the frozen live/topic material. Throws instead of quietly
 * measuring a case it cannot score. Never mutates the fixture.
 */
export function validateSessionShadowFixture(fixture: SessionShadowQualityFixture): true {
  validateSessionSnapshotQualityFixture(fixture);
  const where = `fixture "${fixture.id}"`;
  validateLiveSide(fixture, where);
  validateTopicState(fixture.topicState, where);
  return true;
}

// ── Arm builders ─────────────────────────────────────────────────────────────

interface ArmServeState {
  /** The real `decideSnapshotUse` output (converted to a string for fallbacks). */
  decision: SnapshotDecision;
  served: boolean;
  block: string | null;
  fallbackReason: string | null;
}

/**
 * `current-query-off`: the real decision + FOK gate, then the stored block.
 * Only `adaptSnapshotToCurrentQuery` is skipped.
 */
function evaluateCurrentQueryOff(
  fixture: SessionShadowQualityFixture,
  options: SessionSnapshotQualityOptions,
): ArmServeState {
  const { snapshot } = fixture;
  const decision = decideSnapshotUse(snapshot, fixture.currentQuery, new Date(fixture.now), options.snapshotConfig);
  if (decision !== 'use') return { decision, served: false, block: null, fallbackReason: decision };
  if ((snapshot.fokStatus ?? 'inject') !== 'inject') {
    return { decision, served: false, block: null, fallbackReason: 'fok' };
  }
  if (!snapshot.block) return { decision, served: false, block: null, fallbackReason: 'empty-render' };
  return { decision, served: true, block: snapshot.block, fallbackReason: null };
}

function evaluateSnapshotArm(
  fixture: SessionShadowQualityFixture,
  options: SessionSnapshotQualityOptions,
  topicStaleRisk: string[],
): SessionShadowArmResult {
  const p0 = evaluateSessionSnapshotFixture(fixture, options);
  return {
    ...p0,
    arm: 'snapshot-current',
    replay: false,
    blockSource: p0.served ? (p0.kept.filtered ? 'adapter' : 'stored') : null,
    available: true,
    facetFallback: null,
    topicProvided: fixture.topicState !== undefined,
    topicStaleRisk,
  };
}

function evaluateOffArm(
  fixture: SessionShadowQualityFixture,
  options: SessionSnapshotQualityOptions,
  topicStaleRisk: string[],
): SessionShadowArmResult {
  const state = evaluateCurrentQueryOff(fixture, options);
  const { snapshot } = fixture;
  const scored = scoreServedBlock({
    block: state.block,
    annotations: fixture.annotations,
    expectedAnswerFamilies: fixture.expectedAnswerFamilies,
    isNoAnswerControl: fixture.isNoAnswerControl,
    knownIds: snapshotKnownIds(snapshot),
    preAdmissionPool: fixture.annotations,
  });
  return {
    id: fixture.id,
    origin: fixture.origin,
    currentQuery: fixture.currentQuery,
    isNoAnswerControl: fixture.isNoAnswerControl,
    decision: state.decision,
    fallbackReason: state.fallbackReason,
    served: state.served,
    kept: state.served
      ? keptFromSnapshot(snapshot)
      : { anchors: [], neighbors: [], t1: [], filtered: false },
    servedBlock: state.block,
    displayed: scored.displayed,
    unannotatedDisplayed: scored.unannotatedDisplayed,
    measurementComplete: scored.measurementComplete,
    suppressed: scored.suppressed,
    families: scored.families,
    falseDisplayIds: scored.falseDisplayIds,
    metrics: scored.metrics,
    arm: 'current-query-off',
    replay: false,
    blockSource: state.served ? 'stored' : null,
    available: true,
    facetFallback: null,
    topicProvided: fixture.topicState !== undefined,
    topicStaleRisk,
  };
}

/** A live block is a memory serve only when it actually printed evidence. */
function hasMemoryPointers(block: string): boolean {
  return (block.match(POINTER_RE) ?? []).length > 0 || (block.match(T1_POINTER_RE) ?? []).length > 0;
}

function evaluateLiveArm(
  fixture: SessionShadowQualityFixture,
  topicStaleRisk: string[],
): SessionShadowArmResult {
  const capture = fixture.liveCapture;
  const base = {
    id: fixture.id,
    origin: fixture.origin,
    // The live call had its own input; the snapshot-side `currentQuery` may be a
    // stand-in, so never report it as the live query when the capture recorded one.
    currentQuery: capture?.query ?? fixture.currentQuery,
    isNoAnswerControl: fixture.isNoAnswerControl,
    arm: 'live-frozen' as const,
    replay: false,
    available: capture !== undefined,
    facetFallback: null,
    topicProvided: fixture.topicState !== undefined,
    topicStaleRisk,
  };

  if (!capture) {
    const scored = emptyScore();
    return {
      ...base,
      decision: 'no-snapshot',
      served: false,
      fallbackReason: 'no-live-capture',
      kept: { anchors: [], neighbors: [], t1: [], filtered: false },
      servedBlock: null,
      ...scored,
      blockSource: null,
    };
  }

  const annotations = fixture.liveAnnotations ?? [];
  // Coverage for a live capture is only measured against live-registered
  // families: snapshot families are keyed on snapshot ids and would score a
  // permanent miss for a block that can never display them.
  const families = fixture.liveExpectedAnswerFamilies ?? [];
  // A `<topic-recall>` shell with zero memory/T1 pointers is NOT a served memory
  // block: the live path produced no evidence for this turn. Treating the shell
  // as a serve (or reporting a synthetic `use`) would credit the live path with a
  // decision it never made.
  const served = hasMemoryPointers(capture.block);
  const scored = scoreServedBlock({
    block: served ? capture.block : null,
    annotations,
    expectedAnswerFamilies: families,
    isNoAnswerControl: fixture.isNoAnswerControl,
    knownIds: annotations
      .filter((annotation) => annotation.role !== 't1')
      .map((annotation) => annotation.id),
    // No snapshot pool existed for a live serve: suppression is not measurable.
    preAdmissionPool: null,
  });

  return {
    ...base,
    // A frozen capture has no serve-time decision: `use` means "the captured
    // memory block was served", never a snapshot decision.
    decision: served ? 'use' : 'no-snapshot',
    served,
    fallbackReason: served ? null : 'no-memory-pointers',
    kept: {
      anchors: scored.displayed.filter((entry) => entry.role === 'anchor').map((entry) => entry.id),
      neighbors: scored.displayed.filter((entry) => entry.role === 'neighbor').map((entry) => entry.id),
      t1: scored.displayed.filter((entry) => entry.role === 't1').map((entry) => entry.id),
      filtered: false,
    },
    servedBlock: served ? capture.block : null,
    ...scored,
    blockSource: served ? 'live-capture' : null,
  };
}

/**
 * A domain term carries evidence only when it has at least one word-level unit.
 *
 * `selectLexicallySupportedCandidates` is the shared tokenizer, and it FAILS OPEN
 * by design: `applicable: false` (no token at all) returns every candidate as
 * "supported". That fail-open is right for a boundary veto but wrong for domain
 * evidence, so a term without units (a single CJK character such as 「质」, pure
 * punctuation) must never be probed as if it were an entity. The identity probe
 * asks the tokenizer the same question for the term alone.
 */
function domainTermHasUnits(term: string): boolean {
  return selectLexicallySupportedCandidates([{ primary_abstraction: term }], term).applicable;
}

/** Candidate is domain-supported when its title/cue shares a unit with any usable domain term. */
function domainSupported(candidate: LexicalSupportCandidate, domainTerms: readonly string[]): boolean {
  for (const term of domainTerms) {
    const selection = selectLexicallySupportedCandidates([candidate], term);
    // Belt and braces: `domainTerms` is already filtered to unit-bearing terms.
    if (selection.applicable && selection.supported.length > 0) return true;
  }
  return false;
}

function evaluateFacetArm(
  fixture: SessionShadowQualityFixture,
  options: SessionSnapshotQualityOptions,
  topicStaleRisk: string[],
  fallbackTo: () => SessionShadowArmResult,
): SessionShadowArmResult {
  const { snapshot } = fixture;
  const topic = fixture.topicState;
  const decision = decideSnapshotUse(snapshot, fixture.currentQuery, new Date(fixture.now), options.snapshotConfig);

  // Never reached admission (stale / topic-shift / FOK): nothing to facet, and
  // the facet rule did not decide anything.
  if (decision !== 'use' || (snapshot.fokStatus ?? 'inject') !== 'inject') {
    return { ...fallbackTo(), arm: 'topic-facet', replay: false, facetFallback: null };
  }

  const fallback = (reason: SessionShadowFacetFallback): SessionShadowArmResult => ({
    ...fallbackTo(),
    arm: 'topic-facet',
    replay: false,
    facetFallback: reason,
  });

  if (!topic || !isNonEmptyString(topic.topic)) return fallback('no-topic');
  if (topic.active !== true) return fallback('inactive-topic');
  if (!Array.isArray(snapshot.memories)) return fallback('no-metadata');

  const domainTerms = [...(topic.entities ?? []), ...(topic.aliases ?? []), ...(topic.retrievalKeys ?? [])]
    .filter(isNonEmptyString)
    .map((term) => term.trim())
    // Evidence must be word-level: a unitless term is skipped, and a domain made
    // only of such terms is an EMPTY domain (fall back), never "no candidate
    // matches" (which would silently drop every anchor).
    .filter(domainTermHasUnits);
  if (domainTerms.length === 0) return fallback('empty-domain');

  const topicText = [topic.topic, topic.summary].filter(isNonEmptyString).join(' ');
  if (snapshotContainment(topicText, fixture.currentQuery) < TOPIC_FACET_MIN_CONTAINMENT) {
    return fallback('low-containment');
  }

  const memories = snapshot.memories ?? [];
  const anchorEntries = memories.filter((memory) => memory && !memory.neighborOf);
  const neighborEntries = memories.filter((memory) => memory && !!memory.neighborOf);

  const anchorCandidates = anchorEntries.map(memoryCandidate);
  const anchorSelection = selectLexicallySupportedCandidates(anchorCandidates, fixture.currentQuery);
  if (!anchorSelection.applicable) return fallback('no-query-units');
  const neighborCandidates = neighborEntries.map(memoryCandidate);
  const neighborSelection = selectLexicallySupportedCandidates(neighborCandidates, fixture.currentQuery);
  if (!neighborSelection.applicable) return fallback('no-query-units');

  // Exact evidence is deterministic metadata evidence: it may bypass the domain
  // requirement (a query naming the memory outright is its own domain).
  const exactIds = new Set(
    findExactRecallEvidence(
      memories.map((memory) => ({
        id: memory.id,
        primary_abstraction: memory.abstraction ?? '',
        cue_anchors: Array.isArray(memory.cue_anchors) ? memory.cue_anchors : [],
        ...(memory.type ? { type: memory.type } : {}),
      })),
      fixture.currentQuery,
      Math.max(1, memories.length),
    ).map((evidence) => evidence.entry.id),
  );

  const rawSupportedAnchors = new Set(anchorSelection.supported);
  const keptAnchors = anchorEntries.filter((memory, index) => {
    if (exactIds.has(memory.id)) return true;
    return rawSupportedAnchors.has(anchorCandidates[index])
      && domainSupported(anchorCandidates[index], domainTerms);
  });
  const keptAnchorIds = new Set(keptAnchors.map((memory) => memory.id));
  const rawSupportedNeighbors = new Set(neighborSelection.supported);
  const keptNeighbors = neighborEntries.filter((memory, index) => {
    if (!keptAnchorIds.has(memory.neighborOf as string)) return false;
    if (exactIds.has(memory.id)) return true;
    return rawSupportedNeighbors.has(neighborCandidates[index])
      && domainSupported(neighborCandidates[index], domainTerms);
  });

  const t1MaxChars = options.snapshotConfig?.t1MaxChars ?? SNAPSHOT_DEFAULTS.t1MaxChars;
  const block = renderFacetBlock(snapshot, keptAnchors, keptNeighbors, t1MaxChars);
  const reduced: RecallSnapshot = {
    ...snapshot,
    ids: keptAnchors.map((memory) => memory.id),
    memories: [...keptAnchors, ...keptNeighbors],
    // When the pre-render is null the adapter sees the original block and then
    // falls back itself (`no-current-support` / `empty-render`).
    block: block ?? snapshot.block,
  };

  const adapted = adaptSnapshotToCurrentQuery(reduced, fixture.currentQuery, { t1MaxChars });
  const served = adapted.action === 'serve';
  const servedBlock = served ? adapted.snapshot.block ?? null : null;
  const kept: SessionKeptRoles = served
    ? {
        anchors: [...(adapted.snapshot.ids ?? [])],
        neighbors: (adapted.snapshot.memories ?? [])
          .filter((memory) => Boolean(memory.neighborOf))
          .map((memory) => memory.id),
        t1: adapted.snapshot.t1Rendered === true
          ? (adapted.snapshot.t1Hits ?? [])
              .map((hit) => hit.traceId ?? '')
              .filter((traceId): traceId is string => traceId.length > 0)
          : [],
        filtered: adapted.kept.filtered,
      }
    : { anchors: [], neighbors: [], t1: [], filtered: false };

  const scored = scoreServedBlock({
    block: servedBlock,
    annotations: fixture.annotations,
    expectedAnswerFamilies: fixture.expectedAnswerFamilies,
    isNoAnswerControl: fixture.isNoAnswerControl,
    knownIds: snapshotKnownIds(snapshot),
    preAdmissionPool: fixture.annotations,
  });

  return {
    id: fixture.id,
    origin: fixture.origin,
    currentQuery: fixture.currentQuery,
    isNoAnswerControl: fixture.isNoAnswerControl,
    decision,
    served,
    fallbackReason: served ? null : adapted.reason,
    kept,
    servedBlock,
    displayed: scored.displayed,
    unannotatedDisplayed: scored.unannotatedDisplayed,
    measurementComplete: scored.measurementComplete,
    suppressed: scored.suppressed,
    families: scored.families,
    falseDisplayIds: scored.falseDisplayIds,
    metrics: scored.metrics,
    arm: 'topic-facet',
    replay: true,
    blockSource: served ? 'facet-render' : null,
    available: true,
    facetFallback: null,
    topicProvided: true,
    topicStaleRisk,
  };
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate one frozen case along all four arms. The fixture is validated first
 * and never mutated.
 */
export function evaluateSessionShadowFixture(
  fixture: SessionShadowQualityFixture,
  options: SessionSnapshotQualityOptions = {},
): SessionShadowArms {
  validateSessionShadowFixture(fixture);
  const topicStaleRisk = [...(fixture.topicState?.audit?.staleRisk ?? [])];
  const snapshotArm = evaluateSnapshotArm(fixture, options, topicStaleRisk);
  return {
    'snapshot-current': snapshotArm,
    'current-query-off': evaluateOffArm(fixture, options, topicStaleRisk),
    'live-frozen': evaluateLiveArm(fixture, topicStaleRisk),
    'topic-facet': evaluateFacetArm(fixture, options, topicStaleRisk, () => snapshotArm),
  };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

/**
 * Aggregate per arm with P0's summarizer (numerators/denominators summed, never
 * averaged per-case ratios), then add the arm label, the measured/unmeasured
 * split and the frozen TopicState audit.
 *
 * Unmeasured rows are NEVER fed to the summarizer: with no capture there is
 * nothing to score, so counting it as `notServed`/`fallback` or as a rate
 * denominator would report a failure that was never observed.
 */
export function summarizeSessionShadow(
  results: readonly SessionShadowArmResult[],
): SessionShadowSummary {
  const arms = {} as Record<SessionShadowArm, SessionShadowArmSummary>;
  for (const arm of SESSION_SHADOW_ARMS) {
    const forArm = results.filter((result) => result.arm === arm);
    const measured = forArm.filter((result) => result.available);
    const { results: _perCase, ...aggregate } = summarizeSessionSnapshotQuality(measured);
    arms[arm] = {
      ...aggregate,
      arm,
      cases: forArm.length,
      measuredCases: measured.length,
      unmeasuredCases: forArm.length - measured.length,
      unmeasuredCaseIds: forArm.filter((result) => !result.available).map((result) => result.id),
    };
  }

  const facetFallbacks: Record<string, number> = {};
  const staleRisk: Array<{ caseId: string; reasons: string[] }> = [];
  let casesWithTopic = 0;
  let facetsApplied = 0;
  for (const result of results) {
    if (result.arm === 'snapshot-current') {
      if (result.topicProvided) casesWithTopic++;
      if (result.topicStaleRisk.length > 0) {
        staleRisk.push({ caseId: result.id, reasons: [...result.topicStaleRisk] });
      }
      continue;
    }
    if (result.arm !== 'topic-facet') continue;
    if (result.facetFallback === null && result.served) facetsApplied++;
    if (result.facetFallback !== null) {
      facetFallbacks[result.facetFallback] = (facetFallbacks[result.facetFallback] ?? 0) + 1;
    }
  }

  return {
    cases: new Set(results.map((result) => result.id)).size,
    arms,
    topicAudit: { casesWithTopic, facetsApplied, facetFallbacks, staleRisk },
  };
}
