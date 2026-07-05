import * as fs from 'fs';
import * as path from 'path';

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

const GRAPH_FILE = path.join('memory', '.cognitive_graph.json');

export class CognitiveGraphManager {
  private graph: CognitiveGraph;
  private filePath: string;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, GRAPH_FILE);
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.graph = this.load();
  }

  private load(): CognitiveGraph {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // corrupt or missing file
    }
    return { version: 1, updated_at: new Date().toISOString(), edges: [] };
  }

  private save(): void {
    this.graph.updated_at = new Date().toISOString();
    const tmpPath = this.filePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.graph, null, 2), 'utf-8');
    fs.renameSync(tmpPath, this.filePath);
  }

  addConnection(idA: string, idB: string): void {
    const [source, target] = idA < idB ? [idA, idB] : [idB, idA];
    const existing = this.graph.edges.find(e => e.source === source && e.target === target);
    if (existing) {
      existing.weight++;
    } else {
      this.graph.edges.push({ source, target, weight: 1 });
    }
    this.save();
  }

  getTopAssociations(id: string, topK: number = 2): string[] {
    const neighbors = this.graph.edges
      .filter(e => e.source === id || e.target === id)
      .map(e => (e.source === id ? e.target : e.source))
      .map(nid => ({
        id: nid,
        weight: this.graph.edges
          .filter(e => (e.source === id && e.target === nid) || (e.source === nid && e.target === id))
          .reduce((sum, e) => sum + e.weight, 0),
      }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, topK)
      .map(n => n.id);
    return neighbors;
  }

  prune(threshold: number = 2): void {
    this.graph.edges = this.graph.edges.filter(e => e.weight >= threshold);
    this.save();
  }

  getGraph(): CognitiveGraph {
    return JSON.parse(JSON.stringify(this.graph));
  }
}
