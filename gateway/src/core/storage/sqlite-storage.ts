import DatabaseConstructor from 'better-sqlite3';
import type { Database } from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import { StorageBackend } from './types';

interface CacheEntry {
  value: any;
  expiresAt: number;
}

export class SQLiteStorage implements StorageBackend {
  private db: Database;
  private cache: Map<string, CacheEntry>;
  private cacheTTL: number;

  constructor(dbPath: string, config?: { cacheSize?: number; cacheTTL?: number }) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new DatabaseConstructor(dbPath);
    this.cacheTTL = config?.cacheTTL ?? 300_000;
    this.cache = new Map();

    if (config?.cacheSize) {
      this.db.pragma(`cache_size = ${config.cacheSize}`);
    }

    this.db.pragma('journal_mode = WAL');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        energy REAL DEFAULT 0.5,
        created_at INTEGER DEFAULT (unixepoch()),
        updated_at INTEGER DEFAULT (unixepoch()),
        PRIMARY KEY (scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_scope ON memories(scope);
      CREATE INDEX IF NOT EXISTS idx_energy ON memories(energy);
      CREATE INDEX IF NOT EXISTS idx_created ON memories(created_at);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content, scope, key,
        content='memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content, scope, key) VALUES (new.rowid, new.value, new.scope, new.key);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, scope, key) VALUES('delete', old.rowid, old.scope, old.key);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, scope, key) VALUES('delete', old.rowid, old.scope, old.key);
        INSERT INTO memories_fts(rowid, content, scope, key) VALUES (new.rowid, new.value, new.scope, new.key);
      END;

      CREATE TABLE IF NOT EXISTS cost_logs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL,
        loop_num INTEGER NOT NULL,
        wave_num INTEGER,
        tool_name TEXT NOT NULL,
        estimated_tokens INTEGER DEFAULT 0,
        estimated_cost REAL DEFAULT 0,
        timestamp TEXT NOT NULL,
        metadata TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_cost_goal ON cost_logs(goal_id);
      CREATE INDEX IF NOT EXISTS idx_cost_timestamp ON cost_logs(timestamp);
    `);
  }

  private cacheKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }

  private isCachedValid(cacheKey: string): CacheEntry | undefined {
    const entry = this.cache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(cacheKey);
      return undefined;
    }
    return entry;
  }

  private setCache(scope: string, key: string, value: any): void {
    this.cache.set(this.cacheKey(scope, key), {
      value,
      expiresAt: Date.now() + this.cacheTTL
    });
  }

  private deleteCache(scope: string, key: string): void {
    this.cache.delete(this.cacheKey(scope, key));
  }

  async get(scope: string, key: string): Promise<any> {
    const ck = this.cacheKey(scope, key);
    const cached = this.isCachedValid(ck);
    if (cached) return cached.value;

    const row = this.db.prepare(
      'SELECT value FROM memories WHERE scope = ? AND key = ?'
    ).get(scope, key) as { value: string } | undefined;

    if (!row) return null;

    const parsed = JSON.parse(row.value);
    this.setCache(scope, key, parsed);
    return parsed;
  }

  async set(scope: string, key: string, value: any): Promise<void> {
    const encoded = JSON.stringify(value);
    this.db.prepare(
      `INSERT INTO memories (scope, key, value) VALUES (?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
    ).run(scope, key, encoded);

    this.setCache(scope, key, value);
  }

  async delete(scope: string, key: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM memories WHERE scope = ? AND key = ?'
    ).run(scope, key);

    this.deleteCache(scope, key);
  }

  async query(scope: string, filter?: { query?: string; energyMin?: number; limit?: number }): Promise<any[]> {
    let rows: any[];

    if (filter?.query) {
      rows = this.db.prepare(
        `SELECT m.value, m.energy, m.created_at, m.updated_at
         FROM memories m
         JOIN memories_fts fts ON m.rowid = fts.rowid
         WHERE m.scope = ? AND memories_fts MATCH ?
         ORDER BY rank`
      ).all(scope, filter.query);
    } else {
      rows = this.db.prepare(
        `SELECT value, energy, created_at, updated_at
         FROM memories
         WHERE scope = ?
         ORDER BY energy DESC`
      ).all(scope);
    }

    let results = rows.map((r: any) => ({
      ...JSON.parse(r.value),
      energy: r.energy,
      created_at: r.created_at,
      updated_at: r.updated_at
    }));

    if (filter?.energyMin !== undefined) {
      results = results.filter(item => item.energy >= filter.energyMin!);
    }

    if (filter?.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async batch(operations: Array<{ type: 'set' | 'delete'; scope: string; key: string; value?: any }>): Promise<void> {
    const setStmt = this.db.prepare(
      `INSERT INTO memories (scope, key, value) VALUES (?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()`
    );
    const deleteStmt = this.db.prepare(
      'DELETE FROM memories WHERE scope = ? AND key = ?'
    );

    const transaction = this.db.transaction(() => {
      for (const op of operations) {
        if (op.type === 'set') {
          setStmt.run(op.scope, op.key, JSON.stringify(op.value));
          this.setCache(op.scope, op.key, op.value);
        } else if (op.type === 'delete') {
          deleteStmt.run(op.scope, op.key);
          this.deleteCache(op.scope, op.key);
        }
      }
    });

    transaction();
  }

  close(): void {
    this.db.close();
  }
}
