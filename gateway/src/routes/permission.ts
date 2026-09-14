import * as http from 'http';
import { AgentRuntime } from '../runtime/contract';

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: string) => body += chunk);
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export async function handlePermissionReply(
  runtime: AgentRuntime | null,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionID: string,
  requestId: string,
): Promise<void> {
  if (!runtime?.session?.permissionReply) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Runtime does not support permissionReply' }));
    return;
  }

  try {
    const body = JSON.parse(await readBody(req) || '{}');
    let reply: 'once' | 'always' | 'reject' | undefined = body.reply;
    let message: string | undefined = body.message;
    if (typeof body.approved === 'boolean' && !reply) {
      reply = body.approved ? 'once' : 'reject'; // legacy bool callers
    }
    if (reply !== 'once' && reply !== 'always' && reply !== 'reject') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: "reply must be 'once'|'always'|'reject'" }));
      return;
    }
    const result = await runtime.session.permissionReply!(sessionID, requestId, reply, message);

    if (!result) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Permission request not found' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  } catch (err: any) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
