import * as path from 'path';

export type PodGoalWorktreeStatus = 'active' | 'merged' | 'abandoned' | 'missing';

const MAX_SLUG = 80;

function revisionOf(revision: number): number {
  const value = Number(revision);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

/** Git-safe, path-safe goal slug shared by branch and directory names. */
export function safePodGoalSlug(goalId: string): string {
  const cleaned = String(goalId ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    // A ref component cannot contain `..`, start with `.`/`-`, or end with `.`
    // (`git check-ref-format`); sanitize instead of failing at worktree creation.
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\-_]+/, '')
    .replace(/[.\-_]+$/, '')
    .slice(0, MAX_SLUG)
    .replace(/[.\-_]+$/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'goal';
  return cleaned.endsWith('.lock') ? `${cleaned.slice(0, -5)}_lock` : cleaned;
}

export function podWorktreeBranch(goalId: string, revision: number): string {
  return `mafw/${safePodGoalSlug(goalId)}-r${revisionOf(revision)}`;
}

/** Sibling checkout: `<repoParent>/<repoName>-wt-<safeGoalId>-r<N>`. */
export function podWorktreeDir(projectDir: string, goalId: string, revision: number): string {
  const repoRoot = path.resolve(projectDir);
  const repoName = path.basename(repoRoot) || 'repo';
  return path.join(
    path.dirname(repoRoot),
    `${repoName}-wt-${safePodGoalSlug(goalId)}-r${revisionOf(revision)}`,
  );
}
