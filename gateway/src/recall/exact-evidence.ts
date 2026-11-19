/**
 * P1 deterministic exact-evidence admission for boundary recall.
 *
 * Why this exists: the FOK gate reads only the raw BM25 distribution
 * (`top1/mean`, see fok-gate.ts). Several same-strength exact hits flatten that
 * ratio, so a query that the REST/MCP surface confidently resolves can still be
 * classified `no-memory` at the boundary and disappear at the route exit
 * (`2026-11-18-auto-recall-fok-divergence.md`).
 *
 * This module adds an independent, deterministic admission signal built ONLY
 * from index metadata (`primary_abstraction`, `cue_anchors`) — no body reads,
 * no embeddings, no reranker. Evidence must be externally verifiable:
 *
 *   - full normalized title equality;
 *   - the whole query is an identifier (camel / snake / path / 7–40 hex commit)
 *     that appears verbatim as a cue anchor;
 *   - a distinctive cue anchor is contained in the query (length ≥12 ASCII or
 *     ≥6 CJK chars, document frequency ≤5, and it covers ≥50% of the query's
 *     non-space characters).
 *
 * Ordinary low/medium BM25 candidates never qualify, so the existing rule
 * "non-inject bodies stay suppressed" is preserved. Superseded, retracted, and
 * unpinned/unsticky legacy `episodic` entries are never admissible.
 */
import type { RecallMemory } from './recall-context';
import type { FokZone } from './fok-gate';

export interface ExactRecallEvidence {
  entry: any;
  kind: 'title' | 'identifier' | 'cue';
  specificity: number;
}

/** ASCII phrase length required for a contained cue (excluding whitespace). */
const MIN_ASCII_CUE_CHARS = 12;
/** CJK phrase length required for a contained cue. */
const MIN_CJK_CUE_CHARS = 6;
/** Cues in more than this many documents are generic, not identifying. */
const MAX_CUE_DOCUMENT_FREQUENCY = 5;
/** The cue must cover at least this share of the query's non-space chars. */
const MIN_CUE_QUERY_COVERAGE = 0.5;

const KIND_SPECIFICITY = { title: 3, identifier: 2, cue: 1 } as const;

const ASCII_NON_SPACE_RE = /[\x21-\x7e]/g;
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const HEX_ID_RE = /^[0-9a-f]{7,40}$/;
const SNAKE_ID_RE = /^[a-z0-9]+(?:_[a-z0-9]+)+$/;
const PATH_ID_RE = /^(?:[a-z0-9._~-]+\/)+[a-z0-9._~-]+$/;
const CAMEL_ID_RE = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+$/;
const PASCAL_ID_RE = /^(?:[A-Z][a-z0-9]*){2,}$/;
/** Inputs where NFKC / whitespace collapse can change the string. */
const NEEDS_NORMALIZATION_RE = /[\uff00-\uffef\u3000]|\s{2,}|^\s|\s$/;
/** Cue fast path: lowercase printable ASCII is already NFKC-stable; whitespace
 *  is removed afterwards anyway, so only case/compatibility needs a rewrite. */
const CUE_NEEDS_NORMALIZATION_RE = /[A-Z]|[^\x20-\x7e]/;

/**
 * Normalization used for every exact comparison: NFKC, lowercase, collapse
 * whitespace, trim. The same function must be used on the query and on every
 * index phrase so equality/containment is symmetric.
 */
export function normalizeRecallText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function compactRecallText(value: string): string {
  return value.replace(/\s/g, '');
}

/** Whole-query identifier token (normalized), or null for natural language. */
function identifierToken(rawQuery: string, normalizedQuery: string): string | null {
  if (!normalizedQuery) return null;
  if (HEX_ID_RE.test(normalizedQuery)) return normalizedQuery;
  if (SNAKE_ID_RE.test(normalizedQuery)) return normalizedQuery;
  if (PATH_ID_RE.test(normalizedQuery)) return normalizedQuery;
  if (CAMEL_ID_RE.test(rawQuery) || PASCAL_ID_RE.test(rawQuery)) return normalizedQuery;
  return null;
}

/** Explicit retraction fields are not part of the harmonic index schema today,
 *  but a writer may add them; treat any truthy marker as ineligible. */
function isRetracted(entry: any): boolean {
  for (const key of ['retracted', 'is_retracted', 'retracted_at', 'retracted_by']) {
    const value = entry?.[key];
    if (value === true) return true;
    if (typeof value === 'string' && value.trim() !== '') return true;
    if (typeof value === 'number' && value > 0) return true;
  }
  return false;
}

function isStickyActive(entry: any, now: number): boolean {
  const raw = entry?.sticky_until;
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  const ms = Date.parse(raw);
  // Malformed dates fail open (still on the note board), mirroring note-board.
  return Number.isNaN(ms) ? true : ms > now;
}

/**
 * Admission eligibility. Superseded chains are evaluated per active head only:
 * the superseded unit is dropped, the replacement is judged on its own data.
 * `episodic` is the retired cortical type; only an explicitly surfaced
 * (pinned / still-sticky) legacy episodic unit may be admitted.
 */
export function isExactEvidenceEligible(entry: any, now: number = Date.now()): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.id !== 'string' || entry.id === '') return false;
  if (entry.superseded_by) return false;
  if (isRetracted(entry)) return false;
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  if (type === 'episodic' && entry.pinned !== true && !isStickyActive(entry, now)) return false;
  return true;
}

function cueCharCounts(compactCue: string): { ascii: number; cjk: number } {
  return {
    ascii: (compactCue.match(ASCII_NON_SPACE_RE) || []).length,
    cjk: (compactCue.match(CJK_RE) || []).length,
  };
}

function isDistinctiveCueLength(compactCue: string): boolean {
  const { ascii, cjk } = cueCharCounts(compactCue);
  return ascii >= MIN_ASCII_CUE_CHARS || cjk >= MIN_CJK_CUE_CHARS;
}

function normalizeCue(cue: string): string | null {
  // The vast majority of cue anchors are already lowercase printable ASCII;
  // reusing the raw string avoids ~155k NFKC allocations on the first boundary
  // scan. Whitespace is removed below, so runs/edges need no separate rewrite.
  const normalized = CUE_NEEDS_NORMALIZATION_RE.test(cue) ? normalizeRecallText(cue) : cue;
  if (!normalized) return null;
  return /\s/.test(normalized) ? compactRecallText(normalized) : normalized;
}

// Normalized cues are immutable for a given anchors ARRAY: production writers
// (kernel dupCandidate / gliner harvest) can assign a fresh `cue_anchors` array
// to the SAME entry object, so keying by the entry would keep serving the old
// anchors. The array itself is replaced on those writes, making it the correct
// cache identity. The route calls this every turn over ~16k entries; compact
// forms are cached so the scan does no per-cue string work when warm.
interface NormalizedCues {
  /** Every cue, NFKC + lowercase + all whitespace removed. */
  compact: string[];
}

const normalizedCueCache = new WeakMap<object, NormalizedCues>();

/**
 * Test-only observability for the versioned index. Production reads go through
 * `findExactRecallEvidence` itself; these counters exist so the unit tests can
 * prove one build per version (timing alone is too noisy to assert on).
 */
export interface ExactEvidenceCacheStats {
  /** Number of full index builds since the last reset. */
  builds: number;
  /** `searchVersion` of the resident index (null when empty). */
  version: number | null;
  /** Entry count of the resident index (null when empty). */
  entries: number | null;
}

/**
 * Immutable per-version view of the harmonic index for exact evidence.
 *
 * Only *normalized index metadata* is cached — never an eligibility verdict
 * (`superseded_by` / `retracted` / pinned-episodic / sticky expiry are all
 * evaluated at query time) and never a query result.
 *
 * Grouping rules:
 *   - `cueEntries`: compact cue → entries that carry it, deduped per entry, so
 *     `.length` IS the document frequency the DF ceiling counts.
 *   - `distinctiveCues`: the compact cues that pass the length rule. The query
 *     path only probes this set for its own substrings; `cueLengths` is the
 *     ascending bucket list that keeps the substring scan O(query × buckets)
 *     instead of O(query²).
 *   - `titlesByLower` / `titlesByNormalized`: the two raw-title surfaces the
 *     uncached equality branch reads (`lowerTitle === normalizedQuery` and the
 *     NFKC-normalized comparison, the latter only when normalization is
 *     permitted for that raw title) — so no title is re-normalized per turn.
 *   - `positions`: entry object → physical position, so candidate evidence can
 *     be replayed in index order (duplicate ids keep their separate order).
 */
interface ExactEvidenceIndex {
  version: number;
  entriesRef: readonly any[];
  /** `entry.cue_anchors` references at build time (in-place swap invalidates). */
  anchorRefs: readonly any[];
  cueEntries: Map<string, any[]>;
  distinctiveCues: Set<string>;
  cueLengths: number[];
  titlesByLower: Map<string, any[]>;
  titlesByNormalized: Map<string, any[]>;
  positions: Map<any, number>;
}

let exactEvidenceIndex: ExactEvidenceIndex | null = null;
let exactEvidenceBuilds = 0;

export function exactEvidenceCacheStatsForTest(): ExactEvidenceCacheStats {
  return {
    builds: exactEvidenceBuilds,
    version: exactEvidenceIndex?.version ?? null,
    entries: exactEvidenceIndex?.entriesRef.length ?? null,
  };
}

/** Test hook: drop the versioned index and reset the build counter. */
export function resetExactEvidenceCacheForTest(): void {
  exactEvidenceIndex = null;
  exactEvidenceBuilds = 0;
}

/**
 * Invalidation check. The version is the authority; the array identity check
 * guards direct index surgery. Element-wise comparison also treats a fresh
 * array wrapper over the SAME entry objects as the same corpus — that is what
 * `HarmonicIndexManager.getIndex()` returns on every turn (it copies the array,
 * not the entries), so a strict `===` would rebuild the index every request and
 * the cache would never be warm in production.
 *
 * Anchor references are compared on every call — even when the wrapper is
 * identical — because production writers may assign a fresh `cue_anchors` array
 * to the same entry object, and `normalizedCues` treats that array as the cache
 * identity. A swapped anchors array invalidates here even without a version
 * bump (cost: one property read per entry, still far below the full scan).
 */
function isSameEntrySet(entries: readonly any[]): boolean {
  const current = exactEvidenceIndex;
  if (!current) return false;
  if (current.entriesRef.length !== entries.length) return false;
  if (current.entriesRef !== entries) {
    for (let i = 0; i < entries.length; i++) {
      if (current.entriesRef[i] !== entries[i]) return false;
    }
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (current.anchorRefs[i] !== (entry && (entry as any).cue_anchors)) return false;
  }
  return true;
}

function buildExactEvidenceIndex(
  entries: readonly any[],
  version: number,
): ExactEvidenceIndex {
  const cueEntries = new Map<string, any[]>();
  const distinctiveCues = new Set<string>();
  const titlesByLower = new Map<string, any[]>();
  const titlesByNormalized = new Map<string, any[]>();
  const positions = new Map<any, number>();
  const anchorRefs: any[] = new Array(entries.length);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    positions.set(entry, i);
    anchorRefs[i] = entry && (entry as any).cue_anchors;
    if (!entry || typeof entry !== 'object') continue;

    // Reproduce the exact title predicate of the uncached pass. The raw
    // lowercase surface covers `lowerTitle === normalizedQuery`; the normalized
    // surface covers the NFKC comparison, which the uncached pass only consults
    // when the raw title needs normalization or the length delta is ≤ 2 (a
    // query-independent flag). Titles where NFKC expands by > 2 chars and the
    // heuristic regex does not fire are rejected by both paths.
    const rawTitle = String(entry.primary_abstraction ?? '');
    if (rawTitle) {
      const lowerTitle = rawTitle.toLowerCase();
      const lowerBucket = titlesByLower.get(lowerTitle);
      if (lowerBucket) lowerBucket.push(entry);
      else titlesByLower.set(lowerTitle, [entry]);

      const normalizedTitle = normalizeRecallText(rawTitle);
      if (
        normalizedTitle &&
        (NEEDS_NORMALIZATION_RE.test(rawTitle) ||
          Math.abs(lowerTitle.length - normalizedTitle.length) <= 2)
      ) {
        const normalizedBucket = titlesByNormalized.get(normalizedTitle);
        if (normalizedBucket) normalizedBucket.push(entry);
        else titlesByNormalized.set(normalizedTitle, [entry]);
      }
    }

    // DF counts documents, not occurrences: collapse duplicate anchors inside
    // one entry before recording it.
    const seen = new Set<string>();
    for (const cue of normalizedCues(entry).compact) {
      if (seen.has(cue)) continue;
      seen.add(cue);
      const bucket = cueEntries.get(cue);
      if (bucket) bucket.push(entry);
      else cueEntries.set(cue, [entry]);
      if (isDistinctiveCueLength(cue)) distinctiveCues.add(cue);
    }
  }

  const cueLengths = [...new Set([...distinctiveCues].map(cue => cue.length))].sort((a, b) => a - b);
  return {
    version,
    entriesRef: entries,
    anchorRefs,
    cueEntries,
    distinctiveCues,
    cueLengths,
    titlesByLower,
    titlesByNormalized,
    positions,
  };
}

function getExactEvidenceIndex(entries: readonly any[], version: number): ExactEvidenceIndex {
  if (exactEvidenceIndex && exactEvidenceIndex.version === version && isSameEntrySet(entries)) {
    // Adopt the caller's array wrapper so the next turn takes the identity path.
    exactEvidenceIndex.entriesRef = entries;
    return exactEvidenceIndex;
  }
  exactEvidenceIndex = buildExactEvidenceIndex(entries, version);
  exactEvidenceBuilds++;
  return exactEvidenceIndex;
}

/**
 * Distinctive cues contained in the query, found by probing the cached cue set
 * with query substrings grouped by the cue lengths that actually exist. This
 * replaces the per-entry `query.includes(cue)` scan: the work now depends on
 * the query length and the number of distinct cue lengths, not the corpus size.
 */
function containedDistinctiveCues(index: ExactEvidenceIndex, queryCompact: string): Set<string> {
  const found = new Set<string>();
  const queryLength = queryCompact.length;
  for (const length of index.cueLengths) {
    if (length > queryLength) break; // ascending → the rest are longer too
    const lastStart = queryLength - length;
    for (let start = 0; start <= lastStart; start++) {
      const candidate = queryCompact.slice(start, start + length);
      if (index.distinctiveCues.has(candidate)) found.add(candidate);
    }
  }
  return found;
}

interface CachedCandidate {
  position: number;
  entry: any;
  kind: 'title' | 'identifier' | 'cue';
  specificity: number;
}

/**
 * Cached pass. Same rules, same precedence (title > identifier > cue), same
 * DF / coverage / eligibility checks, same specificity formula and ordering as
 * the uncached scan — only the metadata normalization and the corpus-wide cue
 * containment scan are replaced by precomputed maps.
 */
function findExactEvidenceFromIndex(
  index: ExactEvidenceIndex,
  normalizedQuery: string,
  queryCompact: string,
  token: string | null,
  now: number,
  boundedLimit: number,
): ExactRecallEvidence[] {
  // Contained-cue coverage: only cues under the DF ceiling and over the query
  // coverage floor can contribute, and each entry keeps its best coverage.
  const coverageByEntry = new Map<any, number>();
  for (const cue of containedDistinctiveCues(index, queryCompact)) {
    const owners = index.cueEntries.get(cue);
    // `owners` is deduped per entry, so its length is the document frequency.
    if (!owners || owners.length > MAX_CUE_DOCUMENT_FREQUENCY) continue;
    const coverage = cue.length / queryCompact.length;
    if (coverage < MIN_CUE_QUERY_COVERAGE) continue;
    for (const entry of owners) {
      if (coverage > (coverageByEntry.get(entry) ?? 0)) coverageByEntry.set(entry, coverage);
    }
  }

  // Title and identifier owners, applied in that precedence order so an entry
  // that matches several kinds is recorded once with its strongest kind.
  const candidates = new Map<any, CachedCandidate>();
  const consider = (
    entry: any,
    kind: 'title' | 'identifier' | 'cue',
    specificity: number,
  ): void => {
    if (candidates.has(entry)) return;
    candidates.set(entry, {
      position: index.positions.get(entry) ?? Number.MAX_SAFE_INTEGER,
      entry,
      kind,
      specificity,
    });
  };
  for (const entry of index.titlesByLower.get(normalizedQuery) ?? []) {
    consider(entry, 'title', KIND_SPECIFICITY.title);
  }
  for (const entry of index.titlesByNormalized.get(normalizedQuery) ?? []) {
    consider(entry, 'title', KIND_SPECIFICITY.title);
  }
  if (token) {
    for (const entry of index.cueEntries.get(token) ?? []) {
      consider(entry, 'identifier', KIND_SPECIFICITY.identifier);
    }
  }
  for (const [entry, coverage] of coverageByEntry) {
    consider(entry, 'cue', KIND_SPECIFICITY.cue + coverage / 2);
  }

  // Replay candidates in physical index order: eligibility is judged now (never
  // cached), and equal-specificity duplicates keep the first owner, exactly as
  // the uncached per-entry scan does.
  const byId = new Map<string, ExactRecallEvidence>();
  const ordered = [...candidates.values()].sort((a, b) => a.position - b.position);
  for (const candidate of ordered) {
    if (!isExactEvidenceEligible(candidate.entry, now)) continue;
    const item: ExactRecallEvidence = {
      entry: candidate.entry,
      kind: candidate.kind,
      specificity: candidate.specificity,
    };
    const previous = byId.get(candidate.entry.id);
    if (!previous || item.specificity > previous.specificity) byId.set(candidate.entry.id, item);
  }

  return [...byId.values()].sort(compareEvidence).slice(0, boundedLimit);
}



function normalizedCues(entry: any): NormalizedCues {
  if (!entry || typeof entry !== 'object') return { compact: [] };
  const raw = Array.isArray(entry.cue_anchors) ? entry.cue_anchors : null;
  if (!raw) return { compact: [] };
  const cached = normalizedCueCache.get(raw);
  if (cached) return cached;
  const compact: string[] = [];
  for (const cue of raw) {
    if (typeof cue !== 'string') continue;
    const normalized = normalizeCue(cue);
    if (!normalized) continue;
    compact.push(normalized);
  }
  const result = { compact };
  normalizedCueCache.set(raw, result);
  return result;
}

function compareEvidence(a: ExactRecallEvidence, b: ExactRecallEvidence): number {
  if (b.specificity !== a.specificity) return b.specificity - a.specificity;
  // Deterministic tie-break: id ascending. NEVER recency or index order.
  return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
}

/**
 * Scan index metadata for deterministic exact evidence. Returns at most
 * `limit` entries, strongest first (title > identifier > distinctive cue).
 * Pure and synchronous, but NOT free: the caller only runs it on non-inject
 * turns, and its measured cost (tens of ms on the 16k-entry live corpus) must
 * be budgeted and monitored against the 100ms boundary contract.
 *
 * `searchVersion` is the optional warm path: pass the harmonic index's
 * `getSearchVersion()` to reuse a module-level metadata index (normalized cue
 * set, cue-length buckets, cue→entries, title→entries) that is rebuilt when the
 * version or the entry set changes. Results are identical per id / kind /
 * specificity; omit the argument to keep the original pure scan.
 */
export function findExactRecallEvidence(
  entries: readonly any[],
  query: string,
  limit: number = 3,
  searchVersion?: number,
): ExactRecallEvidence[] {
  const rawQuery = String(query ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const normalizedQuery = normalizeRecallText(rawQuery);
  if (!normalizedQuery || !Array.isArray(entries) || entries.length === 0) return [];
  const queryCompact = compactRecallText(normalizedQuery);
  if (!queryCompact) return [];
  const queryRawLower = rawQuery.toLowerCase();
  const token = identifierToken(rawQuery, normalizedQuery);
  const now = Date.now();

  // Versioned path (exact-evidence index cache): the caller passes the live
  // harmonic index's `searchVersion`, which buys a warm metadata index keyed by
  // that version. Omitting the version keeps the original pure scan unchanged
  // (no cache is built or consulted).
  if (typeof searchVersion === 'number' && Number.isFinite(searchVersion)) {
    const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
    return findExactEvidenceFromIndex(
      getExactEvidenceIndex(entries, searchVersion),
      normalizedQuery,
      queryCompact,
      token,
      now,
      boundedLimit,
    );
  }

  // Pass 1: candidate contained cues (compact forms; cached per entry).
  const candidateCues = new Set<string>();
  for (const entry of entries) {
    for (const cue of normalizedCues(entry).compact) {
      // Cheap rejects first; only real substrings pay the length rules.
      if (cue.length > queryCompact.length) continue;
      if (!queryCompact.includes(cue)) continue;
      if (!isDistinctiveCueLength(cue)) continue;
      candidateCues.add(cue);
    }
  }

  // Pass 2: document frequency over the WHOLE corpus (eligibility-independent)
  // for the few candidate cues only, capped at DF+1.
  const documentFrequency = new Map<string, number>();
  if (candidateCues.size > 0) {
    for (const entry of entries) {
      // Count documents, not occurrences: duplicate anchors inside one entry
      // must not inflate DF past the generic-cue ceiling.
      let seenInEntry: Set<string> | null = null;
      for (const cue of normalizedCues(entry).compact) {
        if (!candidateCues.has(cue)) continue;
        if (!seenInEntry) seenInEntry = new Set<string>();
        if (seenInEntry.has(cue)) continue;
        seenInEntry.add(cue);
        const count = documentFrequency.get(cue) ?? 0;
        if (count <= MAX_CUE_DOCUMENT_FREQUENCY) documentFrequency.set(cue, count + 1);
      }
    }
  }

  // Pass 3: build evidence for eligible entries.
  const byId = new Map<string, ExactRecallEvidence>();
  const add = (candidate: ExactRecallEvidence): void => {
    const previous = byId.get(candidate.entry.id);
    if (!previous || candidate.specificity > previous.specificity) byId.set(candidate.entry.id, candidate);
  };

  for (const entry of entries) {
    if (!isExactEvidenceEligible(entry, now)) continue;
    const cues = normalizedCues(entry);

    // 1) Full normalized title equality.
    const rawTitle = String(entry.primary_abstraction ?? '');
    const lowerTitle = rawTitle.toLowerCase();
    if (
      lowerTitle === queryRawLower ||
      lowerTitle === normalizedQuery ||
      ((NEEDS_NORMALIZATION_RE.test(rawTitle) || Math.abs(lowerTitle.length - normalizedQuery.length) <= 2) &&
        normalizeRecallText(rawTitle) === normalizedQuery)
    ) {
      add({ entry, kind: 'title', specificity: KIND_SPECIFICITY.title });
      continue;
    }

    // 2) Whole-query identifier present verbatim in a cue anchor.
    if (token && cues.compact.includes(token)) {
      add({ entry, kind: 'identifier', specificity: KIND_SPECIFICITY.identifier });
      continue;
    }

    // 3) Distinctive contained cue: length + DF + 50% query coverage.
    let bestCoverage = 0;
    if (candidateCues.size > 0) {
      for (const cue of cues.compact) {
        if (!candidateCues.has(cue)) continue;
        if ((documentFrequency.get(cue) ?? 0) > MAX_CUE_DOCUMENT_FREQUENCY) continue;
        const coverage = cue.length / queryCompact.length;
        if (coverage < MIN_CUE_QUERY_COVERAGE) continue;
        if (coverage > bestCoverage) bestCoverage = coverage;
      }
    }
    if (bestCoverage > 0) {
      add({
        entry,
        kind: 'cue',
        // Tiers keep cue evidence below identifiers/titles; coverage orders cues.
        specificity: KIND_SPECIFICITY.cue + bestCoverage / 2,
      });
    }
  }

  const boundedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 3;
  return [...byId.values()].sort(compareEvidence).slice(0, boundedLimit);
}

function memoryFromEntry(entry: any): RecallMemory {
  return {
    id: entry.id,
    primary_abstraction: entry.primary_abstraction || '',
    memory_value: entry.memory_value || entry.content || '',
    energy: typeof entry.energy === 'number' ? entry.energy : 0,
    // Normalized scores live in [0,1]; exact evidence is admissible on its own
    // merit and must render ahead of every BM25 candidate.
    score: 1,
    type: entry.type,
    created_at: entry.created_at,
    cue_anchors: entry.cue_anchors ?? [],
    distilled_by: entry.distilled_by,
    source: 'exact',
  };
}

/**
 * Rescue a sub-inject FOK zone with admissible exact entries: they are merged
 * ahead of the ranked candidates, deduplicated and bounded to `topK`. This is
 * an admission guard, NOT a second ranker — an already-`inject` turn returns
 * the candidate list untouched (and the route skips the scan entirely).
 * Equal-specificity evidence prefers owners already present in the BM25
 * candidates before the deterministic id tie-break. Recency is never used.
 */
export function applyExactRecallEvidence(
  memories: RecallMemory[],
  evidence: ExactRecallEvidence[],
  status: FokZone,
  topK: number = 3,
): { memories: RecallMemory[]; status: FokZone; exactIds: string[] } {
  if (status === 'inject') return { memories, status, exactIds: [] };

  const candidateIds = new Set<string>();
  for (const memory of memories ?? []) {
    if (memory && typeof memory.id === 'string') candidateIds.add(memory.id);
  }
  const compareWithCandidates = (a: ExactRecallEvidence, b: ExactRecallEvidence): number => {
    if (b.specificity !== a.specificity) return b.specificity - a.specificity;
    const aExisting = candidateIds.has(a.entry.id) ? 1 : 0;
    const bExisting = candidateIds.has(b.entry.id) ? 1 : 0;
    if (aExisting !== bExisting) return bExisting - aExisting;
    return a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0;
  };

  const valid = (Array.isArray(evidence) ? evidence : [])
    .filter(e => e && e.entry && typeof e.entry.id === 'string' && e.entry.id !== '')
    .sort(compareWithCandidates);
  if (valid.length === 0) return { memories, status, exactIds: [] };

  const existingById = new Map<string, RecallMemory>();
  for (const memory of memories ?? []) {
    if (memory && typeof memory.id === 'string' && !existingById.has(memory.id)) {
      existingById.set(memory.id, memory);
    }
  }

  const seen = new Set<string>();
  const exactMemories: RecallMemory[] = [];
  const exactIds: string[] = [];
  for (const item of valid) {
    const id = item.entry.id;
    if (seen.has(id)) continue;
    seen.add(id);
    exactMemories.push(existingById.get(id) ?? memoryFromEntry(item.entry));
    exactIds.push(id);
  }

  const bound = Number.isFinite(topK) ? Math.max(1, Math.floor(topK)) : 3;
  const merged = exactMemories.slice(0, bound);
  if (merged.length < bound) {
    for (const memory of memories ?? []) {
      if (merged.length >= bound) break;
      if (!memory || typeof memory.id !== 'string' || seen.has(memory.id)) continue;
      merged.push(memory);
    }
  }

  return { memories: merged, status: 'inject', exactIds: exactIds.slice(0, bound) };
}
