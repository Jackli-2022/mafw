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
    filePath?: string;
}
export declare function generateHarmonicId(): string;
//# sourceMappingURL=harmonic-types.d.ts.map