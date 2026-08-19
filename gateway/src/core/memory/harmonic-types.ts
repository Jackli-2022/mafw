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
}

export function generateHarmonicId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
