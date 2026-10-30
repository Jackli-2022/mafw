import * as http from 'http';
import { handlePodA2A } from '../../../src/routes/pod-a2a';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
    headers: {},
    writeHead(s: number, h?: Record<string, string>) { this.status = s; this.headers = h ?? {}; },
    end(b?: string | Buffer) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string | Buffer; headers: Record<string, string> };
}

function mockReq(method: string, body?: unknown, remoteAddress = '127.0.0.1'): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    headers: { 'a2a-version': '1.0' },
    socket: { remoteAddress },
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(Buffer.from(JSON.stringify(body)));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

const agent = {
  agentCard: { name: 'pod', url: 'http://x/a2a/pods/pod_1' },
  getArtifact: (id: string) => (id === 'a.md' ? { path: __filename, contentType: 'text/markdown' } : null),
  handleJsonRpc: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }),
};
const deps = { getAgent: (id: string) => (id === 'pod_1' ? agent as any : null) };

async function call(method: string, url: string, body?: unknown, remoteAddress?: string) {
  const res = mockRes();
  const handled = await handlePodA2A(mockReq(method, body, remoteAddress), res, url, deps);
  return { handled, res };
}

describe('pod A2A routes', () => {
  test('serves the card and rejects non-loopback', async () => {
    const card = await call('GET', '/a2a/pods/pod_1/.well-known/agent-card.json');
    expect(card.handled).toBe(true);
    expect(card.res.status).toBe(200);
    expect(JSON.parse(card.res.body as string).name).toBe('pod');

    const foreign = await call('GET', '/a2a/pods/pod_1/.well-known/agent-card.json', undefined, '10.0.0.1');
    expect(foreign.res.status).toBe(403);
  });

  test('forwards JSON-RPC and 404s unknown pods', async () => {
    const rpc = await call('POST', '/a2a/pods/pod_1', { jsonrpc: '2.0', id: '1', method: 'message/send', params: {} });
    expect(rpc.res.status).toBe(200);
    expect(rpc.res.body).toContain('ok');
    const missing = await call('GET', '/a2a/pods/pod_2/.well-known/agent-card.json');
    expect(missing.res.status).toBe(404);
  });

  test('rejects traversal artifacts', async () => {
    const bad = await call('GET', '/a2a/pods/pod_1/artifacts/..%2Fsecret');
    expect(bad.res.status).toBe(400);
  });

  test('falls through unrelated paths', async () => {
    const result = await call('GET', '/api/other');
    expect(result.handled).toBe(false);
  });
});
