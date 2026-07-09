export interface HarmonicUnit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  primary_abstraction: string;
  cue_anchors: string[];
  memory_value: string;
  energy: number;
  created_at: string;
  updated_at: string;
  merged_from?: string[];
  salience?: number;
  abstraction_level?: number;
  review_count?: number;
  last_reviewed?: string;
  top_associations?: string[];
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
}

export function generateHarmonicId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
