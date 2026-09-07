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
  salience?: number;
  abstraction_level?: number;
  review_count?: number;
  last_reviewed?: string;
  top_associations?: string[];
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
  superseded_by?: string;
  merged_from?: string[];
  pinned?: boolean;
  sticky_until?: string;
  /** Baseline for incremental energy decay (index v2+). Stamped when a decay
   *  pass actually applies, or by the v1→v2 migration (forgives the past).
   *  Entries without it fall back to created_at. */
  last_decay_at?: string;
}

export function generateHarmonicId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
