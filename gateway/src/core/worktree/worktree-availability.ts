/**
 * worktree 归属（设计 2026-11-02 §7.1）：
 *
 * worktree 是 **gateway 自己的 git 工作区能力**，不是某个 runtime 的专有能力。
 * 是否可用由两个中立事实共同决定：
 *   1. 本地目录是 git 工作区（gateway 能 `git worktree add`）；
 *   2. runtime 支持 `session.create({ directory })`（会话目录契约）。
 *
 * 不再读取 `capabilities.worktreeApi` —— 用 runtime 能力位会把支持目录会话的
 * pi/claude 误判为不支持。
 */
import { simpleGit } from 'simple-git';

export interface WorktreeAvailabilityInput {
  /** 目标工作目录（绝对路径；空/空白视为未解析）。 */
  directory: string;
  /** runtime 是否支持把会话创建在指定目录（`session.create({directory})` 契约）。 */
  directorySupported: boolean;
  /** 本地目录是否可用于 git worktree。 */
  gitAvailable: boolean;
}

export type WorktreeUnavailableReason = 'unsupported' | 'missing-data';

export interface WorktreeAvailability {
  supported: boolean;
  reason?: WorktreeUnavailableReason;
}

/** worktree 分支不可用（路由层映射为 409；不创建 worktree，也不创建会话）。 */
export class WorktreeUnavailableError extends Error {
  readonly code = 'worktree.unavailable' as const;
  constructor(readonly reason: WorktreeUnavailableReason) {
    super(`worktree sessions are not available (${reason})`);
    this.name = 'WorktreeUnavailableError';
  }
}

export function resolveWorktreeAvailability(input: WorktreeAvailabilityInput): WorktreeAvailability {
  if (!input.directorySupported) return { supported: false, reason: 'unsupported' };
  if (!input.gitAvailable || !input.directory?.trim()) {
    return { supported: false, reason: 'missing-data' };
  }
  return { supported: true };
}

/** 本地 git 可用性探测（非仓库/目录不存在/无 git → false，fail-open）。 */
export async function probeGitWorktreeSupport(directory: string): Promise<boolean> {
  if (!directory?.trim()) return false;
  try {
    return await simpleGit(directory).checkIsRepo();
  } catch {
    return false;
  }
}
