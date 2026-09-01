import * as http from 'http';

export interface SessionClientLike {
  session: {
    delete(opts: { sessionID: string }): Promise<void>;
    // Flat signature — the v2 opencode SDK takes { sessionID, title }, no body wrapper.
    update(opts: { sessionID: string; title: string }): Promise<any>;
  };
}

export interface SessionMutationDeps {
  getCapabilities: () => { sessionApi?: boolean };
  getClient: () => SessionClientLike | null;
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
    await client.session.update({ sessionID, title: title.trim() });
    json(200, { ok: true });
  } catch (err: any) {
    json(500, { error: err.message });
  }
  return true;
}
