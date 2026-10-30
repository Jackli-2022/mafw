import type * as http from 'http';
import * as fs from 'fs';
import type { RouteRegistry } from './registry';
import type { PodA2AAgent } from '../core/pod/pod-a2a-agent';

export interface PodA2ARouteDeps {
  getAgent(podId: string): PodA2AAgent | null;
}

const MAX_BODY = 256 * 1024;
/** Cap for artifact downloads (bytes); larger files must be fetched from the workspace. */
export const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLoopback(req: http.IncomingMessage): boolean {
  const address = req.socket?.remoteAddress;
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let rejected = false;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        rejected = true;
        reject(Object.assign(new Error('request body too large'), { status: 413 }));
        if (typeof (req as any).resume === 'function') (req as any).resume();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

export async function handlePodA2A(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string,
  deps: PodA2ARouteDeps,
): Promise<boolean> {
  const pathname = (url.split('?')[0] ?? '');
  const method = req.method || 'GET';

  if (!isLoopback(req)) {
    sendJson(res, 403, { error: 'loopback only' });
    return true;
  }

  const card = pathname.match(/^\/a2a\/pods\/([^/]+)\/\.well-known\/agent-card\.json$/);
  if (card) {
    if (method !== 'GET') return false;
    const agent = deps.getAgent(decode(card[1]));
    if (!agent) {
      sendJson(res, 404, { error: 'pod not found' });
      return true;
    }
    sendJson(res, 200, agent.agentCard);
    return true;
  }

  const artifact = pathname.match(/^\/a2a\/pods\/([^/]+)\/artifacts\/(.+)$/);
  if (artifact) {
    if (method !== 'GET') return false;
    const agent = deps.getAgent(decode(artifact[1]));
    if (!agent) {
      sendJson(res, 404, { error: 'pod not found' });
      return true;
    }
    const found = agent.getArtifact(decode(artifact[2]));
    if (!found) {
      sendJson(res, 400, { error: 'artifact not found or invalid' });
      return true;
    }
    let size = 0;
    try {
      size = fs.statSync(found.path).size;
    } catch {
      sendJson(res, 400, { error: 'artifact not found or invalid' });
      return true;
    }
    if (size > MAX_ARTIFACT_BYTES) {
      sendJson(res, 413, { error: 'artifact too large', bytes: size, limit: MAX_ARTIFACT_BYTES });
      return true;
    }
    res.writeHead(200, { 'Content-Type': found.contentType, 'Content-Length': String(size) });
    res.end(fs.readFileSync(found.path));
    return true;
  }

  const rpc = pathname.match(/^\/a2a\/pods\/([^/]+)$/);
  if (rpc) {
    if (method !== 'POST') return false;
    const agent = deps.getAgent(decode(rpc[1]));
    if (!agent) {
      sendJson(res, 404, { error: 'pod not found' });
      return true;
    }
    try {
      const body = await readBody(req);
      const result = await agent.handleJsonRpc(body, req.headers as Record<string, string | undefined>);
      res.writeHead(result.status, result.headers);
      res.end(result.body);
    } catch (err: any) {
      sendJson(res, err?.status ?? 400, { error: err?.message ?? String(err) });
    }
    return true;
  }

  return false;
}

export function attachPodA2ARoutes(registry: RouteRegistry, deps: PodA2ARouteDeps): void {
  for (const operationId of ['pods.a2a', 'pods.a2aCard', 'pods.a2aArtifact']) {
    registry.attachHandler(operationId, async (req, res) =>
      handlePodA2A(req, res, req.url || '', deps));
  }
}
