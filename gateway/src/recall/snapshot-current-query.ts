/**
 * Current-query admission for the pre-rendered prefetch snapshot.
 *
 * Why this exists: `buildSnapshot` runs in the background against a ROLLING
 * WINDOW of recent turns (`snapshotQueryFromTurns`), so its block is a bet on
 * what the next turn will be about. `decideSnapshotUse` only compares the new
 * query with that window (containment), which a short follow-up like
 * 「再分析一下」 passes while sharing nothing with the *content* of the block.
 * Observed (2026-11-19): a memory-recall-performance session served a block of
 * DeepSeek model preferences, a generic workflow preference, a five-vendor UX
 * survey and a bash cache-path note — plus three duplicate T1 lines — while
 * 「再分析一下」 was the actual query. The performance memories never appeared.
 *
 * The guard is lexical and metadata-only (same contract as
 * `lexical-support.ts`, whose tokenization is reused rather than copied):
 *   - anchors are judged on their title + cue anchors against the CURRENT query;
 *   - a neighbour survives only when it is independently supported AND its
 *     anchor survived (a relevant anchor must not drag unrelated neighbours in);
 *   - T1 excerpts are judged the same way (excerpt as the field), self-deduped
 *     on exact NFKC/lowercase/whitespace only, and dropped when they merely
 *     repeat a ≥12-char ASCII identifier phrase already shown by Harmonic.
 *
 * If neither layer has current support, the caller must fall back to the live
 * search — the snapshot's probability gate said "the *window* was answerable",
 * not "this block answers *this* query".
 *
 * Deliberately NOT done here: rewriting the stored snapshot (returns a new
 * object; the original is never mutated), touching the FOK zone/top1prob,
 * re-ranking, or re-rendering the episodes layer (`episodes` snapshots fall
 * back: their layered block has no per-hit structure to validate).
 */
import type { RecallSnapshot } from './recall-snapshot';
import { SNAPSHOT_DEFAULTS } from './recall-snapshot';
import type { T1Hit } from './verbatim-recall';
import { renderT1Lines, T1_POINTER_HEADER } from './verbatim-recall';
import { formatRecallContext } from './inject-format';
import { selectLexicallySupportedCandidates } from './lexical-support';

export type SnapshotFallbackReason =
  | 'no-query-units'
  | 'no-current-support'
  | 'empty-render'
  | 'episodes-unsupported';

export interface SnapshotKeptCounts {
  anchors: number;
  neighbors: number;
  t1: number;
  /** True when the serve path actually removed/de-duplicated something. */
  filtered: boolean;
}

export interface SnapshotAdaptOptions {
  /**
   * T1 line budget for the re-render. Defaults to `SNAPSHOT_DEFAULTS.t1MaxChars`
   * (600); the route passes the same `search.snapshot.t1MaxChars` the builder
   * used, so a tuned deployment keeps its budget instead of growing to 600.
   */
  t1MaxChars?: number;
}

export type SnapshotCurrentQueryResult =
  | { action: 'serve'; snapshot: RecallSnapshot; kept: SnapshotKeptCounts }
  | { action: 'fallback'; reason: SnapshotFallbackReason };

type SnapshotMemory = NonNullable<RecallSnapshot['memories']>[number];

/** Minimal render surface accepted by `formatRecallContext` (id + gist). */
interface RenderableMemory {
  id: string;
  primary_abstraction: string;
  type?: string;
  created_at?: string;
  energy?: number;
}

/**
 * A shared ASCII phrase this long is treated as an identifier, not vocabulary:
 * `deepseek-v4.1-flash` (19), `NOTE_BOARD_BUDGET` (17), `packages\desktop` (16).
 * Below the floor (`deepseek`, `npm`) the T1 line may still add context.
 */
const MIN_SHARED_IDENTIFIER_PHRASE = 12;
const IDENTIFIER_PHRASE_RE = /[\w.:/\\-]{12,}/g;

function identifierPhrases(text: string): Set<string> {
  const out = new Set<string>();
  for (const phrase of String(text ?? '').normalize('NFKC').toLowerCase().match(IDENTIFIER_PHRASE_RE) ?? []) {
    if (phrase.length >= MIN_SHARED_IDENTIFIER_PHRASE) out.add(phrase);
  }
  return out;
}

/** Exact-normalisation for T1 self-dedupe: NFKC + lowercase + whitespace. */
function exactKey(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toRenderable(memory: SnapshotMemory): RenderableMemory {
  return {
    id: memory.id,
    primary_abstraction: memory.abstraction ?? '',
    ...(memory.type ? { type: memory.type } : {}),
    ...(memory.date ? { created_at: memory.date } : {}),
    ...(typeof memory.energy === 'number' && Number.isFinite(memory.energy) ? { energy: memory.energy } : {}),
  };
}

function candidateFor(memory: SnapshotMemory): { primary_abstraction?: string; cue_anchors?: string[] } {
  return {
    primary_abstraction: memory.abstraction ?? '',
    cue_anchors: Array.isArray(memory.cue_anchors) ? memory.cue_anchors : [],
  };
}

/** Legacy snapshots carry only a rendered block: serve them unchanged. */
function serveLegacy(snapshot: RecallSnapshot): SnapshotCurrentQueryResult {
  return {
    action: 'serve',
    // Shallow copy: the immutability contract holds even on the legacy path.
    snapshot: { ...snapshot },
    kept: {
      anchors: Array.isArray(snapshot.ids) ? snapshot.ids.length : 0,
      neighbors: 0,
      t1: Array.isArray(snapshot.t1Hits) ? snapshot.t1Hits.length : 0,
      filtered: false,
    },
  };
}

/**
 * Nothing was removed or de-duplicated: serve the stored block verbatim.
 *
 * Deliberate: `snapshot.memories` only records the topK anchors, while the
 * built block can contain more (and carries render-only details such as the
 * `distilled_by` gist hint). Re-rendering a fully supported snapshot would
 * therefore *change* it for no reason — the point of this guard is removal,
 * not cosmetic rewriting.
 */
function serveVerbatim(
  snapshot: RecallSnapshot,
  kept: SnapshotKeptCounts,
): SnapshotCurrentQueryResult {
  return { action: 'serve', snapshot: { ...snapshot }, kept };
}

/**
 * Pure adapter used by `GET /api/recall/context` right before a snapshot is
 * served (`decision === 'use' && fokStatus === 'inject'`) and before any
 * exposure / FOK sample / receipt recording.
 */
export function adaptSnapshotToCurrentQuery(
  snapshot: RecallSnapshot,
  query: string,
  options: SnapshotAdaptOptions = {},
): SnapshotCurrentQueryResult {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.block) {
    return { action: 'fallback', reason: 'empty-render' };
  }
  // The layered episode block is rendered from episode hits, not per-memory
  // metadata — re-rendering it here would silently drop the episode section.
  if (Array.isArray(snapshot.episodes) && snapshot.episodes.length > 0) {
    return { action: 'fallback', reason: 'episodes-unsupported' };
  }
  // No structured metadata (pre-cue_anchors shape): nothing to validate.
  if (!Array.isArray(snapshot.memories)) return serveLegacy(snapshot);

  const all = snapshot.memories;
  const anchorEntries = all.filter((m) => m && !m.neighborOf);
  const neighborEntries = all.filter((m) => m && !!m.neighborOf);
  const t1Hits = Array.isArray(snapshot.t1Hits) ? snapshot.t1Hits : [];

  // Support is computed once per layer with the SAME query units: an empty unit
  // set is a refusal for snapshot serving (the live path stays fail-open).
  const anchorCandidates = anchorEntries.map(candidateFor);
  const anchorSelection = selectLexicallySupportedCandidates(anchorCandidates, query);
  if (!anchorSelection.applicable) return { action: 'fallback', reason: 'no-query-units' };
  const t1Candidates = t1Hits.map((hit) => ({ primary_abstraction: hit.excerpt ?? '' }));
  const t1Selection = selectLexicallySupportedCandidates(t1Candidates, query);
  if (!t1Selection.applicable) return { action: 'fallback', reason: 'no-query-units' };

  // Order is the snapshot's render order (reranker/BW25), never re-sorted here.
  const supportedAnchorKeys = new Set(anchorSelection.supported);
  const keptAnchors = anchorEntries.filter((_memory, index) => supportedAnchorKeys.has(anchorCandidates[index]));
  const keptAnchorIds = new Set(keptAnchors.map((m) => m.id));

  // A neighbour must be relevant on its own AND belong to a surviving anchor.
  const neighborCandidates = neighborEntries.map(candidateFor);
  const supportedNeighborKeys = new Set(
    selectLexicallySupportedCandidates(neighborCandidates, query).supported,
  );
  const keptNeighbors = neighborEntries.filter(
    (memory, index) =>
      keptAnchorIds.has(memory.neighborOf as string)
      && supportedNeighborKeys.has(neighborCandidates[index]),
  );

  const supportedT1Keys = new Set(t1Selection.supported);
  const supportedT1 = t1Hits.filter((_hit, index) => supportedT1Keys.has(t1Candidates[index]));

  // T1 self-dedupe: exact normalised text only, first occurrence wins.
  const seenT1 = new Set<string>();
  const dedupedT1: T1Hit[] = [];
  for (const hit of supportedT1) {
    const key = exactKey(hit.excerpt ?? '');
    if (key && seenT1.has(key)) continue;
    if (key) seenT1.add(key);
    dedupedT1.push(hit);
  }

  // Redundancy: a retained Harmonic pointer's rendered title already carries
  // this identifier phrase → the T1 line adds no evidence, drop it. Cue anchors
  // are NOT part of the rendered block, so a phrase that only lives there must
  // not cost us the T1 line.
  const shownPhrases = new Set<string>();
  for (const memory of [...keptAnchors, ...keptNeighbors]) {
    for (const phrase of identifierPhrases(memory.abstraction ?? '')) {
      shownPhrases.add(phrase);
    }
  }
  const keptT1 = dedupedT1.filter((hit) => {
    for (const phrase of identifierPhrases(hit.excerpt ?? '')) {
      if (shownPhrases.has(phrase)) return false;
    }
    return true;
  });

  if (keptAnchors.length === 0 && keptT1.length === 0) {
    return { action: 'fallback', reason: 'no-current-support' };
  }

  // Nothing removed or de-duplicated → keep the stored block byte-for-byte
  // (its metadata is only topK anchors; a re-render would silently drop the
  // extra anchors and render-only details such as the gist hint).
  const filtered =
    keptAnchors.length !== anchorEntries.length
    || keptNeighbors.length !== neighborEntries.length
    || keptT1.length !== t1Hits.length;
  if (!filtered) {
    return serveVerbatim(snapshot, {
      anchors: keptAnchors.length,
      neighbors: keptNeighbors.length,
      t1: keptT1.length,
      filtered: false,
    });
  }

  const status = snapshot.fokStatus ?? 'inject';
  const neighborsByAnchor = new Map<string, RenderableMemory[]>();
  for (const memory of keptNeighbors) {
    const anchorId = memory.neighborOf as string;
    const list = neighborsByAnchor.get(anchorId) ?? [];
    list.push(toRenderable(memory));
    neighborsByAnchor.set(anchorId, list);
  }
  const harmonic = keptAnchors.length > 0
    ? formatRecallContext(keptAnchors.map(toRenderable), {
        status,
        ...(neighborsByAnchor.size > 0 ? { neighbors: neighborsByAnchor } : {}),
      }).pointers
    : null;

  const t1MaxChars = options.t1MaxChars ?? SNAPSHOT_DEFAULTS.t1MaxChars;
  const t1Lines = keptT1.length > 0
    ? renderT1Lines(keptT1, {
        k: keptT1.length,
        maxChars: t1MaxChars,
      })
    : '';
  const block = harmonic && t1Lines
    ? `${harmonic}\n${t1Lines}`
    : harmonic ?? (t1Lines ? `${T1_POINTER_HEADER}\n${t1Lines}` : null);
  if (!block) return { action: 'fallback', reason: 'empty-render' };

  return {
    action: 'serve',
    kept: { anchors: keptAnchors.length, neighbors: keptNeighbors.length, t1: keptT1.length, filtered: true },
    snapshot: {
      ...snapshot,
      block,
      ids: keptAnchors.map((memory) => memory.id),
      memories: [...keptAnchors, ...keptNeighbors],
      t1Hits: keptT1,
      t1Rendered: keptT1.length > 0,
    },
  };
}
