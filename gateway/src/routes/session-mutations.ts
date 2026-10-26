import * as http from 'http';

export interface SessionClientLike {
  session: {
    delete(opts: { sessionID: string }): Promise<void>;
    // Flat signature — the v2 opencode SDK takes { sessionID, title }, no body wrapper.
    // Optional: runtimes without rename support omit it; the route 503s instead of a TypeError 500.
    update?(opts: { sessionID: string; title: string }): Promise<any>;
  };
}

export interface SessionMutationDeps {
  getCapabilities: () => { sessionApi?: boolean };
  getClient: () => SessionClientLike | null;
  /** 切片 4：session 删除成功后的 worktree 联动清理（fail-open；缺省跳过）。 */
  cleanupWorktree?: (sessionID: string) => Promise<void>;
  /** T2-1：session 删除后清理检查点（fail-open；缺省跳过）。 */
  deleteCheckpoints?: (sessionID: string) => void;
  /** T2-2：session 删除后清理 run 状态（fail-open；缺省跳过）。 */
  deleteRuns?: (sessionID: string) => void;
  /** T2-3：session 删除后清理 data part overlay（fail-open；缺省跳过）。 */
  deleteDataParts?: (sessionID: string) => void;
}

/**
 * DELETE /api/sessions/:id — true forward to serve's native session delete
 * (the legacy /api/session/:id path is an SPA-fallback that answers 200 without
 * deleting anything).
 * PATCH /api/sessions/:id { title } — forward to serve's session update.
 * Returns true when the request was handled (response already written).
 */
export async function handleSessionMutations(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  deps: SessionMutationDeps,
): Promise<boolean> {
  const deleteMatch = req.method === 'DELETE' ? req.url?.match(/^\/api\/sessions\/([^/?]+)(?:\?|$)/) : undefined;
  const patchMatch = req.method === 'PATCH' ? req.url?.match(/^\/api\/sessions\/([^/?]+)(?:\?|$)/) : undefined;
  if (!deleteMatch && !patchMatch) return false;

  const json = (status: number, body: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const sessionID = (deleteMatch || patchMatch)![1];
  if (deps.getCapabilities().sessionApi !== true) {
    json(503, { error: 'runtime does not expose the session API (sessionApi=false)' });
    return true;
  }
  const client = deps.getClient();
  if (!client) {
    json(503, { error: 'LLM client not available' });
    return true;
  }
  try {
    if (deleteMatch) {
      await client.session.delete({ sessionID });
      // 切片 4：worktree 会话删除联动（fail-open，不阻塞删除响应）
      if (deps.cleanupWorktree) {
        await deps.cleanupWorktree(sessionID).catch((e: any) => {
          console.warn(`[Session] worktree cleanup failed for ${sessionID} (non-fatal): ${e?.message}`);
        });
      }
      // T2-1：检查点随会话删除（fail-open）
      try { deps.deleteCheckpoints?.(sessionID); } catch (e: any) {
        console.warn(`[Session] checkpoint cleanup failed for ${sessionID} (non-fatal): ${e?.message}`);
      }
      // T2-2：run 状态随会话删除（fail-open）
      try { deps.deleteRuns?.(sessionID); } catch (e: any) {
        console.warn(`[Session] run cleanup failed for ${sessionID} (non-fatal): ${e?.message}`);
      }
      // T2-3：data part overlay 随会话删除（fail-open）
      try { deps.deleteDataParts?.(sessionID); } catch (e: any) {
        console.warn(`[Session] data part cleanup failed for ${sessionID} (non-fatal): ${e?.message}`);
      }
      json(200, { ok: true });
      return true;
    }
    const raw = await new Promise<string>((resolve) => {
      let chunks = '';
      req.on('data', (c) => chunks += c);
      req.on('error', () => resolve(''));
      req.on('end', () => resolve(chunks));
    });
    let title = '';
    try { title = String(JSON.parse(raw || '{}').title ?? ''); } catch { /* invalid json → empty */ }
    if (!title.trim()) {
      json(400, { error: 'title is required' });
      return true;
    }
    if (typeof client.session.update !== 'function') {
      json(503, { error: `runtime does not implement session.update (rename unsupported)` });
      return true;
    }
    await client.session.update({ sessionID, title: title.trim() });
    json(200, { ok: true });
  } catch (err: any) {
    json(500, { error: err.message });
  }
  return true;
}
