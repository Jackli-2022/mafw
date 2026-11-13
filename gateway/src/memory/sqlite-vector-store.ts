/**
 * SQLite-backed T1 vector store.
 *
 * The JSON vector store rewrites one ~500MB file on every flush. T1 vectors
 * only need per-row updates, so they live as Float32 BLOBs in gateway.db:
 * smaller on disk/RAM than JSON number arrays and O(changed rows) per flush.
 * Cosine search is still an in-memory brute-force scan (no ANN dependency).
 */
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import { log } from '../core/utils/logger';
import type { VectorStoreLike } from './vector-store';

export interface SqliteVectorStoreOptions {
  dims: number;
  model: string;
  /** Legacy JSON file to import once when the table is empty. */
  legacyJsonPath?: string;
}

function encodeVector(vec: ArrayLike<number>): Buffer {
  const buf = Buffer.allocUnsafe(vec.length * 4);
  for (let i = 0; i < vec.length; i++) buf.writeFloatLE(vec[i], i * 4);
  return buf;
}

function decodeVector(buf: Buffer): Float32Array {
  const out = new Float32Array(buf.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

function cosine(query: number[], vec: ArrayLike<number>): number {
  let dot = 0;
  let qNorm = 0;
  let vNorm = 0;
  for (let i = 0; i < query.length; i++) {
    dot += query[i] * vec[i];
    qNorm += query[i] * query[i];
    vNorm += vec[i] * vec[i];
  }
  if (qNorm === 0 || vNorm === 0) return 0;
  return dot / (Math.sqrt(qNorm) * Math.sqrt(vNorm));
}

export class SqliteT1VectorStore implements VectorStoreLike {
  private vectors = new Map<string, Float32Array>();
  private dirty = new Set<string>();
  private deleted = new Set<string>();
  readonly migrated: number;

  constructor(private db: Database.Database, private opts: SqliteVectorStoreOptions) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS t1_vectors (
        key TEXT PRIMARY KEY,
        dims INTEGER NOT NULL,
        model TEXT,
        vector BLOB NOT NULL,
        updated_at INTEGER DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_t1_vectors_model ON t1_vectors(model);
    `);
    const existing = (
      this.db.prepare('SELECT COUNT(*) AS c FROM t1_vectors WHERE model = ? AND dims = ?').get(this.opts.model, this.opts.dims) as { c: number }
    ).c;
    this.migrated = existing === 0 && opts.legacyJsonPath ? this.importLegacyJson(opts.legacyJsonPath) : 0;
    this.load();
  }

  private importLegacyJson(filePath: string): number {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      return 0;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch (err: any) {
      log.warn(`[T1Vectors] legacy JSON is unreadable (kept in place): ${err?.message || err}`);
      return 0;
    }
    const vectors = parsed?.vectors;
    if (!vectors || typeof vectors !== 'object') return 0;

    const entries: Array<[string, number[]]> = [];
    for (const [key, value] of Object.entries(vectors)) {
      if (Array.isArray(value) && value.length === this.opts.dims) {
        entries.push([key, value as number[]]);
      }
    }
    if (entries.length === 0) return 0;

    try {
      const insert = this.db.prepare(
        `INSERT INTO t1_vectors (key, dims, model, vector, updated_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET dims = excluded.dims, model = excluded.model,
           vector = excluded.vector, updated_at = unixepoch()`,
      );
      const txn = this.db.transaction(() => {
        for (const [key, vec] of entries) {
          insert.run(key, this.opts.dims, this.opts.model, encodeVector(vec));
        }
      });
      txn();
    } catch (err: any) {
      log.warn(`[T1Vectors] legacy JSON import failed: ${err?.message || err}`);
      return 0;
    }

    // Keep a renamed backup rather than deleting operator data.
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.renameSync(filePath, `${filePath}.migrated-${stamp}`);
    } catch (err: any) {
      log.warn(`[T1Vectors] imported but could not rename ${path.basename(filePath)}: ${err?.message || err}`);
    }
    log.info(`[T1Vectors] imported ${entries.length} vector(s) from ${path.basename(filePath)} into SQLite`);
    return entries.length;
  }

  private load(): void {
    try {
      const rows = this.db
        .prepare('SELECT key, vector FROM t1_vectors WHERE model = ? AND dims = ?')
        .all(this.opts.model, this.opts.dims) as Array<{ key: string; vector: Buffer }>;
      for (const row of rows) {
        this.vectors.set(row.key, decodeVector(row.vector));
      }
    } catch (err: any) {
      log.warn(`[T1Vectors] failed to load SQLite vectors: ${err?.message || err}`);
    }
  }

  upsert(id: string, vector: number[]): void {
    this.vectors.set(id, Float32Array.from(vector));
    this.dirty.add(id);
    this.deleted.delete(id);
  }

  get(id: string): Float32Array | undefined {
    return this.vectors.get(id);
  }

  remove(id: string): void {
    if (this.vectors.delete(id)) {
      this.dirty.delete(id);
      this.deleted.add(id);
    }
  }

  flush(): void {
    if (this.dirty.size === 0 && this.deleted.size === 0) return;
    try {
      const upsert = this.db.prepare(
        `INSERT INTO t1_vectors (key, dims, model, vector, updated_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET dims = excluded.dims, model = excluded.model,
           vector = excluded.vector, updated_at = unixepoch()`,
      );
      const del = this.db.prepare('DELETE FROM t1_vectors WHERE key = ?');
      const txn = this.db.transaction(() => {
        for (const key of this.dirty) {
          const vec = this.vectors.get(key);
          if (vec) upsert.run(key, vec.length, this.opts.model, encodeVector(vec));
        }
        for (const key of this.deleted) del.run(key);
      });
      txn();
      this.dirty.clear();
      this.deleted.clear();
    } catch (err: any) {
      log.warn(`[T1Vectors] flush failed: ${err?.message || err}`);
    }
  }

  size(): number {
    return this.vectors.size;
  }

  ids(): string[] {
    return [...this.vectors.keys()];
  }

  searchByCosine(query: number[], topK: number): Array<{ id: string; cosine: number }> {
    const hits: Array<{ id: string; cosine: number }> = [];
    for (const [id, vec] of this.vectors) {
      if (vec.length !== query.length) continue;
      hits.push({ id, cosine: cosine(query, vec) });
    }
    hits.sort((a, b) => b.cosine - a.cosine);
    return hits.slice(0, topK);
  }
}
