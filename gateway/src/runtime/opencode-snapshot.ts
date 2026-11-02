/**
 * opencode 快照仓库定位（session.snapshotTree 通道的 adapter 实现）。
 *
 * 私有知识集中点：opencode 把回合快照放在
 * `<data>/opencode/snapshot/<projectID>/<repoDir>`（XDG_DATA_HOME 或
 * ~/.local/share），仓库是裸 git dir（HEAD/objects 直接在根下）。
 * gateway 业务核心只经 RuntimeSnapshotTreeChannel 拿到「仓库路径」。
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { defaultGit, type GitRunner } from '../core/diff/turn-diff';
import type { RuntimeSnapshotTreeChannel } from './contract';

/** 覆盖探针/测试用：快照根目录。 */
export function defaultSnapshotRoot(): string {
  const override = process.env.MAFW_OPENCODE_SNAPSHOT_ROOT;
  if (override) return override;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'opencode', 'snapshot');
  return path.join(os.homedir(), '.local', 'share', 'opencode', 'snapshot');
}

function listDirectories(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

async function hasTrees(repo: string, start: string, end: string, git: GitRunner): Promise<boolean> {
  try {
    const startResult = await git.run(['--git-dir', repo, 'cat-file', '-t', start]);
    if (startResult.code !== 0 || startResult.stdout.trim() !== 'tree') return false;
    const endResult = await git.run(['--git-dir', repo, 'cat-file', '-t', end]);
    return endResult.code === 0 && endResult.stdout.trim() === 'tree';
  } catch {
    return false;
  }
}

/** 在 snapshot 根下扫描包含两棵树的仓库；projectID 只是加速提示。 */
export async function findOpenCodeSnapshotRepo(opts: {
  root: string;
  projectID?: string;
  start: string;
  end: string;
  git: GitRunner;
}): Promise<string | null> {
  const { root, projectID, start, end, git } = opts;
  const safeProjectID = projectID
    && !path.isAbsolute(projectID)
    && !projectID.includes('/')
    && !projectID.includes('\\')
    && !projectID.includes('..')
    ? projectID
    : null;

  const candidates: string[] = [];
  if (safeProjectID) {
    for (const repo of listDirectories(path.join(root, safeProjectID))) {
      candidates.push(repo);
    }
  }
  for (const projectDir of listDirectories(root)) {
    if (safeProjectID && path.basename(projectDir) === safeProjectID) continue;
    for (const repo of listDirectories(projectDir)) {
      candidates.push(repo);
    }
  }

  for (const repo of candidates) {
    if (await hasTrees(repo, start, end, git)) return repo;
  }
  return null;
}

/** `session.snapshotTree` 的 opencode 实现（root/git 可注入，便于测试）。 */
export function createOpenCodeSnapshotTreeChannel(opts: {
  root?: string;
  git?: GitRunner;
} = {}): RuntimeSnapshotTreeChannel {
  return {
    locate: ({ projectID, start, end }) => findOpenCodeSnapshotRepo({
      root: opts.root ?? defaultSnapshotRoot(),
      projectID,
      start,
      end,
      git: opts.git ?? defaultGit,
    }),
  };
}
