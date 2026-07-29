import { IDFStats } from '../retrieval/idf-stats';
export declare class AnchorGraph {
    private anchorIndex;
    private hubThreshold;
    constructor(hubThreshold?: number);
    addUnit(id: string, anchors: string[]): void;
    buildImplicitEdges(idfStats: IDFStats): Map<string, Set<string>>;
    isHubNode(anchor: string): boolean;
    getNeighbors(id: string, implicitEdges: Map<string, Set<string>>): string[];
}
//# sourceMappingURL=anchor-graph.d.ts.map