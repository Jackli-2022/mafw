import * as fs from 'fs';
import { pipeline } from '@xenova/transformers';

export class VectorIndex {
  private embedder: any = null;
  private vectors: Map<string, { vector: number[]; text: string; metadata?: any }> = new Map();
  private initialized: boolean = false;
  private modelName: string;

  constructor(modelName?: string) {
    this.modelName = modelName || 'Xenova/all-MiniLM-L6-v2';
  }

  async init(): Promise<void> {
    this.embedder = await pipeline('feature-extraction', this.modelName);
    this.initialized = true;
  }

  async addDocument(id: string, text: string, metadata?: any): Promise<void> {
    if (!this.initialized) await this.init();
    const vector = await this.embed(text);
    this.vectors.set(id, { vector, text, metadata });
  }

  async addDocuments(entries: Array<{ id: string; text: string; metadata?: any }>): Promise<void> {
    for (const entry of entries) {
      await this.addDocument(entry.id, entry.text, entry.metadata);
    }
  }

  async search(query: string, topK?: number): Promise<Array<{ id: string; score: number; text: string; metadata?: any }>> {
    if (!this.initialized) await this.init();
    topK = topK || 10;
    if (this.vectors.size === 0) return [];

    const queryVector = await this.embed(query);
    const scored: Array<{ id: string; score: number; text: string; metadata?: any }> = [];

    for (const [id, entry] of this.vectors) {
      const score = this.cosineSimilarity(queryVector, entry.vector);
      scored.push({ id, score, text: entry.text, metadata: entry.metadata });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  removeDocument(id: string): void {
    this.vectors.delete(id);
  }

  clear(): void {
    this.vectors.clear();
  }

  get size(): number {
    return this.vectors.size;
  }

  save(path: string): void {
    const obj: Record<string, { vector: number[]; text: string; metadata?: any }> = {};
    for (const [id, entry] of this.vectors) {
      obj[id] = { vector: entry.vector, text: entry.text, metadata: entry.metadata };
    }
    fs.writeFileSync(path, JSON.stringify(obj, null, 2), 'utf-8');
  }

  load(path: string): void {
    const raw = fs.readFileSync(path, 'utf-8');
    const obj = JSON.parse(raw);
    this.vectors.clear();
    for (const [id, data] of Object.entries(obj)) {
      this.vectors.set(id, data as { vector: number[]; text: string; metadata?: any });
    }
  }

  private async embed(text: string): Promise<number[]> {
    const output = await this.embedder(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
