export declare class IDFStats {
    private df;
    private n;
    private threshold;
    constructor(threshold?: number);
    addDocument(terms: string[]): void;
    idf(term: string): number;
    getThresholdIdf(): number;
    isNoisy(term: string): boolean;
}
//# sourceMappingURL=idf-stats.d.ts.map