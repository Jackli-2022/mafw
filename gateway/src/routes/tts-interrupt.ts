import type { IncomingMessage, ServerResponse } from 'http';

export interface TtsInterruptDeps {
  inflight: Map<string, Set<AbortController>>;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString('utf8');
}

/** POST /api/tts/interrupt — barge-in：取消该 session 全部在途 TTS 合成。 */
export async function handleTtsInterrupt(
  req: IncomingMessage,
  res: ServerResponse,
  deps: TtsInterruptDeps,
): Promise<void> {
  let sessionId = '';
  try {
    const body = JSON.parse(await readBody(req));
    sessionId = typeof body?.sessionId === 'string' ? body.sessionId : '';
  } catch { /* fallthrough → 400 */ }
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'sessionId is required' }));
    return;
  }
  const set = deps.inflight.get(sessionId);
  const cancelled = set?.size ?? 0;
  if (set) {
    for (const c of set) { try { c.abort(); } catch { /* ignore */ } }
    deps.inflight.delete(sessionId);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, cancelled }));
}
