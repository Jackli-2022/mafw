// worktree 会话创建编排与删除联动（切片 4，deps 注入可单测）。
// index.ts 的 POST /api/session 带 worktree 参数时调用 createSessionWithWorktree；
// session 删除链路调 cleanupWorktreeForSession（fail-open，不阻塞删除）。
import * as path from 'path';
import { SessionWorktreeManager } from '../core/engine/session-worktree-manager';

export interface WorktreeSessionDeps {
  kvGet(key: string, id: string): any;
  kvSet(key: string, id: string, value: any): void;
  kvDel(key: string, id: string): void;
  createSession(directory?: string, metadata?: Record<string, unknown>): Promise<{ id: string }>;
  /** 仅测试注入：覆盖 manager 工厂（默认 new SessionWorktreeManager(projectDir)）。 */
  managerFactory?: (projectDir: string) => SessionWorktreeManager;
}

export interface WorktreeSessionResult {
  session: { id: string };
  worktree?: { dir: string; branch: string };
}

const KV_KEY = 'session-worktree';

export async function createSessionWithWorktree(
  deps: WorktreeSessionDeps,
  opts: { directory?: string; worktree?: boolean | string; metadata?: Record<string, unknown> },
): Promise<WorktreeSessionResult> {
  if (!opts.worktree) {
    const session = await deps.createSession(opts.directory, opts.metadata);
    return { session };
  }
  const projectDir = path.resolve(opts.directory ?? '.');
  const slug = typeof opts.worktree === 'string' ? opts.worktree : undefined;
  const manager = deps.managerFactory?.(projectDir) ?? new SessionWorktreeManager(projectDir);
  const wt = await manager.create(slug);
  const session = await deps.createSession(wt.worktreeDir, opts.metadata);
  deps.kvSet(KV_KEY, session.id, { dir: wt.worktreeDir, branch: wt.branch, projectDir });
  return { session, worktree: { dir: wt.worktreeDir, branch: wt.branch } };
}

/** session 删除后的 worktree 联动清理：删映射 + 删 worktree/分支（全部 fail-open）。 */
export async function cleanupWorktreeForSession(deps: WorktreeSessionDeps, sessionID: string): Promise<void> {
  const rec = deps.kvGet(KV_KEY, sessionID);
  if (!rec?.dir) return;
  try {
    if (rec.projectDir) {
      const manager = deps.managerFactory?.(rec.projectDir) ?? new SessionWorktreeManager(rec.projectDir);
      await manager.remove(rec.dir, rec.branch);
    }
  } catch (err: any) {
    console.warn(`[Worktree] cleanup failed for ${sessionID} (non-fatal): ${err?.message}`);
  } finally {
    deps.kvDel(KV_KEY, sessionID);
  }
}
