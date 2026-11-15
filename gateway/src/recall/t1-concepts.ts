// Concept / alias layer for T1.
//
// Lexical FTS and the structured feature channel cannot connect "解析失败" to
// "unparseable JSON". Dense embedding can, but it is not the T1 source of
// truth and may be unavailable. This layer is the deterministic middle ground:
// a small, auditable alias table maps surface terms to canonical concept IDs,
// and turns store those IDs sparsely.
//
// Coverage is explicit: only seeded/curated aliases match. That is the point —
// concept hits are explainable and reviewable, unlike a black-box cosine.
import type { T1Observation, T1Turn, T1TurnFeature } from '../memory/gateway-db';

export interface T1ConceptAlias {
  term: string;
  conceptId: string;
  weight: number;
}

export interface T1TurnConcept {
  traceId: string;
  conceptId: string;
  weight: number;
}

/**
 * Seed dictionary. Keep entries short, canonical, and unambiguous. A concept
 * ID is `<kind>:<name>` where kind ∈ error | metric | action | concept | actor.
 *
 * This is deliberately small: it is the first pass, not a thesaurus. New
 * aliases can be added at runtime through `t1_concepts` without a migration.
 */
export const DEFAULT_CONCEPT_ALIASES: T1ConceptAlias[] = [
  // parse / JSON errors
  { term: 'unparseable', conceptId: 'error:json_parse', weight: 1 },
  { term: 'json parse', conceptId: 'error:json_parse', weight: 1 },
  { term: 'parse error', conceptId: 'error:json_parse', weight: 1 },
  { term: 'invalid json', conceptId: 'error:json_parse', weight: 1 },
  { term: '解析失败', conceptId: 'error:json_parse', weight: 1 },
  { term: '解析错误', conceptId: 'error:json_parse', weight: 1 },

  // network
  { term: 'econnreset', conceptId: 'error:connection_reset', weight: 1 },
  { term: 'connection reset', conceptId: 'error:connection_reset', weight: 1 },
  { term: '连接重置', conceptId: 'error:connection_reset', weight: 1 },
  { term: 'timeout', conceptId: 'error:timeout', weight: 1 },
  { term: 'timed out', conceptId: 'error:timeout', weight: 1 },
  { term: '超时', conceptId: 'error:timeout', weight: 1 },

  // metrics
  { term: 'coverage', conceptId: 'metric:coverage', weight: 1 },
  { term: '覆盖率', conceptId: 'metric:coverage', weight: 1 },
  { term: '覆盖', conceptId: 'metric:coverage', weight: 0.8 },

  // actions
  { term: 'merge', conceptId: 'action:merge', weight: 1 },
  { term: 'consolidation', conceptId: 'action:merge', weight: 1 },
  { term: 'consolidate', conceptId: 'action:merge', weight: 1 },
  { term: '合并', conceptId: 'action:merge', weight: 1 },
  { term: 'reflection', conceptId: 'action:reflection', weight: 1 },
  { term: 'reflect', conceptId: 'action:reflection', weight: 0.9 },
  { term: '反思', conceptId: 'action:reflection', weight: 1 },
  { term: 'provenance', conceptId: 'concept:provenance', weight: 1 },
  { term: 'source trace', conceptId: 'concept:provenance', weight: 1 },
  { term: 'source_trace', conceptId: 'concept:provenance', weight: 1 },
  { term: '溯源', conceptId: 'concept:provenance', weight: 1 },
  { term: '来源', conceptId: 'concept:provenance', weight: 0.8 },
  { term: 'deploy', conceptId: 'action:deploy', weight: 1 },
  { term: '部署', conceptId: 'action:deploy', weight: 1 },
  { term: 'restart', conceptId: 'action:restart', weight: 1 },
  { term: '重启', conceptId: 'action:restart', weight: 1 },

  // actors (concept-level mirror; turn actors live in t1_turn_actors)
  { term: 'reviewer', conceptId: 'actor:reviewer', weight: 1 },
  { term: '评审', conceptId: 'actor:reviewer', weight: 1 },
  { term: 'builder', conceptId: 'actor:builder', weight: 1 },
  { term: '构建者', conceptId: 'actor:builder', weight: 1 },
  { term: 'tech lead', conceptId: 'actor:tech-lead', weight: 1 },
  { term: 'tech-lead', conceptId: 'actor:tech-lead', weight: 1 },
];

function isAsciiTerm(term: string): boolean {
  return /^[a-z0-9][a-z0-9 _./:-]*$/i.test(term);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Match aliases against text. ASCII aliases use word boundaries so `merge`
 * does not fire inside `emerged`; CJK aliases use substring matching (no
 * spaces to anchor on). Returns the best weight per concept.
 */
export function matchConcepts(text: string): Array<{ conceptId: string; weight: number }> {
  const haystack = String(text ?? '').toLowerCase();
  if (!haystack.trim()) return [];
  const weights = new Map<string, number>();

  for (const alias of DEFAULT_CONCEPT_ALIASES) {
    const term = alias.term.toLowerCase();
    let matched = false;
    if (isAsciiTerm(term)) {
      const re = new RegExp(`(^|[^a-z0-9_])${escapeRegExp(term)}([^a-z0-9_]|$)`);
      matched = re.test(haystack);
    } else {
      matched = haystack.includes(term);
    }
    if (!matched) continue;
    weights.set(alias.conceptId, Math.max(weights.get(alias.conceptId) ?? 0, alias.weight));
  }

  return [...weights.entries()].map(([conceptId, weight]) => ({ conceptId, weight }));
}

/**
 * Build the sparse concept code for a turn. Raw rows plus the structured
 * feature fields are both scanned: the feature's `error` may name the concept
 * even when the verbatim transcript is vague.
 */
export function extractTurnConcepts(
  turn: Pick<T1Turn, 'trace_id'>,
  rows: Array<Pick<T1Observation, 'source' | 'content'>>,
  feature?: T1TurnFeature | null,
): T1TurnConcept[] {
  const text = [
    ...rows.map((r) => r.content),
    feature?.intent,
    feature?.action,
    feature?.error,
    feature?.decision,
    ...(feature?.entities ?? []),
  ]
    .filter((value): value is string => Boolean(value && String(value).trim()))
    .join('\n');

  return matchConcepts(text).map((concept) => ({
    traceId: turn.trace_id,
    conceptId: concept.conceptId,
    weight: concept.weight,
  }));
}

/** Query-side expansion: surface terms → canonical concept IDs. */
export function expandQueryConcepts(query: string): string[] {
  return matchConcepts(query).map((concept) => concept.conceptId);
}
