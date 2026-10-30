import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MAX_ARTIFACT_BYTES, handlePodA2A } from '../../../src/routes/pod-a2a';

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

const bigFile = path.join(os.tmpdir(), `mafw-pod-artifact-big-${process.pid}.bin`);
fs.writeFileSync(bigFile, Buffer.alloc(MAX_ARTIFACT_BYTES + 1));

const agent = {
  agentCard: { name: 'pod', url: 'http://x/a2a/pods/pod_1' },
  getArtifact: (id: string) => {
    if (id === 'a.md' || id === 'receipts/a.md') return { path: __filename, contentType: 'text/markdown' };
    if (id === 'big.bin') return { path: bigFile, contentType: 'application/octet-stream' };
    return null;
  },
  handleJsonRpc: async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: '{"ok":true}' }),
};
const deps = { getAgent: (id: string) => (id === 'pod_1' ? agent as any : null) };

afterAll(() => {
  fs.rmSync(bigFile, { force: true });
});

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

  test('serves artifacts with a size header and 413s oversized files', async () => {
    const ok = await call('GET', '/a2a/pods/pod_1/artifacts/a.md');
    expect(ok.res.status).toBe(200);
    expect(ok.res.headers['Content-Type']).toContain('text/markdown');
    expect(Number(ok.res.headers['Content-Length'])).toBeGreaterThan(0);

    const big = await call('GET', '/a2a/pods/pod_1/artifacts/big.bin');
    expect(big.res.status).toBe(413);
    expect(JSON.parse(big.res.body as string).limit).toBe(MAX_ARTIFACT_BYTES);
  });

  test('serves nested artifact refs (receipts/<goal>/<file>)', async () => {
    const nested = await call('GET', '/a2a/pods/pod_1/artifacts/receipts/a.md');
    expect(nested.res.status).toBe(200);
    expect(nested.res.headers['Content-Type']).toContain('text/markdown');
    const encoded = await call('GET', '/a2a/pods/pod_1/artifacts/receipts%2Fa.md');
    expect(encoded.res.status).toBe(200);
  });

  test('falls through unrelated paths', async () => {
    const result = await call('GET', '/api/other');
    expect(result.handled).toBe(false);
  });
});
