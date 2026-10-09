// G4 retrieval arbiter (MARTA arXiv:2610.05223): a cheap deterministic
// pre-/post-retrieval gate that estimates whether parametric knowledge
// suffices. v1 NEVER hard-skips retrieval (a missed user-context injection
// costs far more than 74ms) — it only annotates the inject block so the
// model can weight marginal memories below its own knowledge. Observe-first:
// every decision is logged for offline fitting of a future true skip gate.
//
// Complement to FOK (fok-gate.ts): FOK asks "does the memory store have it?"
// AFTER retrieval; the arbiter asks "is parametric knowledge likely enough?"
// from query shape alone. LLM self-reported confidence is useless
// (arXiv:2605.24299) — features are deterministic.

export type ArbiterAction = 'retrieve' | 'annotate-parametric' | 'annotate-sparse' | 'skip';

export const ARBITER_PARAMETRIC_NOTE =
  '[仲裁] 查询与已知项目实体零重叠且库中无可靠记忆——参数知识可能足够，以下检索仅供参考。';
export const ARBITER_SPARSE_NOTE =
  '[仲裁] 检索相关性弱——优先信参数知识，以下条目仅供对照。';

/** First-person / temporal self-reference → always retrieve (no arbitration). */
const SELF_REFERENCE_RE =
  /我|我们|咱|上次|昨天|之前|这个?(?:项目|仓库|repo)|\bmy\b|\bour\b|\blast\s+(?:time|week|month)\b/i;

export function hasSelfReference(query: string): boolean {
  return SELF_REFERENCE_RE.test(query);
}

/** Lowercase word tokens (len>=2) + CJK unigrams — same shape as BM25's tokenizer. */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const words = query.toLowerCase().match(/[a-z0-9_][a-z0-9_-]*/g) ?? [];
  for (const w of words) if (w.length >= 2) tokens.push(w);
  const cjk = query.match(/[一-鿿]/g) ?? [];
  tokens.push(...cjk);
  return tokens;
}

/** Known-entity set from index cue_anchors (all anchors; hub filtering is the
 *  caller's choice — the 60s TTL cache below makes per-request cost ~0). */
export function buildEntitySet(entries: Array<{ cue_anchors?: string[] }>): Set<string> {
  const set = new Set<string>();
  for (const e of entries) {
    for (const a of e.cue_anchors ?? []) {
      if (typeof a === 'string' && a.length >= 2 && !a.includes(':')) set.add(a.toLowerCase());
    }
  }
  return set;
}

/** Containment ratio: fraction of query tokens that are known entities
 *  (overlap/min side — Jaccard's length bias burned the snapshot path before). */
export function entityOverlap(query: string, entities: Set<string>): number {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0 || entities.size === 0) return 0;
  let hit = 0;
  for (const t of tokens) if (entities.has(t)) hit++;
  return hit / tokens.length;
}

export interface ArbiterInput {
  entityOverlap: number;
  fokZone?: 'inject' | 'low-confidence' | 'no-memory';
}

const SPARSE_OVERLAP_CAP = 0.1;

export function arbitrateRetrieval(
  query: string,
  ctx: ArbiterInput,
): { action: ArbiterAction; reason: string; note?: string } {
  if (hasSelfReference(query)) return { action: 'retrieve', reason: 'self-reference' };
  if (ctx.entityOverlap > SPARSE_OVERLAP_CAP) return { action: 'retrieve', reason: 'entity-overlap' };
  if (ctx.fokZone === 'no-memory' && ctx.entityOverlap === 0) {
    return { action: 'annotate-parametric', reason: 'zero-overlap+no-memory', note: ARBITER_PARAMETRIC_NOTE };
  }
  if (ctx.fokZone === 'low-confidence') {
    return { action: 'annotate-sparse', reason: 'low-overlap+low-confidence', note: ARBITER_SPARSE_NOTE };
  }
  return { action: 'retrieve', reason: 'default' };
}

// ---- Cached entity set for the boundary path (100ms contract) ----

let cached: { at: number; set: Set<string> } | null = null;
const ENTITY_SET_TTL_MS = 60_000;

export function getEntitySetCached(entries: Array<{ cue_anchors?: string[] }>, now = Date.now()): Set<string> {
  if (cached && now - cached.at < ENTITY_SET_TTL_MS) return cached.set;
  const set = buildEntitySet(entries);
  cached = { at: now, set };
  return set;
}

/** Test hook: drop the cache between suites. */
export function resetEntitySetCache(): void {
  cached = null;
}
