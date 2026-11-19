/**
 * Session-shaped recall quality evaluator (P0 bootstrap).
 *
 * The unit of measurement is one frozen snapshot serve attempt: a real
 * `RecallSnapshot` replayed with the query the boundary path is fed. For live
 * captures both are recorded; for reconstructed cases the block can be
 * re-rendered and the query can be a frozen stand-in (see each fixture's
 * `origin` — the runner/baseline label them captured vs replayed). The evaluator
 * never re-implements admission — it calls
 * `decideSnapshotUse` and `adaptSnapshotToCurrentQuery` exactly as
 * `routes/recall.ts` does, then scores what the served block actually rendered.
 *
 * Why block-level and annotation-driven: the frozen 40-query set counts an
 * expected id as a hit even when it only appears as a bundled neighbour, so it
 * cannot tell "the block answers the question" from "the block mentions
 * something". The annotation protocol here is `(memory id, rendered role)` with
 * labels `answer | context | noise | repeat | stale-or-conflict`, and only
 * anchors can satisfy answer coverage.
 *
 * Deliberately pure and read-only: no DB, no model calls, no writes, and the
 * fixture is validated (and never mutated) before any decision runs. This is a
 * BOOTSTRAP measurement tool over a handful of real cases, not a benchmark.
 */
import type { RecallSnapshot, SnapshotConfig } from './recall-snapshot';
import { decideSnapshotUse, type SnapshotDecision } from './recall-snapshot';
import { adaptSnapshotToCurrentQuery } from './snapshot-current-query';

// ── Annotation protocol ──────────────────────────────────────────────────────

export const SESSION_ANNOTATION_LABELS = [
  'answer',
  'context',
  'noise',
  'repeat',
  'stale-or-conflict',
] as const;

export type SessionAnnotationLabel = (typeof SESSION_ANNOTATION_LABELS)[number];

export type SessionAnnotationRole = 'anchor' | 'neighbor' | 't1';

/**
 * One frozen judgement about one pre-admission candidate.
 *
 * `role` is the role the candidate actually had in the snapshot (anchor /
 * bundled neighbour / T1 evidence); annotating a different role is a fixture
 * bug, not a reclassification. `id` is the memory id for anchor/neighbour and
 * the T1 `traceId` for T1 evidence.
 */
export interface SessionSnapshotAnnotation {
  id: string;
  role: SessionAnnotationRole;
  label: SessionAnnotationLabel;
  /** Optional free-text adjudication note (kept in the fixture, not scored). */
  note?: string;
}

/**
 * A pre-registered answer family: a reference statement plus the frozen ids
 * that are genuinely equivalent answers. Coverage requires the family's ids to
 * be displayed as ANCHORS — a neighbour-only appearance never counts.
 */
export interface ExpectedAnswerFamily {
  id: string;
  statement: string;
  equivalentIds: string[];
}

export interface SessionSnapshotQualityFixture {
  id: string;
  /**
   * Provenance of the frozen case. Must say whether it was captured or
   * replayed/reconstructed (a re-rendered block or a stand-in query is not a
   * captured serve).
   */
  origin: string;
  /**
   * The query the boundary path is replayed with. Recorded for captured live
   * cases; a reconstructed case may use a frozen stand-in instead (see `origin`)
   * because the serve-time input was not captured.
   */
  currentQuery: string;
  /** ISO time used for the TTL decision (frozen so runs are deterministic). */
  now: string;
  snapshot: RecallSnapshot;
  /** Exactly one annotation per pool candidate / T1 hit. */
  annotations: SessionSnapshotAnnotation[];
  expectedAnswerFamilies: ExpectedAnswerFamily[];
  /** True for no-answer / same-domain negative controls. */
  isNoAnswerControl: boolean;
}

export interface SessionSnapshotQualityOptions {
  /**
   * Production snapshot config, for route parity: `ttlMs` and
   * `topicShiftThreshold` drive `decideSnapshotUse`, `t1MaxChars` drives the
   * adapter's T1 render budget. `enabled` is deliberately NOT used — the
   * evaluator measures the serve path itself, so a deployment with snapshots
   * switched off can still replay these frozen serve attempts.
   */
  snapshotConfig?: SnapshotConfig;
}

// ── Metrics ──────────────────────────────────────────────────────────────────

/**
 * A ratio with its raw counts. `value` is `null` when the denominator is 0 —
 * an empty denominator is "not measured", never 100%.
 */
export interface QualityRate {
  numerator: number;
  denominator: number;
  value: number | null;
}

export interface SessionDisplayedEntry {
  id: string;
  role: SessionAnnotationRole;
  /** `null` when the rendered pointer has no annotation (unknown / mismatched). */
  label: SessionAnnotationLabel | null;
}

/** A rendered pointer the fixture does not annotate (measurement gap, not noise). */
export interface UnannotatedDisplayedEntry {
  id: string;
  role: SessionAnnotationRole;
}

export interface SessionKeptRoles {
  /** Anchor ids in admission order (`served.ids`). */
  anchors: string[];
  /** Bundled neighbour ids retained by admission (`neighborOf`). */
  neighbors: string[];
  /** T1 traceIds that were rendered. */
  t1: string[];
  /** True when the serve-time gate removed or de-duplicated something. */
  filtered: boolean;
}

export interface SessionFamilyResult {
  id: string;
  statement: string;
  covered: boolean;
  matchedIds: string[];
}

export interface SessionSnapshotQualityMetrics {
  usefulAnchorPrecision: QualityRate;
  answerCoverage: QualityRate;
  falseDisplay: QualityRate;
  legitimateSuppression: QualityRate;
  /** Diagnostic: answer|context share among displayed neighbours. */
  neighborPrecision: QualityRate;
  /** Diagnostic: displayed T1 lines that merely repeat other evidence. */
  t1Repeat: QualityRate;
}

export interface SessionSnapshotQualityResult {
  id: string;
  origin: string;
  currentQuery: string;
  isNoAnswerControl: boolean;
  /** Raw `decideSnapshotUse` output (computed with the supplied snapshot config). */
  decision: SnapshotDecision;
  /** True only when a block was actually served (route parity with FOK=inject). */
  served: boolean;
  /**
   * Why nothing was served: the decision (`stale` / `topic-shift` /
   * `no-snapshot`), `fok`, or the adapter reason (`no-current-support` …).
   */
  fallbackReason: string | null;
  kept: SessionKeptRoles;
  /** The exact served block, or `null` when nothing was served. */
  servedBlock: string | null;
  /** What the served block actually rendered, in render order. */
  displayed: SessionDisplayedEntry[];
  /**
   * Displayed pointers without an annotation. They are a measurement gap (the
   * metrics below treat them as not-proven-useful) and are never reclassified
   * as noise; `measurementComplete` is false whenever this list is non-empty.
   */
  unannotatedDisplayed: UnannotatedDisplayedEntry[];
  measurementComplete: boolean;
  /** Pre-admission answer|context candidates that were NOT displayed (served cases only). */
  suppressed: Array<{ id: string; label: SessionAnnotationLabel }>;
  families: SessionFamilyResult[];
  /** Noise ids actually rendered on a no-answer control (empty otherwise). */
  falseDisplayIds: string[];
  metrics: SessionSnapshotQualityMetrics;
}

export interface SessionSnapshotQualitySummary extends SessionSnapshotQualityMetrics {
  cases: number;
  answerableCases: number;
  noAnswerControls: number;
  serve: {
    served: number;
    /** Serves where the current-query gate removed/de-duplicated something. */
    filtered: number;
    /** Cases where no snapshot block was served at all. */
    fallback: number;
    /** Same count as `fallback`, named for the suppression/quality gates. */
    notServed: number;
    decisions: Record<string, number>;
    fallbackReasons: Record<string, number>;
  };
  /** Every noise body actually displayed across no-answer controls. */
  falseDisplayIds: string[];
  /** Every pre-admission answer|context candidate dropped across served cases. */
  suppressedIds: string[];
  /** Displayed pointers with no annotation, across all cases. */
  unannotatedDisplayed: Array<UnannotatedDisplayedEntry & { caseId: string }>;
  /**
   * False when any case displayed an unannotated pointer: the rates below are
   * then incomplete (never silently optimistic).
   */
  measurementComplete: boolean;
  /** Human-readable warnings for incomplete measurement. */
  warnings: string[];
  /** Per-case results, preserved verbatim. */
  results: SessionSnapshotQualityResult[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

const USEFUL_LABELS = new Set<SessionAnnotationLabel>(['answer', 'context']);
const ANNOTATION_ROLES = new Set<SessionAnnotationRole>(['anchor', 'neighbor', 't1']);
const LABELS = new Set<string>(SESSION_ANNOTATION_LABELS);

const POINTER_RE = /#mem-([0-9a-z]{6})(?![0-9a-z])/g;
const T1_POINTER_RE = /\[t1\|([^\]]+)\]/g;
/**
 * A neighbour line STARTS with the `↳` marker (`  ↳ - #mem-…`). Anchor lines can
 * also contain `↳` further right (`… (E:0.8) ↳ gist 已蒸馏…`), so anchoring on
 * `includes('↳')` would demote a real anchor to a neighbour.
 */
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

/** All full ids the fixture can render (structured memories + topK ids). */
function knownIds(snapshot: RecallSnapshot): string[] {
  const out = new Set<string>();
  for (const memory of snapshot.memories ?? []) {
    if (isNonEmptyString(memory?.id)) out.add(memory.id);
  }
  for (const id of snapshot.ids ?? []) {
    if (isNonEmptyString(id)) out.add(id);
  }
  return [...out];
}

/** Pointer tails (`#mem-xxxxxx`) resolve to the frozen full ids. */
function buildTailIndex(snapshot: RecallSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  for (const id of knownIds(snapshot)) index.set(id.slice(-6), id);
  return index;
}

/**
 * Parse the served block into displayed entries (role + annotation label).
 *
 * The block is the ground truth for "what the user saw": `served.memories` is
 * the receipt source and may list more neighbours than the renderer printed, so
 * display accounting must read the rendered lines. Unknown pointers are kept
 * with a `null` label — an unannotated display is counted as not-proven-useful,
 * never silently dropped.
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
    // `↳` at the start of the line marks a bundled neighbour; a gist hint later
    // on an anchor line must not reclassify that anchor.
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

// ── Fixture validation ───────────────────────────────────────────────────────

/**
 * Structural + semantic fixture validation. Throws on anything that would make
 * a case silently unmeasured: unknown/missing annotations, contradictory roles,
 * ambiguous pointer tails, duplicate family ids, or a "no-answer" control that
 * actually contains answers.
 */
export function validateSessionSnapshotQualityFixture(fixture: SessionSnapshotQualityFixture): true {
  if (!fixture || typeof fixture !== 'object') throw new Error('fixture must be an object');
  if (!isNonEmptyString(fixture.id)) throw new Error('fixture.id must be a non-empty string');
  const where = `fixture "${fixture.id}"`;

  if (!isNonEmptyString(fixture.origin)) throw new Error(`${where}: origin must be a non-empty string`);
  if (!isNonEmptyString(fixture.currentQuery)) {
    throw new Error(`${where}: currentQuery must be a non-empty string`);
  }
  if (!isNonEmptyString(fixture.now) || Number.isNaN(Date.parse(fixture.now))) {
    throw new Error(`${where}: now must be a parseable ISO timestamp`);
  }
  if (typeof fixture.isNoAnswerControl !== 'boolean') {
    throw new Error(`${where}: isNoAnswerControl must be a boolean`);
  }

  const snapshot = fixture.snapshot;
  if (!snapshot || typeof snapshot !== 'object') throw new Error(`${where}: snapshot must be an object`);
  if (!isNonEmptyString(snapshot.block)) throw new Error(`${where}: snapshot.block must be a non-empty string`);
  if (!isNonEmptyString(snapshot.builtAt) || Number.isNaN(Date.parse(snapshot.builtAt))) {
    throw new Error(`${where}: snapshot.builtAt must be a parseable ISO timestamp`);
  }
  if (!Array.isArray(snapshot.ids) || snapshot.ids.some((id) => !isNonEmptyString(id))) {
    throw new Error(`${where}: snapshot.ids must be a string[]`);
  }
  if (snapshot.memories !== undefined) {
    if (!Array.isArray(snapshot.memories)) throw new Error(`${where}: snapshot.memories must be an array when present`);
    for (const memory of snapshot.memories) {
      if (!memory || !isNonEmptyString(memory.id)) {
        throw new Error(`${where}: every snapshot.memories entry needs a non-empty id`);
      }
    }
  }
  const t1Hits = Array.isArray(snapshot.t1Hits) ? snapshot.t1Hits : [];
  for (const hit of t1Hits) {
    if (!hit || !isNonEmptyString(hit.traceId)) {
      throw new Error(`${where}: every snapshot.t1Hits entry needs a traceId to be annotatable`);
    }
  }
  // Frozen after the check above: every T1 hit must be annotatable.
  const t1TraceIds = t1Hits.map((hit) => hit.traceId as string);

  // The pre-admission pool and the role each entry actually had.
  const pool: Array<{ id: string; role: 'anchor' | 'neighbor' }> = Array.isArray(snapshot.memories)
    ? snapshot.memories.map((memory) => ({
        id: memory.id,
        role: memory.neighborOf ? 'neighbor' : 'anchor',
      }))
    : snapshot.ids.map((id) => ({ id, role: 'anchor' as const }));

  const tails = new Map<string, string>();
  for (const id of new Set(knownIds(snapshot))) {
    const tail = id.slice(-6);
    const previous = tails.get(tail);
    if (previous && previous !== id) {
      throw new Error(`${where}: memory ids "${previous}" and "${id}" share pointer tail "${tail}"`);
    }
    tails.set(tail, id);
  }

  if (!Array.isArray(fixture.annotations)) throw new Error(`${where}: annotations must be an array`);
  const seen = new Set<string>();
  for (const annotation of fixture.annotations) {
    if (!annotation || typeof annotation !== 'object') {
      throw new Error(`${where}: every annotation must be an object`);
    }
    if (!isNonEmptyString(annotation.id)) {
      throw new Error(`${where}: annotation is missing a non-empty id`);
    }
    if (!LABELS.has(annotation.label)) {
      throw new Error(`${where}: unknown annotation label "${annotation.label}" for ${annotation.id}`);
    }
    if (!ANNOTATION_ROLES.has(annotation.role)) {
      throw new Error(`${where}: unknown annotation role "${annotation.role}" for ${annotation.id}`);
    }
    if (annotation.role === 't1') {
      if (!t1TraceIds.includes(annotation.id)) {
        throw new Error(`${where}: unknown annotation id "${annotation.id}" (no T1 hit with that traceId)`);
      }
    } else {
      const entry = pool.find((candidate) => candidate.id === annotation.id);
      if (!entry) {
        throw new Error(
          `${where}: unknown annotation id "${annotation.id}" (not in the pre-admission snapshot pool)`,
        );
      }
      if (entry.role !== annotation.role) {
        throw new Error(
          `${where}: role mismatch for ${annotation.id} (snapshot role is ${entry.role}, annotated ${annotation.role})`,
        );
      }
    }
    const key = annotationKey(annotation.role, annotation.id);
    if (seen.has(key)) {
      throw new Error(`${where}: duplicate annotation role ${annotation.role} for ${annotation.id}`);
    }
    seen.add(key);
  }

  // Nothing may be displayed (or dropped) unmeasured.
  for (const entry of pool) {
    if (!seen.has(annotationKey(entry.role, entry.id))) {
      throw new Error(`${where}: missing annotation for ${entry.role} ${entry.id}`);
    }
  }
  for (const traceId of t1TraceIds) {
    if (!seen.has(annotationKey('t1', traceId))) {
      throw new Error(`${where}: missing annotation for t1 ${traceId}`);
    }
  }

  if (!Array.isArray(fixture.expectedAnswerFamilies)) {
    throw new Error(`${where}: expectedAnswerFamilies must be an array`);
  }
  const familyIds = new Set<string>();
  const familyEquivalentIds = new Set<string>();
  for (const family of fixture.expectedAnswerFamilies) {
    if (!family || !isNonEmptyString(family.id)) {
      throw new Error(`${where}: every expected answer family needs a non-empty id`);
    }
    if (familyIds.has(family.id)) throw new Error(`${where}: duplicate expected answer family id "${family.id}"`);
    familyIds.add(family.id);
    if (!isNonEmptyString(family.statement)) {
      throw new Error(`${where}: expected answer family "${family.id}" needs a reference statement`);
    }
    if (
      !Array.isArray(family.equivalentIds)
      || family.equivalentIds.length === 0
      || family.equivalentIds.some((id) => !isNonEmptyString(id))
    ) {
      throw new Error(`${where}: expected answer family "${family.id}" needs a non-empty equivalentIds string[]`);
    }
    for (const equivalentId of family.equivalentIds) familyEquivalentIds.add(equivalentId);
  }

  // An `answer` label claims "this body answers the frozen query". Coverage is
  // only measurable for pre-registered answers, so an answer label outside every
  // family would silently never be counted (and the family denominator would
  // ignore it) — reject instead of measuring a case that cannot be scored.
  if (!fixture.isNoAnswerControl) {
    for (const annotation of fixture.annotations) {
      if (annotation.label !== 'answer') continue;
      if (!familyEquivalentIds.has(annotation.id)) {
        throw new Error(
          `${where}: annotation ${annotation.id} (${annotation.role}) is labelled "answer" but is not in any `
            + 'expected answer family (add it to a family.equivalentIds or relabel it)',
        );
      }
    }
  }

  if (fixture.isNoAnswerControl) {
    if (fixture.expectedAnswerFamilies.length > 0) {
      throw new Error(`${where}: a no-answer control must not declare expectedAnswerFamilies`);
    }
    if (fixture.annotations.some((annotation) => annotation.label === 'answer')) {
      throw new Error(`${where}: a no-answer control must not annotate any candidate as answer`);
    }
  }

  return true;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/**
 * Evaluate one frozen fixture with the REAL decision + adapter, then score the
 * rendered block. The fixture is validated first and never mutated.
 */
export function evaluateSessionSnapshotFixture(
  fixture: SessionSnapshotQualityFixture,
  options: SessionSnapshotQualityOptions = {},
): SessionSnapshotQualityResult {
  validateSessionSnapshotQualityFixture(fixture);

  const { snapshot } = fixture;
  const snapshotConfig = options.snapshotConfig;
  const decision = decideSnapshotUse(snapshot, fixture.currentQuery, new Date(fixture.now), snapshotConfig);

  let served = false;
  let fallbackReason: string | null = decision === 'use' ? null : decision;
  let kept: SessionKeptRoles = { anchors: [], neighbors: [], t1: [], filtered: false };
  let displayed: SessionDisplayedEntry[] = [];
  let servedBlock: string | null = null;

  if (decision === 'use') {
    // Route parity: a snapshot whose built-in FOK zone is not `inject` is not
    // served by the boundary path, even when the topic check passed.
    if ((snapshot.fokStatus ?? 'inject') !== 'inject') {
      fallbackReason = 'fok';
    } else {
      const adapted = adaptSnapshotToCurrentQuery(snapshot, fixture.currentQuery, {
        ...(typeof snapshotConfig?.t1MaxChars === 'number' ? { t1MaxChars: snapshotConfig.t1MaxChars } : {}),
      });
      if (adapted.action === 'fallback') {
        fallbackReason = adapted.reason;
      } else {
        served = true;
        fallbackReason = null;
        servedBlock = adapted.snapshot.block ?? null;
        kept = {
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
        };
        displayed = parseDisplayedBlock(
          adapted.snapshot.block ?? '',
          buildTailIndex(snapshot),
          new Map(fixture.annotations.map((annotation) => [annotationKey(annotation.role, annotation.id), annotation])),
        );
      }
    }
  }

  const displayedAnchors = displayed.filter((entry) => entry.role === 'anchor');
  const displayedNeighbors = displayed.filter((entry) => entry.role === 'neighbor');
  const displayedT1 = displayed.filter((entry) => entry.role === 't1');
  const displayedMemory = displayed.filter((entry) => entry.role !== 't1');

  // Rendering a pointer the fixture never annotated is a measurement gap, not
  // evidence of noise; surface it so the rates cannot look better than they are.
  const unannotatedDisplayed: UnannotatedDisplayedEntry[] = displayed
    .filter((entry) => entry.label === null)
    .map((entry) => ({ id: entry.id, role: entry.role }));

  const anchorIds = new Set(displayedAnchors.map((entry) => entry.id));
  const families: SessionFamilyResult[] = fixture.expectedAnswerFamilies.map((family) => {
    const matchedIds = family.equivalentIds.filter((id) => anchorIds.has(id));
    return { id: family.id, statement: family.statement, covered: matchedIds.length > 0, matchedIds };
  });

  const usefulAnchors = displayedAnchors.filter((entry) => isUseful(entry.label)).length;
  const usefulNeighbors = displayedNeighbors.filter((entry) => isUseful(entry.label)).length;

  // Suppression is scoped to the PRE-ADMISSION pool: a newly retrieved answer
  // that never entered the snapshot is a pool miss, not a suppressed candidate.
  //
  // It is also only measured on a SERVED case: `stale` / `topic-shift` / FOK
  // fallbacks show nothing at all, so counting their answer candidates as
  // "suppressed" would report a 100% loss caused by the fallback itself. On a
  // served case the drop can come from either the current-query admission gate
  // or the render budget (formatRecallContext's 3-anchor / neighbour caps).
  const poolCandidates = served
    ? fixture.annotations.filter((annotation) => annotation.role !== 't1' && isUseful(annotation.label))
    : [];
  const displayedMemoryIds = new Set(displayedMemory.map((entry) => entry.id));
  const suppressed = poolCandidates
    .filter((annotation) => !displayedMemoryIds.has(annotation.id))
    .map((annotation) => ({ id: annotation.id, label: annotation.label }));

  // False display is a control-level safety signal: did an unanswerable turn
  // show a noise body? The ids are reported so the mis-display stays auditable.
  const falseDisplayIds = fixture.isNoAnswerControl
    ? displayedMemory.filter((entry) => entry.label === 'noise').map((entry) => entry.id)
    : [];
  const falseDisplay = fixture.isNoAnswerControl
    ? rate(falseDisplayIds.length > 0 ? 1 : 0, 1)
    : rate(0, 0);

  const coveredFamilies = families.filter((family) => family.covered).length;
  const repeatedT1 = displayedT1.filter((entry) => entry.label === 'repeat').length;

  return {
    id: fixture.id,
    origin: fixture.origin,
    currentQuery: fixture.currentQuery,
    isNoAnswerControl: fixture.isNoAnswerControl,
    decision,
    served,
    fallbackReason,
    kept,
    servedBlock,
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
      legitimateSuppression: rate(suppressed.length, poolCandidates.length),
      neighborPrecision: rate(usefulNeighbors, displayedNeighbors.length),
      t1Repeat: rate(repeatedT1, displayedT1.length),
    },
  };
}

// ── Aggregation ──────────────────────────────────────────────────────────────

const RATE_KEYS = [
  'usefulAnchorPrecision',
  'answerCoverage',
  'falseDisplay',
  'legitimateSuppression',
  'neighborPrecision',
  't1Repeat',
] as const;

function bump(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

/**
 * Aggregate per-case numerators/denominators (never average per-case ratios, so
 * a case with more displayed anchors weighs what it actually displayed) and
 * keep the per-case rows for the report.
 */
export function summarizeSessionSnapshotQuality(
  results: readonly SessionSnapshotQualityResult[],
): SessionSnapshotQualitySummary {
  const totals = Object.fromEntries(RATE_KEYS.map((key) => [key, { numerator: 0, denominator: 0 }])) as Record<
    (typeof RATE_KEYS)[number],
    { numerator: number; denominator: number }
  >;

  const serve: SessionSnapshotQualitySummary['serve'] = {
    served: 0,
    filtered: 0,
    fallback: 0,
    notServed: 0,
    decisions: {},
    fallbackReasons: {},
  };
  const falseDisplayIds: string[] = [];
  const suppressedIds: string[] = [];
  const unannotatedDisplayed: SessionSnapshotQualitySummary['unannotatedDisplayed'] = [];
  const warnings: string[] = [];

  for (const result of results) {
    if (result.served) serve.served++;
    else {
      serve.fallback++;
      serve.notServed++;
    }
    if (result.served && result.kept.filtered) serve.filtered++;
    bump(serve.decisions, result.decision);
    if (result.fallbackReason) bump(serve.fallbackReasons, result.fallbackReason);

    for (const key of RATE_KEYS) {
      totals[key].numerator += result.metrics[key].numerator;
      totals[key].denominator += result.metrics[key].denominator;
    }
    for (const id of result.falseDisplayIds) falseDisplayIds.push(id);
    for (const entry of result.suppressed) suppressedIds.push(entry.id);

    if (result.unannotatedDisplayed.length > 0) {
      const listed = result.unannotatedDisplayed.map((entry) => `${entry.id} [${entry.role}]`).join(', ');
      for (const entry of result.unannotatedDisplayed) {
        unannotatedDisplayed.push({ caseId: result.id, ...entry });
      }
      warnings.push(
        `${result.id}: ${result.unannotatedDisplayed.length} displayed pointer(s) have no annotation (${listed}); `
          + (result.isNoAnswerControl
            ? 'falseDisplay for this control may under-report — inspect them manually'
            : 'they are counted as not-proven-useful, not as noise'),
      );
    }
  }

  return {
    cases: results.length,
    answerableCases: results.filter((result) => !result.isNoAnswerControl).length,
    noAnswerControls: results.filter((result) => result.isNoAnswerControl).length,
    serve,
    usefulAnchorPrecision: rate(
      totals.usefulAnchorPrecision.numerator,
      totals.usefulAnchorPrecision.denominator,
    ),
    answerCoverage: rate(totals.answerCoverage.numerator, totals.answerCoverage.denominator),
    falseDisplay: rate(totals.falseDisplay.numerator, totals.falseDisplay.denominator),
    legitimateSuppression: rate(
      totals.legitimateSuppression.numerator,
      totals.legitimateSuppression.denominator,
    ),
    neighborPrecision: rate(totals.neighborPrecision.numerator, totals.neighborPrecision.denominator),
    t1Repeat: rate(totals.t1Repeat.numerator, totals.t1Repeat.denominator),
    falseDisplayIds,
    suppressedIds,
    unannotatedDisplayed,
    measurementComplete: unannotatedDisplayed.length === 0,
    warnings,
    results: [...results],
  };
}
