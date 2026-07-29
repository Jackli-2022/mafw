import * as fs from 'fs';
import * as path from 'path';
import { StorageBackend } from './types';

export class FileStorage implements StorageBackend {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
  }

  private scopeDir(scope: string): string {
    return path.join(this.basePath, scope);
  }

  private filePath(scope: string, key: string): string {
    return path.join(this.scopeDir(scope), `${key}.json`);
  }

  private ensureScope(scope: string): void {
    const dir = this.scopeDir(scope);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async get(scope: string, key: string): Promise<any> {
    const fp = this.filePath(scope, key);
    if (!fs.existsSync(fp)) return null;
    try {
      return JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      return null;
    }
  }

  async set(scope: string, key: string, value: any): Promise<void> {
    this.ensureScope(scope);
    const fp = this.filePath(scope, key);
    fs.writeFileSync(fp, JSON.stringify(value, null, 2), 'utf-8');
  }

  async delete(scope: string, key: string): Promise<void> {
    const fp = this.filePath(scope, key);
    if (fs.existsSync(fp)) {
      fs.unlinkSync(fp);
    }
  }

  async query(scope: string, filter?: { query?: string; energyMin?: number; limit?: number }): Promise<any[]> {
    const dir = this.scopeDir(scope);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    let results: any[] = [];

    for (const f of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'));
        results.push(data);
      } catch {
        // skip corrupt files
      }
    }

    if (filter?.query) {
      const q = filter.query.toLowerCase();
      results = results.filter(item =>
        JSON.stringify(item).toLowerCase().includes(q)
      );
    }

    if (filter?.energyMin !== undefined) {
      results = results.filter(item => (item.energy ?? 0.5) >= filter.energyMin!);
    }

    results.sort((a, b) => (b.energy ?? 0.5) - (a.energy ?? 0.5));

    if (filter?.limit !== undefined) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async batch(operations: Array<{ type: 'set' | 'delete'; scope: string; key: string; value?: any }>): Promise<void> {
    for (const op of operations) {
      if (op.type === 'set') {
        await this.set(op.scope, op.key, op.value);
      } else if (op.type === 'delete') {
        await this.delete(op.scope, op.key);
      }
    }
  }
}
