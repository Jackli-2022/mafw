import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { PodError, type PodGoalWorktreeRow, type PodStore } from './pod-store';
import { podWorktreeBranch, podWorktreeDir } from './pod-worktree-path';

export interface PodWorktreeServiceDeps {
  store: PodStore;
  now?(): string;
  gitFactory?(projectDir: string): SimpleGit;
  log?(message: string): void;
}

export interface PodWorktreeCommitResult {
  commit: string | null;
}

export interface PodWorktreeMergeResult {
  branch: string;
  mergeCommit: string;
  mergedAt: string;
}

const MAFW_IDENTITY = [
  '-c', 'user.name=MAFW',
  '-c', 'user.email=mafw@localhost',
  '-c', 'commit.gpgsign=false',
];

function canonical(value: string): string {
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function samePath(left: string, right: string): boolean {
  const a = canonical(left);
  const b = canonical(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Owns the Git checkout for one Pod Goal revision.
 *
 * - ensure: idempotent, single-flight, repo-root-only;
 * - commitPending: snapshot the checkout without user hooks;
 * - mergeForAcceptance: no-ff merge after explicit user acceptance;
 * - markAbandoned: retain the branch but close the acceptance path.
 */
export class PodWorktreeService {
  private readonly inflight = new Map<string, Promise<PodGoalWorktreeRow>>();
  private readonly now: () => string;

  constructor(private readonly deps: PodWorktreeServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  get(podId: string, goalId: string, revision: number): PodGoalWorktreeRow | null {
    return this.deps.store.getGoalWorktree(podId, goalId, revision);
  }

  /**
   * Only reconcile an already-provisioned revision (recover a deleted dir).
   * Returns null when the row does not exist: in-flight Goals created before
   * this feature must not be retrofitted into a worktree (they keep the project
   * checkout and acceptance stays unavailable).
   */
  async ensureExisting(
    podId: string,
    goalId: string,
    revision: number,
  ): Promise<PodGoalWorktreeRow | null> {
    const existing = this.get(podId, goalId, revision);
    if (!existing) return null;
    if (existing.status === 'merged' || existing.status === 'abandoned') return existing;
    if (fs.existsSync(existing.dir)) return existing;
    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    await this.attachMissing(existing, pod.projectDir, goalId, revision);
    return this.get(podId, goalId, revision) ?? existing;
  }

  /** Preflight used before writing Goal intake: Pod project must be the repo root. */
  async assertProjectRoot(projectDir: string): Promise<string> {
    const repoRoot = await this.repoRoot(projectDir);
    if (!samePath(projectDir, repoRoot)) {
      throw new PodError(409, `pod worktree requires project root; got subdirectory ${projectDir}`);
    }
    return repoRoot;
  }

  async ensure(podId: string, goalId: string, revision: number): Promise<PodGoalWorktreeRow> {
    const key = `${podId}\u0000${goalId}\u0000${revision}`;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = this.ensureInner(podId, goalId, revision).finally(() => {
      if (this.inflight.get(key) === promise) this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }

  async commitPending(podId: string, goalId: string, revision: number): Promise<PodWorktreeCommitResult> {
    const row = this.get(podId, goalId, revision);
    if (!row || row.status === 'merged' || row.status === 'abandoned') return { commit: null };
    if (!fs.existsSync(row.dir)) return { commit: null };
    const git = this.gitFor(row.dir);
    try {
      await this.assertWorktreeBranch(git, row);
      await git.raw(['add', '-A', '--', '.']);
      await git.raw(['reset', '-q', '--', '.mafw']).catch(() => {});
      const staged = await git.raw(['diff', '--cached', '--name-only']);
      if (!staged.trim()) return { commit: null };
      await git.raw([
        ...MAFW_IDENTITY,
        'commit',
        '--no-verify',
        '-m',
        `mafw(pod): ${goalId} rev ${revision}`,
      ]);
      return { commit: (await git.revparse(['HEAD'])).trim() };
    } catch (err) {
      throw new PodError(409, `worktree commit failed: ${errorMessage(err)}`);
    }
  }

  async mergeForAcceptance(
    podId: string,
    goalId: string,
    revision: number,
  ): Promise<PodWorktreeMergeResult> {
    const row = this.get(podId, goalId, revision);
    if (!row) throw new PodError(409, `goal revision has no worktree: ${goalId}#${revision}`);
    if (row.status === 'merged') {
      return {
        branch: row.branch,
        mergeCommit: row.mergeCommit ?? '',
        mergedAt: row.mergedAt ?? this.now(),
      };
    }
    if (row.status !== 'active') {
      throw new PodError(409, `goal revision worktree is not acceptable: ${row.status}`);
    }
    if (!row.baseBranch) {
      throw new PodError(409, 'cannot merge a worktree created from a detached HEAD');
    }
    if (!fs.existsSync(row.dir)) {
      throw new PodError(409, `worktree directory is missing: ${row.dir}`);
    }

    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    const project = this.gitFor(pod.projectDir);
    const current = (await project.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (current !== row.baseBranch) {
      throw new PodError(
        409,
        `project branch ${current || '(detached)'} is not the recorded base branch ${row.baseBranch}`,
      );
    }
    const dirty = (await project.raw(['status', '--porcelain', '--untracked-files=no'])).trim();
    if (dirty) {
      throw new PodError(409, 'project has tracked changes; commit or stash them before acceptance');
    }

    await this.commitPending(podId, goalId, revision);
    // Never force-remove uncommitted work: `.mafw` is intentionally excluded from
    // revision branches, so anything else still dirty blocks acceptance.
    const worktreeGit = this.gitFor(row.dir);
    const leftover = (await worktreeGit.raw(['status', '--porcelain', '--', '.', ':(exclude).mafw'])).trim();
    if (leftover) {
      throw new PodError(
        409,
        `worktree has uncommitted changes that cannot be auto-committed: ${leftover.split('\n')[0]}`,
      );
    }
    const before = (await project.revparse(['HEAD'])).trim();
    try {
      await project.raw([...MAFW_IDENTITY, 'merge', '--no-ff', '--no-verify', '--no-edit', row.branch]);
      const unmerged = (await project.raw(['diff', '--name-only', '--diff-filter=U'])).trim();
      if (unmerged) {
        await project.raw(['merge', '--abort']).catch(() => {});
        throw new PodError(409, `worktree merge conflict: ${unmerged.split('\n')[0]}`);
      }
    } catch (err) {
      await project.raw(['merge', '--abort']).catch(() => {});
      if (err instanceof PodError) throw err;
      throw new PodError(409, `worktree merge conflict: ${errorMessage(err)}`);
    }

    const after = (await project.revparse(['HEAD'])).trim();
    // An already-contained branch produces no merge commit ("Already up to date");
    // leave it empty instead of claiming a pre-existing base commit was the merge.
    const mergeCommit = after !== before ? after : '';
    const mergedAt = this.now();
    this.deps.store.updateGoalWorktree({
      podId,
      goalId,
      revision,
      status: 'merged',
      mergeCommit,
      mergedAt,
      now: mergedAt,
    });
    await project.raw(['worktree', 'remove', '--force', row.dir]).catch((err) => {
      this.deps.log?.(`[Pod] worktree remove after merge failed for ${goalId}#${revision}: ${errorMessage(err)}`);
    });
    return { branch: row.branch, mergeCommit, mergedAt };
  }

  markAbandoned(podId: string, goalId: string, revision: number): void {
    const row = this.get(podId, goalId, revision);
    if (!row || row.status !== 'active') return;
    this.deps.store.updateGoalWorktree({
      podId,
      goalId,
      revision,
      status: 'abandoned',
      now: this.now(),
    });
  }

  private async ensureInner(podId: string, goalId: string, revision: number): Promise<PodGoalWorktreeRow> {
    const existing = this.get(podId, goalId, revision);
    if (existing) {
      const reconciled = await this.ensureExisting(podId, goalId, revision);
      return reconciled ?? existing;
    }

    const pod = this.deps.store.getPod(podId);
    if (!pod) throw new PodError(404, `pod not found: ${podId}`);
    const repoRoot = await this.assertProjectRoot(pod.projectDir);

    const branch = podWorktreeBranch(goalId, revision);
    const dir = podWorktreeDir(repoRoot, goalId, revision);
    const git = this.gitFor(repoRoot);
    const currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    const baseBranch = currentBranch === 'HEAD' ? null : currentBranch;
    const previous = revision > 1 ? this.get(podId, goalId, revision - 1) : null;
    let baseRef = baseBranch ?? (await git.revparse(['HEAD'])).trim();
    if (previous && await this.branchExists(git, previous.branch)) {
      baseRef = previous.branch;
    }
    const effectiveBaseBranch = baseBranch ?? previous?.baseBranch ?? null;

    let created = false;
    try {
      if (fs.existsSync(dir)) {
        throw new PodError(409, `worktree directory already exists: ${dir}`);
      }
      await git.raw(['worktree', 'add', '-b', branch, dir, baseRef]);
      created = true;
      const row = this.deps.store.insertGoalWorktree({
        podId,
        goalId,
        revision,
        dir,
        branch,
        baseRef,
        baseBranch: effectiveBaseBranch,
        status: 'active',
        now: this.now(),
      });
      return row;
    } catch (err) {
      if (created) {
        await git.raw(['worktree', 'remove', '--force', dir]).catch(() => {});
        await git.raw(['branch', '-D', branch]).catch(() => {});
      }
      if (err instanceof PodError) throw err;
      throw new PodError(409, `worktree create failed: ${errorMessage(err)}`);
    }
  }

  private async attachMissing(
    row: PodGoalWorktreeRow,
    projectDir: string,
    goalId: string,
    revision: number,
  ): Promise<void> {
    const git = this.gitFor(projectDir);
    try {
      // A deleted checkout leaves a registered-missing entry; clear it before re-add.
      await git.raw(['worktree', 'prune']).catch(() => {});
      const exists = await this.branchExists(git, row.branch);
      if (exists) await git.raw(['worktree', 'add', row.dir, row.branch]);
      else await git.raw(['worktree', 'add', '-b', row.branch, row.dir, row.baseRef]);
      this.deps.store.updateGoalWorktree({
        podId: row.podId,
        goalId,
        revision,
        status: 'active',
        now: this.now(),
      });
    } catch (err) {
      this.deps.store.updateGoalWorktree({
        podId: row.podId,
        goalId,
        revision,
        status: 'missing',
        now: this.now(),
      });
      throw new PodError(409, `worktree recovery failed: ${errorMessage(err)}`);
    }
  }

  /** A session may have switched branches inside the checkout; never merge that drift. */
  private async assertWorktreeBranch(git: SimpleGit, row: PodGoalWorktreeRow): Promise<void> {
    const head = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
    if (!head || head === 'HEAD' || head !== row.branch) {
      throw new PodError(
        409,
        `worktree is on ${head || '(detached)'} but the revision branch is ${row.branch}`,
      );
    }
  }

  private async repoRoot(projectDir: string): Promise<string> {
    try {
      const root = (await this.gitFor(projectDir).revparse(['--show-toplevel'])).trim();
      return canonical(root);
    } catch (err) {
      throw new PodError(409, `project is not a git repository: ${errorMessage(err)}`);
    }
  }

  private async branchExists(git: SimpleGit, branch: string): Promise<boolean> {
    try {
      await git.raw(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private gitFor(dir: string): SimpleGit {
    return this.deps.gitFactory?.(dir) ?? simpleGit(dir);
  }
}
