// Sparse encoder for T1 turns.
//
// This runs at T1 **write/encode** time (after a turn completes), not at query
// time: it decides which sparse terms participate in this episode. The output
// is a derived, rebuildable code — raw T1 remains the source of truth.
//
// Layers:
//   concept:  curated aliases (synonyms / Chinese ↔ English)
//   actor:    who took part (user / agent / tool / project)
//   entity:   paths and identifiers from the structured feature
//   token:    hashed lexical atoms (stable, exact identifiers)
//   semantic: optional atoms from an embedding encoder (dictionary / SPLADE
//             plug point). Without an embedder the code stays lexical.
//
// Query-side `querySparseTermIds` mirrors the token hashing and concept
// expansion so stored codes are directly matchable by an inverted lookup.
import { hashText } from './index-scan';
import type { T1Observation, T1Turn, T1TurnFeature } from '../memory/gateway-db';
import type { T1TurnActor } from './t1-actors';
import type { T1TurnConcept } from './t1-concepts';
import { expandQueryConcepts } from './t1-concepts';

export type T1SparseKind = 'concept' | 'actor' | 'entity' | 'token' | 'semantic';

export interface T1SparseTerm {
  traceId: string;
  termId: string;
  kind: T1SparseKind;
  weight: number;
  model: string;
}

/** One embedding-derived atom supplied by the encoder pipeline. */
export interface T1SparseAtom {
  termId: string;
  /** Calibrated atom weight (centered score), not a raw cosine. */
  score: number;
}

export interface T1SparseEncodeInput {
  turn: Pick<T1Turn, 'trace_id' | 'session_id' | 'turn_seq'>;
  rows: Array<Pick<T1Observation, 'content'>>;
  feature?: T1TurnFeature | null;
  concepts?: T1TurnConcept[];
  actors?: T1TurnActor[];
  /** Optional semantic atoms (embedding → dictionary/SPLADE sparse code). */
  atoms?: T1SparseAtom[];
}

export const SPARSE_LEX_MODEL = 'sparse-lex-v1';
export const SPARSE_EMBED_MODEL = 'sparse-embed-v1';

/**
 * Calibrated atoms below this score are too weak for retrieval. They stay in
 * the code (episode boundaries use the full set) but never reach the inverted
 * lookup, where a 0.05 atom on both sides would otherwise match unrelated text.
 */
export const MIN_RETRIEVAL_ATOM_SCORE = 0.08;

const TOKEN_RE = /[\p{L}\p{N}_./:\\-]{3,}/gu;
const MAX_TOKENS = 24;
const MAX_TERMS = 64;
const MAX_SEMANTIC_TERMS = 8;

/** Stable term ID for one lexical atom (FNV-1a over the lowercased token). */
export function tokenTermId(token: string): string {
  return `tok:${hashText(String(token ?? '').toLowerCase())}`;
}

/**
 * Query-side sparse encoding. Mirrors the write path for tokens and adds
 * concept expansion, so a Chinese synonym query can match an English turn.
 */
export function querySparseTermIds(query: string): string[] {
  const text = String(query ?? '');
  const ids = new Set<string>();
  for (const token of text.match(TOKEN_RE) ?? []) ids.add(tokenTermId(token));
  for (const conceptId of expandQueryConcepts(text)) ids.add(`concept:${conceptId}`);
  return [...ids];
}

function identifierWeight(token: string): number {
  // Paths, error codes and snake/camel identifiers are high-signal.
  if (/[\\/._:-]/.test(token) || /[A-Z]/.test(token)) return 0.7;
  return 0.3;
}

/**
 * Encode one turn into a sparse term list. Deterministic and synchronous;
 * embedding-derived atoms are passed in already scored (the async embedding
 * pipeline computes them). Returns an empty list for an empty turn.
 */
export function encodeTurnSparseTerms(input: T1SparseEncodeInput): T1SparseTerm[] {
  const collected = new Map<string, { termId: string; kind: T1SparseKind; weight: number }>();
  const put = (termId: string, kind: T1SparseKind, weight: number) => {
    if (!termId || !Number.isFinite(weight) || weight <= 0) return;
    const prev = collected.get(termId);
    if (prev && prev.weight >= weight) return;
    collected.set(termId, { termId, kind, weight });
  };

  for (const concept of input.concepts ?? []) {
    put(`concept:${concept.conceptId}`, 'concept', 0.8 * concept.weight);
  }
  for (const actor of input.actors ?? []) {
    put(`actor:${actor.actorId}`, 'actor', 0.6 * actor.weight);
  }
  for (const entity of input.feature?.entities ?? []) {
    const value = String(entity ?? '').trim().toLowerCase();
    if (value) put(`entity:${value}`, 'entity', 0.5);
  }

  const text = (input.rows ?? []).map((row) => row.content ?? '').join('\n');
  const counts = new Map<string, { raw: string; count: number }>();
  for (const token of text.match(TOKEN_RE) ?? []) {
    const key = token.toLowerCase();
    const prev = counts.get(key);
    if (prev) prev.count++;
    else counts.set(key, { raw: token, count: 1 });
  }
  const tokens = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[0].length - a[0].length)
    .slice(0, MAX_TOKENS);
  for (const [key, entry] of tokens) {
    const weight = identifierWeight(entry.raw) * (1 + Math.log1p(entry.count));
    put(tokenTermId(key), 'token', weight);
  }

  const semantic = (input.atoms ?? [])
    .filter((atom) => Number.isFinite(atom.score))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEMANTIC_TERMS);
  for (const atom of semantic) {
    put(`sem:${atom.termId}`, 'semantic', atom.score);
  }

  const model = semantic.length > 0 ? SPARSE_EMBED_MODEL : SPARSE_LEX_MODEL;
  return [...collected.values()]
    .sort((a, b) => b.weight - a.weight || a.termId.localeCompare(b.termId))
    .slice(0, MAX_TERMS)
    .map((term) => ({ traceId: input.turn.trace_id, ...term, model }));
}
