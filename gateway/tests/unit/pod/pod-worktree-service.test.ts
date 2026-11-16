import Database from 'better-sqlite3';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PodStore } from '../../../src/core/pod/pod-store';
import { PodWorktreeService } from '../../../src/core/pod/pod-worktree-service';
import { simpleGit } from 'simple-git';
import { tmpGitRepo } from '../worktree/tmp-git';

// Full-suite load can push real git merge/remove work past Jest's 5s default.
jest.setTimeout(15_000);

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, encoding: 'utf-8' }).trim();
}

function fixture() {
  const repo = tmpGitRepo('mafw-pod-wt-');
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mafw-pod-wt-db-'));
  const db = new Database(path.join(dbDir, 'test.db'));
  const store = new PodStore(db);
  store.ensurePod({
    id: 'pod_1',
    projectDir: repo,
    name: 'repo',
    now: '2026-11-09T00:00:00.000Z',
  });
  const service = new PodWorktreeService({
    store,
    now: () => '2026-11-09T01:00:00.000Z',
  });
  return {
    repo,
    store,
    service,
    cleanup: () => {
      db.close();
      fs.rmSync(repo, { recursive: true, force: true });
      fs.rmSync(dbDir, { recursive: true, force: true });
    },
  };
}

describe('PodWorktreeService', () => {
  test('ensure creates a worktree and is idempotent', async () => {
    const f = fixture();
    try {
      const first = await f.service.ensure('pod_1', 'goal-1', 1);
      expect(first.status).toBe('active');
      expect(first.branch).toBe('mafw/goal-1-r1');
      expect(fs.existsSync(first.dir)).toBe(true);
      expect(git(f.repo, 'worktree list --porcelain').replace(/\\/g, '/'))
        .toContain(first.dir.replace(/\\/g, '/'));

      const second = await f.service.ensure('pod_1', 'goal-1', 1);
      expect(second.dir).toBe(first.dir);
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)?.dir).toBe(first.dir);
    } finally {
      f.cleanup();
    }
  });

  test('revision 2 starts from the revision 1 branch', async () => {
    const f = fixture();
    try {
      const r1 = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(r1.dir, 'from-rev1.txt'), 'r1\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);

      const r2 = await f.service.ensure('pod_1', 'goal-1', 2);
      expect(r2.baseRef).toBe(r1.branch);
      expect(fs.existsSync(path.join(r2.dir, 'from-rev1.txt'))).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  test('rejects a project directory that is not the repository root', async () => {
    const f = fixture();
    try {
      const sub = path.join(f.repo, 'subdir');
      fs.mkdirSync(sub);
      f.store.ensurePod({
        id: 'pod_sub',
        projectDir: sub,
        name: 'sub',
        now: '2026-11-09T00:00:00.000Z',
      });
      await expect(f.service.ensure('pod_sub', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(f.store.getGoalWorktree('pod_sub', 'goal-1', 1)).toBeNull();
    } finally {
      f.cleanup();
    }
  });

  test('commitPending commits tracked changes, excludes .mafw, and no-ops when clean', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.mkdirSync(path.join(wt.dir, '.mafw'), { recursive: true });
      fs.writeFileSync(path.join(wt.dir, '.mafw', 'state.json'), '{}\n');
      fs.writeFileSync(path.join(wt.dir, 'change.txt'), 'change\n');

      const committed = await f.service.commitPending('pod_1', 'goal-1', 1);
      expect(committed.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(git(wt.dir, 'show --name-only --format= HEAD')).toContain('change.txt');
      expect(git(wt.dir, 'show --name-only --format= HEAD')).not.toContain('.mafw');

      const clean = await f.service.commitPending('pod_1', 'goal-1', 1);
      expect(clean.commit).toBeNull();
    } finally {
      f.cleanup();
    }
  });

  test('mergeForAcceptance merges into main, marks merged, removes worktree, keeps branch', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);

      const result = await f.service.mergeForAcceptance('pod_1', 'goal-1', 1);
      expect(result.mergeCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(fs.existsSync(path.join(f.repo, 'feature.txt'))).toBe(true);
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)).toMatchObject({
        status: 'merged',
        mergeCommit: result.mergeCommit,
      });
      expect(fs.existsSync(wt.dir)).toBe(false);
      expect(git(f.repo, 'branch --list mafw/goal-1-r1')).toContain('mafw/goal-1-r1');
    } finally {
      f.cleanup();
    }
  });

  test('refuses to merge when the project has tracked changes', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(f.repo, 'a.txt'), 'dirty\n');

      await expect(f.service.mergeForAcceptance('pod_1', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(fs.existsSync(wt.dir)).toBe(true);
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)?.status).toBe('active');
    } finally {
      f.cleanup();
    }
  });

  test('aborts a conflicting merge and keeps the worktree', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'a.txt'), 'branch\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(f.repo, 'a.txt'), 'main\n');
      git(f.repo, 'add a.txt');
      git(f.repo, '-c user.name=t -c user.email=t@t commit -m main-change');

      await expect(f.service.mergeForAcceptance('pod_1', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(fs.readFileSync(path.join(f.repo, 'a.txt'), 'utf-8').replace(/\r\n/g, '\n')).toBe('main\n');
      expect(fs.existsSync(wt.dir)).toBe(true);
      expect(git(f.repo, 'status --porcelain')).toBe('');
    } finally {
      f.cleanup();
    }
  });

  test('refuses to merge when the base branch is no longer checked out', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);
      git(f.repo, 'switch -c other');

      await expect(f.service.mergeForAcceptance('pod_1', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(fs.existsSync(wt.dir)).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  test('refuses to accept when the worktree is on another branch', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'rogue.txt'), 'rogue\n');
      git(wt.dir, 'switch -c rogue');
      git(wt.dir, 'add rogue.txt');
      git(wt.dir, '-c user.name=t -c user.email=t@t commit -m rogue-change');

      await expect(f.service.mergeForAcceptance('pod_1', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(fs.existsSync(path.join(f.repo, 'rogue.txt'))).toBe(false);
      expect(fs.existsSync(wt.dir)).toBe(true);
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)?.status).toBe('active');
    } finally {
      f.cleanup();
    }
  });

  test('recovers a worktree whose directory was deleted', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'uncommitted.txt'), 'lost?\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);
      fs.rmSync(wt.dir, { recursive: true, force: true });

      const recovered = await f.service.ensure('pod_1', 'goal-1', 1);
      expect(recovered.dir).toBe(wt.dir);
      expect(fs.existsSync(wt.dir)).toBe(true);
      expect(fs.existsSync(path.join(recovered.dir, 'uncommitted.txt'))).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  test('ensureExisting never creates a new revision checkout', async () => {
    const f = fixture();
    try {
      expect(await f.service.ensureExisting('pod_1', 'goal-1', 1)).toBeNull();
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)).toBeNull();

      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.rmSync(wt.dir, { recursive: true, force: true });
      const existing = await f.service.ensureExisting('pod_1', 'goal-1', 1);
      expect(existing?.dir).toBe(wt.dir);
      expect(fs.existsSync(wt.dir)).toBe(true);
    } finally {
      f.cleanup();
    }
  });

  test('acceptance keeps .mafw artifacts out of the branch but still merges clean work', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.mkdirSync(path.join(wt.dir, '.mafw', 'qa'), { recursive: true });
      fs.writeFileSync(path.join(wt.dir, '.mafw', 'qa', 'artifact.txt'), 'evidence\n');
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');

      const result = await f.service.mergeForAcceptance('pod_1', 'goal-1', 1);
      expect(result.mergeCommit).toMatch(/^[0-9a-f]{40}$/);
      expect(fs.existsSync(path.join(f.repo, 'feature.txt'))).toBe(true);
      expect(fs.existsSync(path.join(f.repo, '.mafw', 'qa', 'artifact.txt'))).toBe(false);
      expect(fs.existsSync(wt.dir)).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  test('refuses to merge when the worktree still has uncommitted non-.mafw changes', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);

      // A merge driver that fails after the auto-commit stage leaves work behind.
      const service = new PodWorktreeService({
        store: f.store,
        now: () => '2026-11-09T01:00:00.000Z',
        gitFactory: (dir) => {
          const git = simpleGit(dir);
          if (dir !== wt.dir) return git;
          return {
            raw: async (args: string[]) => {
              if (args[0] === 'status') {
                return ' M leftover.txt\n';
              }
              return git.raw(args);
            },
            revparse: (args: string[]) => git.revparse(args),
          } as any;
        },
      });
      await expect(service.mergeForAcceptance('pod_1', 'goal-1', 1))
        .rejects.toMatchObject({ status: 409 });
      expect(fs.existsSync(wt.dir)).toBe(true);
      expect(f.store.getGoalWorktree('pod_1', 'goal-1', 1)?.status).toBe('active');
    } finally {
      f.cleanup();
    }
  });
  test('branchDiff returns per-file patches for an unmerged revision', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'feature.txt'), 'feature\n');
      fs.writeFileSync(path.join(wt.dir, 'a.txt'), 'hello\nchanged\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);

      const diff = await f.service.branchDiff('pod_1', 'goal-1', 1);
      expect(diff.branch).toBe('mafw/goal-1-r1');
      expect(diff.files.map((file) => file.file).sort()).toEqual(['a.txt', 'feature.txt']);
      const added = diff.files.find((file) => file.file === 'feature.txt')!;
      expect(added).toMatchObject({ status: 'A', additions: 1, deletions: 0 });
      expect(added.patch).toContain('+feature');
      const modified = diff.files.find((file) => file.file === 'a.txt')!;
      expect(modified.additions).toBe(1);
      expect(modified.patch).toContain('+changed');
    } finally {
      f.cleanup();
    }
  });

  test('branchDiff rejects a missing revision or unknown goal', async () => {
    const f = fixture();
    try {
      await f.service.ensure('pod_1', 'goal-1', 1);
      await expect(f.service.branchDiff('pod_1', 'goal-1', 2))
        .rejects.toMatchObject({ status: 404 });
      await expect(f.service.branchDiff('pod_1', 'unknown', 1))
        .rejects.toMatchObject({ status: 404 });
    } finally {
      f.cleanup();
    }
  });

  test('auto-commits use the fixed MAFW identity', async () => {
    const f = fixture();
    try {
      const wt = await f.service.ensure('pod_1', 'goal-1', 1);
      fs.writeFileSync(path.join(wt.dir, 'identity.txt'), 'x\n');
      await f.service.commitPending('pod_1', 'goal-1', 1);
      expect(git(wt.dir, 'log -1 --format=%an')).toBe('MAFW');
      expect(git(wt.dir, 'log -1 --format=%ae')).toBe('mafw@localhost');
    } finally {
      f.cleanup();
    }
  });
});
