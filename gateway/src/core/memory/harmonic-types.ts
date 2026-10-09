/** G1: provenance authority (AuthMem-Bench arXiv:2608.01679 — consolidation
 *  erases source constraints; stored items gain authority beyond their source).
 *  Ranking: user > agent ≈ tool > pipeline. Absent = legacy → lowest. */
export type Authority = 'user' | 'agent' | 'tool' | 'pipeline';

const AUTHORITY_RANK: Record<Authority, number> = { pipeline: 1, tool: 2, agent: 2, user: 3 };

/** Parse an untrusted value into an Authority. undefined/absent → undefined
 *  (caller applies its default); invalid → null (caller should reject). */
export function normalizeAuthority(value: unknown): Authority | undefined | null {
  if (value === undefined || value === null) return undefined;
  return typeof value === 'string' && value in AUTHORITY_RANK ? (value as Authority) : null;
}

/** Merge rule: authority only rises, never demotes. Absent counts as
 *  'pipeline' (legacy entries must not gain authority by merging). */
export function higherAuthority(a?: Authority, b?: Authority): Authority {
  const ra = AUTHORITY_RANK[a ?? 'pipeline'];
  const rb = AUTHORITY_RANK[b ?? 'pipeline'];
  return ra >= rb ? (a ?? 'pipeline') : (b ?? 'pipeline');
}

export interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural' | 'global';
  granularity?: 'function' | 'class' | 'module' | 'architecture';
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  created_at: string;
  updated_at: string;
  goal_id?: string;
  merged_from?: string[];
  /** Pattern-separation marker (S4): ids of similar-but-distinct entries this
   *  unit was deliberately kept apart from (do not merge; preserve distinction). */
  distinct_from?: string[];
  salience?: number;
  abstraction_level?: number;
  /** A1: stale-verify scheduling state (see HarmonicIndexEntry). */
  review_count?: number;
  last_reviewed?: string;
  /** If set, this memory has been superseded by the referenced newer unit; retrieval should penalize it. */
  superseded_by?: string;
  /** Disclosure layer: injected into the system prompt every turn (excluded when superseded). */
  pinned?: boolean;
  /** Sticky note board: injected into every recall context until this ISO date
   *  passes (board-level expiry only — the memory itself is never deleted).
   *  Malformed dates fail open (treated as still active, mirroring mem0). */
  sticky_until?: string;
  /** Origin session for pipeline-written memories (per-session worker bookkeeping). */
  source_session_id?: string;
  /** G1: provenance authority. Absent = legacy → treated as 'pipeline' (lowest). */
  authority?: Authority;
  /** A5: ids of gist units distilled FROM this entry. NOT a supersede chain —
   *  the member stays live & retrievable (multiple gists may share members). */
  distilled_by?: string[];
}

export interface HarmonicIndex {
  version: number;
  updated_at: string;
  entries: HarmonicIndexEntry[];
}

export interface HarmonicIndexEntry {
  id: string;
  type: string;
  primary_abstraction: string;
  cue_anchors: string[];
  tier: string;
  energy: number;
  salience?: number;
  filePath?: string;
  created_at?: string;
  source_session_id?: string;
  /** Abstraction degree (orthogonal to type): 1=episodic, 2=semantic/procedural, 3=global. */
  abstraction_level?: number;
  superseded_by?: string;
  merged_from?: string[];
  pinned?: boolean;
  sticky_until?: string;
  /** Baseline for incremental energy decay (index v2+). Stamped when a decay
   *  pass actually applies, or by the v1→v2 migration (forgives the past).
   *  Entries without it fall back to created_at. */
  last_decay_at?: string;
  /** A1: stale-verify scheduling state — the review queue's consumer. Never
   *  reviewed entries are prioritized; recently reviewed ones are excluded
   *  for minReviewIntervalDays (default 21). */
  review_count?: number;
  last_reviewed?: string;
  /** B1: interleaved-replay stamp — when this entry was last fed into a
   *  turnCompress worker prompt as prior knowledge. Recent stamps are
   *  excluded from replay sampling (primacy-bias guard, arXiv:2502.00802). */
  last_replayed?: string;
  /** G1: provenance authority. Absent = legacy → treated as 'pipeline' (lowest). */
  authority?: Authority;
  /** A5: gist ids distilled from this entry (schema write-back pointer). */
  distilled_by?: string[];
}

export function generateHarmonicId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
