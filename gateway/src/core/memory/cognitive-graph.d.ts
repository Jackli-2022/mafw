export interface CognitiveEdge {
    source: string;
    target: string;
    weight: number;
}
export interface CognitiveGraph {
    version: number;
    updated_at: string;
    edges: CognitiveEdge[];
}
export declare class CognitiveGraphManager {
    private graph;
    private filePath;
    constructor(baseDir: string);
    private load;
    private save;
    addConnection(idA: string, idB: string): void;
    getTopAssociations(id: string, topK?: number): string[];
    prune(threshold?: number): void;
    getGraph(): CognitiveGraph;
}
//# sourceMappingURL=cognitive-graph.d.ts.map