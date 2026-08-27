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
    const body = await readBody(req);
    const { approved } = JSON.parse(body);
    if (typeof approved !== 'boolean') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'approved must be a boolean' }));
      return;
    }
    const result = await runtime.session.permissionReply(sessionID, requestId, approved);

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
