import * as http from 'http';
import { log } from '../core/utils/logger';

export interface ManagerRotateDeps {
  /** Active manager session for a project (gateway DB kv). */
  getManagerSession: (projectDir: string) => { sessionId: string; createdAt?: string | null } | null;
  /** Serialized execution against the per-project manager-session lock. */
  lock: <T>(projectDir: string, fn: () => Promise<T>) => Promise<T>;
  /** Create the first manager session (lazy init path). */
  ensure: (projectDir: string) => Promise<string>;
  /** Demote old session metadata: role → manager-archived, drop pinned/exempt. */
  downgrade: (sessionId: string) => Promise<void>;
  /** Force-create a fresh manager session (kv replace + register + identity). */
  create: (projectDir: string) => Promise<string>;
}

export interface ManagerRotateResult {
  sessionId: string;
  previousSessionId?: string;
  created: 'initial' | 'rotated';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function runManagerRotate(projectDir: string, deps: ManagerRotateDeps): Promise<ManagerRotateResult> {
  return deps.lock(projectDir, async () => {
    const existing = deps.getManagerSession(projectDir);
    if (!existing?.sessionId) {
      const sessionId = await deps.ensure(projectDir);
      return { sessionId, created: 'initial' as const };
    }
    try {
      await deps.downgrade(existing.sessionId);
    } catch (err: any) {
      // Old-session metadata residue only affects the desktop role fallback
      // (fixed separately); rotation must not be blocked by it.
      log.warn(`[ManagerRotate] downgrade old session failed (continuing): ${err.message}`);
    }
    const sessionId = await deps.create(projectDir);
    return { sessionId, previousSessionId: existing.sessionId, created: 'rotated' as const };
  });
}

export async function handleManagerRotate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: ManagerRotateDeps,
): Promise<void> {
  let body: any = {};
  try { body = JSON.parse(await readBody(req)); } catch { /* default {} */ }
  const projectDir = typeof body?.projectDir === 'string' && body.projectDir.trim() ? body.projectDir : null;
  if (!projectDir) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'projectDir is required' }));
    return;
  }
  try {
    const result = await runManagerRotate(projectDir, deps);
    log.info(`[ManagerRotate] rotated manager session for ${projectDir}: ${result.previousSessionId ?? '-'} -> ${result.sessionId} (${result.created})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
