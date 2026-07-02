import * as fs from 'fs';
import * as path from 'path';
import { GraphNode, GraphEdge, KnowledgeGraph } from './types';
import { EntityExtractor } from './entity-extractor';
import { RelationInferencer } from './relation-inferencer';

interface SerializedGraph {
  nodes: Array<{ key: string; value: GraphNode }>;
  edges: Array<{ key: string; value: GraphEdge }>;
}

export class KnowledgeGraphManager {
  private graph: KnowledgeGraph;
  private storagePath: string;
  private extractor: EntityExtractor;
  private inferencer: RelationInferencer;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || './.mafw/data/knowledge-graph.json';
    this.graph = { nodes: new Map(), edges: new Map() };
    this.extractor = new EntityExtractor();
    this.inferencer = new RelationInferencer();
  }

  async load(): Promise<void> {
    if (!fs.existsSync(this.storagePath)) {
      this.graph = { nodes: new Map(), edges: new Map() };
      return;
    }
    const raw = fs.readFileSync(this.storagePath, 'utf-8');
    const parsed: SerializedGraph = JSON.parse(raw);
    this.graph = {
      nodes: new Map(parsed.nodes.map(n => [n.key, n.value])),
      edges: new Map(parsed.edges.map(e => [e.key, e.value])),
    };
  }

  async save(): Promise<void> {
    const dir = path.dirname(this.storagePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const serialized: SerializedGraph = {
      nodes: Array.from(this.graph.nodes.entries()).map(([key, value]) => ({ key, value })),
      edges: Array.from(this.graph.edges.entries()).map(([key, value]) => ({ key, value })),
    };
    const tmp = this.storagePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(serialized, null, 2), 'utf-8');
    fs.renameSync(tmp, this.storagePath);
  }

  addNode(node: GraphNode): void {
    this.graph.nodes.set(node.id, node);
  }

  addEdge(edge: GraphEdge): void {
    this.graph.edges.set(edge.id, edge);
  }

  removeNode(nodeId: string): void {
    this.graph.nodes.delete(nodeId);
    for (const [edgeId, edge] of this.graph.edges) {
      if (edge.source === nodeId || edge.target === nodeId) {
        this.graph.edges.delete(edgeId);
      }
    }
  }

  removeEdge(edgeId: string): void {
    this.graph.edges.delete(edgeId);
  }

  getNode(nodeId: string): GraphNode | undefined {
    return this.graph.nodes.get(nodeId);
  }

  search(query: string, maxResults: number = 10): GraphNode[] {
    const lower = query.toLowerCase();
    const results: GraphNode[] = [];
    for (const node of this.graph.nodes.values()) {
      if (node.label.toLowerCase().includes(lower)) {
        results.push(node);
        if (results.length >= maxResults) break;
      }
    }
    return results;
  }

  getGraph(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: Array.from(this.graph.nodes.values()),
      edges: Array.from(this.graph.edges.values()),
    };
  }

  async processObservation(text: string, loopNum: number): Promise<void> {
    const entities = this.extractor.extract(text);
    const edges = this.inferencer.inferRelations(entities, text);

    for (const entity of entities) {
      const nodeId = `node-${entity}`;
      if (!this.graph.nodes.has(nodeId)) {
        this.graph.nodes.set(nodeId, {
          id: nodeId,
          type: 'concept',
          label: entity,
          energy: 0.5,
          sourceLoops: [loopNum],
          properties: {},
          createdAt: new Date().toISOString(),
        });
      }
    }

    for (const edge of edges) {
      edge.sourceLoops.push(loopNum);
      this.graph.edges.set(edge.id, edge);
    }
  }
}
