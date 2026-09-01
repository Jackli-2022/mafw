// P1b: persistent vector store + write-path embedding indexer.
//
// MemoryVectorStore keeps one JSON file per embedding model next to the
// harmonic index (<baseDir>/memory/vectors-<model>.json). Vectors are held in
// memory and persisted atomically (tmp + rename). Cosine search is a brute
// scan — at agent-memory scale (hundreds to low thousands of entries × 1024
// dims) this is single-digit milliseconds, far below any ANN's complexity.
//
// EmbeddingIndexer decouples the write path from the embedding model: units
// are enqueued on write (fire-and-forget) and embedded in batches, so BM25
// recall stays instant while the dense channel converges asynchronously.

import * as fs from 'fs';
import * as path from 'path';

import { EmbeddingProvider } from './embedding-provider';
import { log } from '../core/utils/logger';

export class MemoryVectorStore {
  private vectors = new Map<string, number[]>();
  private dirty = false;

  constructor(private filePath: string, public dims: number, private model = '') {
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      if (data && typeof data === 'object' && data.vectors) {
        this.model = data.model || this.model;
        this.dims = data.dims || this.dims;
        for (const [id, vec] of Object.entries(data.vectors)) {
          this.vectors.set(id, vec as number[]);
        }
      }
    } catch (err: any) {
      log.warn(`[VectorStore] failed to load ${this.filePath}: ${err?.message || err}`);
    }
  }

  flush(): void {
    if (!this.dirty && fs.existsSync(this.filePath)) return;
    const body = {
      model: this.model,
      dims: this.dims,
      updated_at: new Date().toISOString(),
      vectors: Object.fromEntries(this.vectors),
    };
    const tmp = this.filePath + '.tmp';
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(body), 'utf-8');
    fs.renameSync(tmp, this.filePath);
    this.dirty = false;
  }

  upsert(id: string, vector: number[]): void {
    this.vectors.set(id, vector);
    this.dirty = true;
  }

  get(id: string): number[] | undefined {
    return this.vectors.get(id);
  }

  remove(id: string): void {
    if (this.vectors.delete(id)) this.dirty = true;
  }

  size(): number {
    return this.vectors.size;
  }

  ids(): string[] {
    return [...this.vectors.keys()];
  }

  /**
   * Brute-force cosine scan. Entries whose stored dimension mismatches the
   * query are skipped (model-change artifacts) rather than throwing.
   */
  searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> {
    const qNorm = norm(query);
    if (qNorm === 0) return [];
    const hits: Array<{ id: string; cosine: number }> = [];
    for (const [id, vec] of this.vectors) {
      if (vec.length !== query.length) continue;
      const vNorm = norm(vec);
      if (vNorm === 0) continue;
      let dot = 0;
      for (let i = 0; i < query.length; i++) dot += query[i] * vec[i];
      hits.push({ id, cosine: dot / (qNorm * vNorm) });
    }
    hits.sort((a, b) => b.cosine - a.cosine);
    return hits.slice(0, topK);
  }
}

function norm(vec: number[]): number {
  let sum = 0;
  for (const v of vec) sum += v * v;
  return Math.sqrt(sum);
}

// ── EmbeddingIndexer ─────────────────────────────────────────────────────────

export interface EmbeddingIndexerDeps {
  vectors: MemoryVectorStore;
  provider: EmbeddingProvider;
  /** Optional resolver for backfill (defaults to unit text passed to onUnitWritten). */
  getTextForId?: (id: string) => Promise<string | null>;
  /** Cap for memory_value portion (default 2000 chars). */
  valueCap?: number;
}

interface QueueItem {
  id: string;
  text: string;
}

export class EmbeddingIndexer {
  private queue = new Map<string, QueueItem>();
  private vectors: MemoryVectorStore;
  private provider: EmbeddingProvider;
  private getTextForId?: (id: string) => Promise<string | null>;
  private valueCap: number;

  constructor(deps: EmbeddingIndexerDeps) {
    this.vectors = deps.vectors;
    this.provider = deps.provider;
    this.getTextForId = deps.getTextForId;
    this.valueCap = deps.valueCap ?? 2000;
  }

  /** Document text: primary abstraction + memory value (capped). */
  static documentText(unit: { primary_abstraction?: string; memory_value?: string }, valueCap = 2000): string {
    const abs = (unit.primary_abstraction || '').trim();
    const value = (unit.memory_value || '').slice(0, valueCap);
    return (abs + (value ? '\n' + value : '')).trim();
  }

  onUnitWritten(unit: { id: string; primary_abstraction?: string; memory_value?: string }): void {
    if (!unit?.id) return;
    this.queue.set(unit.id, {
      id: unit.id,
      text: EmbeddingIndexer.documentText(unit, this.valueCap),
    });
  }

  removeUnit(id: string): void {
    this.queue.delete(id);
    this.vectors.remove(id);
  }

  /**
   * Embed everything queued (document kind) and upsert into the vector store.
   * Fail-open: an embedding error drops the batch item and logs — the dense
   * channel converges on a later flush/backfill instead of blocking writes.
   */
  async flushQueue(): Promise<{ indexed: number; failed: number }> {
    if (this.queue.size === 0) return { indexed: 0, failed: 0 };
    const items = [...this.queue.values()];
    this.queue.clear();

    let indexed = 0;
    let failed = 0;
    const BATCH = 16;
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      try {
        const vectors = await this.provider.embed(batch.map(b => b.text), 'document');
        for (let j = 0; j < batch.length; j++) {
          this.vectors.upsert(batch[j].id, vectors[j]);
          indexed++;
        }
      } catch (err: any) {
        failed += batch.length;
        log.warn(`[EmbeddingIndexer] batch embed failed (${batch.length} items): ${err?.message || err}`);
      }
    }
    if (indexed > 0) this.vectors.flush();
    return { indexed, failed };
  }

  /**
   * Index entries that lack vectors (startup backfill / model migration).
   * Entries whose text can't be resolved count as `missing`.
   */
  async backfill(ids: string[]): Promise<{ indexed: number; skipped: number; missing: number }> {
    const pending: Array<{ id: string; text: string }> = [];
    let skipped = 0;
    let missing = 0;

    for (const id of ids) {
      if (this.vectors.get(id)) {
        skipped++;
        continue;
      }
      const text = this.getTextForId ? await this.getTextForId(id) : null;
      if (!text) {
        missing++;
        continue;
      }
      pending.push({ id, text });
    }

    for (const item of pending) this.queue.set(item.id, item);
    const { indexed, failed } = await this.flushQueue();
    return { indexed, skipped, missing: missing + failed };
  }
}
