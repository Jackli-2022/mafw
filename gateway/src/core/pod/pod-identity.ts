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

/**
 * Pod 运行上下文节点（不是业务身份）：一个节点对应一类隐藏运行会话。
 * - discussion / plan → Tech Lead（技术讨论与规划）
 * - probe / execute   → Builder（Spike 探针与正式实施）
 * - review            → Reviewer（独立验收）
 */
export type PodNode = 'discussion' | 'plan' | 'probe' | 'execute' | 'review';

export function roleForNode(node: PodNode): PodMemberRole {
  if (node === 'discussion' || node === 'plan') return 'tech_lead';
  if (node === 'probe' || node === 'execute') return 'builder';
  return 'reviewer';
}
