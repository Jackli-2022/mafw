import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { PodMemberRole } from './pod-store';

export function canonicalProjectDir(projectDir: string): string {
  const abs = path.resolve(projectDir);
  try {
    return fs.realpathSync(abs);
  } catch {
    return abs;
  }
}

export function podIdForProject(projectDir: string): string {
  const canonical = canonicalProjectDir(projectDir).replace(/\\/g, '/');
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return `pod_${digest}`;
}

export function parentProjectDirForWorktree(worktreeDir: string): string | null {
  const base = path.basename(worktreeDir);
  const match = /^(.*)-(?:wt|goal)-(.+)$/.exec(base);
  if (!match || !match[1]) return null;
  return path.join(path.dirname(worktreeDir), match[1]);
}

export function roleForNode(node: 'plan' | 'execute' | 'review'): PodMemberRole {
  if (node === 'plan') return 'lead';
  if (node === 'execute') return 'builder';
  return 'reviewer';
}
