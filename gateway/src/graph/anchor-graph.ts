import { IDFStats } from '../retrieval/idf-stats';

export class AnchorGraph {
  private anchorIndex = new Map<string, Set<string>>();
  private hubThreshold: number;

  constructor(hubThreshold = 20) {
    this.hubThreshold = hubThreshold;
  }

  addUnit(id: string, anchors: string[]): void {
    for (const anchor of anchors) {
      if (!this.anchorIndex.has(anchor)) {
        this.anchorIndex.set(anchor, new Set());
      }
      this.anchorIndex.get(anchor)!.add(id);
    }
  }

  buildImplicitEdges(idfStats: IDFStats): Map<string, Set<string>> {
    const edges = new Map<string, Set<string>>();
    for (const [anchor, ids] of this.anchorIndex) {
      if (idfStats.isNoisy(anchor)) continue;
      if (ids.size > this.hubThreshold) continue;
      for (const a of ids) {
        for (const b of ids) {
          if (a >= b) continue;
          if (!edges.has(a)) edges.set(a, new Set());
          edges.get(a)!.add(b);
          if (!edges.has(b)) edges.set(b, new Set());
          edges.get(b)!.add(a);
        }
      }
    }
    return edges;
  }

  isHubNode(anchor: string): boolean {
    const ids = this.anchorIndex.get(anchor);
    return ids !== undefined && ids.size > this.hubThreshold;
  }

  getNeighbors(id: string, implicitEdges: Map<string, Set<string>>): string[] {
    return [...(implicitEdges.get(id) || [])];
  }
}
