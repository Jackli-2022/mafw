import * as fs from 'fs';
import * as path from 'path';

const MIME: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

export class PodA2AArtifactStore {
  constructor(private readonly root: string) {}

  get(id: string): { path: string; contentType: string } | null {
    if (!fs.existsSync(this.root)) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      return null;
    }
    if (!decoded || decoded.includes('\0') || path.isAbsolute(decoded)) return null;
    if (decoded.split(/[\\/]/).includes('..')) return null;
    const resolved = path.resolve(this.root, decoded);
    const relative = path.relative(this.root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
    const real = fs.realpathSync(resolved);
    const realRoot = fs.realpathSync(this.root);
    if (!real.startsWith(realRoot + path.sep)) return null;
    return { path: real, contentType: MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream' };
  }
}
