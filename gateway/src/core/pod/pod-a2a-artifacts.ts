import * as fs from 'fs';
import * as path from 'path';

const MIME: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.jsonl': 'application/jsonl',
  '.csv': 'text/csv; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

/** Inline cap for text artifacts returned inside `tasks/get` (keeps responses small). */
export const ARTIFACT_INLINE_MAX_BYTES = 32 * 1024;

export interface PodA2AArtifactRoots {
  /** Pod project dir — where `task.artifactRefs` (repo-relative paths) point. */
  projectDir?: string;
  /** Optional staged upload dir (`~/.mafw/pods/<podId>/artifacts`). */
  artifactRoot?: string;
}

export interface PodA2AArtifactSummary {
  ref: string;
  path: string;
  bytes: number;
  mediaType: string;
  content?: string;
}

interface ResolvedArtifact {
  ref: string;
  path: string;
  contentType: string;
  bytes: number;
}

function isTextLike(contentType: string, ext: string): boolean {
  if (contentType.startsWith('text/')) return true;
  return contentType === 'application/json'
    || contentType === 'application/jsonl'
    || ext === '.csv'
    || ext === '.tsv'
    || ext === '.log';
}

/**
 * Resolves A2A artifact ids to files. Ids are relative refs: first the Pod project
 * (where task receipts live), then the optional staging dir.
 * Rejects traversal, absolute paths, NUL bytes, and dotfile/dot-dir segments.
 */
export class PodA2AArtifactStore {
  private readonly roots: string[];

  constructor(roots: PodA2AArtifactRoots | string) {
    if (typeof roots === 'string') {
      this.roots = roots ? [roots] : [];
      return;
    }
    this.roots = [roots.projectDir, roots.artifactRoot].filter((root): root is string => !!root);
  }

  get(id: string): { path: string; contentType: string } | null {
    const resolved = this.resolve(id);
    return resolved ? { path: resolved.path, contentType: resolved.contentType } : null;
  }

  /** Richer view used to build self-describing A2A artifact parts. */
  describe(id: string): PodA2AArtifactSummary | null {
    const resolved = this.resolve(id);
    if (!resolved) return null;
    const ext = path.extname(resolved.path).toLowerCase();
    const summary: PodA2AArtifactSummary = {
      ref: resolved.ref,
      path: resolved.path,
      bytes: resolved.bytes,
      mediaType: resolved.contentType,
    };
    if (isTextLike(resolved.contentType, ext) && resolved.bytes <= ARTIFACT_INLINE_MAX_BYTES) {
      try {
        summary.content = fs.readFileSync(resolved.path, 'utf-8');
      } catch {
        // unreadable file: keep the descriptor without content
      }
    }
    return summary;
  }

  private resolve(id: string): ResolvedArtifact | null {
    const normalized = this.normalize(id);
    if (!normalized) return null;
    for (const root of this.roots) {
      const candidate = this.resolveInside(root, normalized.relative);
      if (!candidate) continue;
      let stats: fs.Stats;
      try {
        stats = fs.statSync(candidate);
      } catch {
        continue;
      }
      if (!stats.isFile()) continue;
      const contentType = MIME[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream';
      return { ref: normalized.ref, path: candidate, contentType, bytes: stats.size };
    }
    return null;
  }

  private normalize(id: string): { ref: string; relative: string } | null {
    if (typeof id !== 'string' || !id) return null;
    let decoded: string;
    try {
      decoded = decodeURIComponent(id);
    } catch {
      return null;
    }
    if (!decoded || decoded.includes('\0')) return null;
    if (/^[A-Za-z]:/.test(decoded)) return null;
    if (path.isAbsolute(decoded) || decoded.startsWith('\\') || decoded.startsWith('/')) return null;
    const segments = decoded.split(/[\\/]+/).filter((segment) => segment.length > 0);
    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '..')) return null;
    if (segments[0].startsWith('.')) return null;
    return { ref: segments.join('/'), relative: segments.join(path.sep) };
  }

  private resolveInside(root: string, ref: string): string | null {
    if (!root || !fs.existsSync(root)) return null;
    const resolved = path.resolve(root, ref);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    let realRoot: string;
    let real: string;
    try {
      realRoot = fs.realpathSync(root);
      real = fs.realpathSync(resolved);
    } catch {
      return null;
    }
    if (!real.startsWith(realRoot + path.sep)) return null;
    return real;
  }
}
