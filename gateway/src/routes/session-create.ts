// POST /api/session — 会话创建（含 worktree 分支），deps 注入可单测。
//
// worktree 归属（设计 2026-11-02 §7.1）：worktree 是 gateway 的 git 工作区能力，
// 可用性 = 本地 git + runtime 的 session.create({directory}) 契约。不可用时在任何
// 会话 / worktree / kv 写入之前返回 409（reason = unsupported | missing-data）。
import * as http from 'http';
import type { WorktreeAvailability } from '../core/worktree/worktree-availability';
import { WorktreeUnavailableError } from '../core/worktree/worktree-availability';
import { createSessionWithWorktree, type WorktreeSessionDeps } from './session-worktree';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, payload: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

export interface SessionCreateDeps extends Omit<WorktreeSessionDeps, 'worktreeAvailability'> {
  /** worktree 可用性判定（生产 = resolveWorktreeAvailability + probeGitWorktreeSupport）。 */
  worktreeAvailability?: (directory: string) => Promise<WorktreeAvailability> | WorktreeAvailability;
}

export async function handleSessionCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionCreateDeps,
): Promise<void> {
  try {
    const body = await readBody(req);
    const opts = body ? JSON.parse(body) : {};
    // 返回形状保持向后兼容：SessionRecord 平铺（顶层 id），可选 worktree 字段——
    // desktop createSession() 读 r.id，包信封会破坏所有既有创建入口。
    const result = await createSessionWithWorktree(deps, opts);
    json(res, 200, { ...result.session, worktree: result.worktree });
  } catch (err: any) {
    if (err instanceof WorktreeUnavailableError) {
      json(res, 409, { error: 'worktree sessions are not available', reason: err.reason });
      return;
    }
    json(res, 500, { error: err?.message ?? String(err) });
  }
}
