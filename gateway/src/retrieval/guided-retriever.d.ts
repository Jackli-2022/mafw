import { HarmonicIndexManager } from '../core/memory/harmonic-index';
export interface SearchOptions {
    policy?: 'oneshot' | 'guided';
    budgetTokens?: number;
    maxRounds?: number;
}
export interface SearchResult {
    id: string;
    primary_abstraction: string;
    score: number;
    round: number;
    hopDecay: number;
}
export declare class GuidedRetriever {
    private indexManager;
    constructor(indexManager: HarmonicIndexManager);
    search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
    private bm25Search;
}
//# sourceMappingURL=guided-retriever.d.ts.map