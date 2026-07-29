import { GraphNode, GraphEdge, KnowledgeGraph, GraphRelation } from './types';

export class GraphSearcher {
  private graph: KnowledgeGraph;

  constructor(graph: KnowledgeGraph) {
    this.graph = graph;
  }

  search(queryNodes: string[], maxDepth: number = 2): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ nodeId: string; depth: number }> = [];

    for (const [id, node] of this.graph.nodes) {
      if (queryNodes.some(q => node.label.toLowerCase().includes(q.toLowerCase()))) {
        visited.add(id);
        result.push(node);
        queue.push({ nodeId: id, depth: 0 });
      }
    }

    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      for (const edge of this.graph.edges.values()) {
        let neighborId: string | null = null;
        if (edge.source === nodeId) {
          neighborId = edge.target;
        } else if (edge.target === nodeId) {
          neighborId = edge.source;
        }

        if (neighborId && !visited.has(neighborId)) {
          visited.add(neighborId);
          const neighbor = this.graph.nodes.get(neighborId);
          if (neighbor) {
            result.push(neighbor);
            queue.push({ nodeId: neighborId, depth: depth + 1 });
          }
        }
      }
    }

    return result;
  }

  calculateImportance(nodeId: string): number {
    let totalWeight = 0;
    let count = 0;

    for (const edge of this.graph.edges.values()) {
      if (edge.target === nodeId) {
        totalWeight += edge.weight;
        count++;
      }
    }

    return totalWeight / Math.max(1, count);
  }

  findPath(from: string, fromLabel: string, toLabel: string): string[];
  findPath(from: string, to: string): string[];
  findPath(from: string, toOrLabel: string, toLabel?: string): string[] {
    const targetLabel = toLabel || toOrLabel;

    const visited = new Set<string>();
    const queue: Array<{ nodeId: string; path: string[] }> = [];

    const startNode = this.graph.nodes.get(from);
    if (!startNode) return [];

    const isTarget = (node: GraphNode): boolean => {
      if (toLabel !== undefined) {
        return node.label.toLowerCase().includes(targetLabel.toLowerCase());
      }
      return node.id === targetLabel;
    };

    if (isTarget(startNode)) return [startNode.id];

    visited.add(from);
    queue.push({ nodeId: from, path: [from] });

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      for (const edge of this.graph.edges.values()) {
        let neighborId: string | null = null;
        if (edge.source === nodeId) {
          neighborId = edge.target;
        } else if (edge.target === nodeId) {
          neighborId = edge.source;
        }

        if (neighborId && !visited.has(neighborId)) {
          visited.add(neighborId);
          const neighbor = this.graph.nodes.get(neighborId);
          if (neighbor) {
            const newPath = [...path, neighborId];
            if (isTarget(neighbor)) {
              return newPath;
            }
            queue.push({ nodeId: neighborId, path: newPath });
          }
        }
      }
    }

    return [];
  }

  findRelated(nodeId: string, relation?: GraphRelation, maxResults: number = 10): GraphNode[] {
    const connected: Array<{ node: GraphNode; weight: number }> = [];

    for (const edge of this.graph.edges.values()) {
      if (relation && edge.relation !== relation) continue;

      let neighborId: string | null = null;
      if (edge.source === nodeId) {
        neighborId = edge.target;
      } else if (edge.target === nodeId) {
        neighborId = edge.source;
      }

      if (neighborId) {
        const node = this.graph.nodes.get(neighborId);
        if (node) {
          connected.push({ node, weight: edge.weight });
        }
      }
    }

    connected.sort((a, b) => b.weight - a.weight);
    return connected.slice(0, maxResults).map(c => c.node);
  }
}
