/**
 * /api/runtime-config 路由契约测试（Plan 3 Task 6）——新旧双名等价。
 */
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { handleRuntimeConfigGet, handleRuntimeConfigPatch, matchRuntimeConfigRoute, RuntimeConfigRouteDeps } from '../../../src/routes/runtime-config-route';

const deps: RuntimeConfigRouteDeps = {
  getConfig: async () => ({ theme: 'dark' }),
  updateConfig: async (patch) => ({ merged: patch }),
};

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

async function get(port: number, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, body: await res.text() };
}

describe('matchRuntimeConfigRoute（双名匹配）', () => {
  it('新名 runtime-config 与旧名 opencode-config 均命中（GET/PATCH）', () => {
    expect(matchRuntimeConfigRoute('/api/runtime-config', 'GET')).toBe('get');
    expect(matchRuntimeConfigRoute('/api/runtime-config?x=1', 'GET')).toBe('get');
    expect(matchRuntimeConfigRoute('/api/opencode-config', 'GET')).toBe('get');
    expect(matchRuntimeConfigRoute('/api/runtime-config', 'PATCH')).toBe('patch');
    expect(matchRuntimeConfigRoute('/api/opencode-config', 'PATCH')).toBe('patch');
    expect(matchRuntimeConfigRoute('/api/other', 'GET')).toBeNull();
    expect(matchRuntimeConfigRoute('/api/runtime-config', 'POST')).toBeNull();
  });
});

describe('handlers（行为等价）', () => {
  it('GET 返回 config；PATCH 合并返回结果', async () => {
    const port = await listen((req, res) => {
      const kind = matchRuntimeConfigRoute(req.url, req.method ?? '');
      if (kind === 'get') void handleRuntimeConfigGet(req, res, deps);
      else if (kind === 'patch') void handleRuntimeConfigPatch(req, res, deps);
      else { res.writeHead(404); res.end(); }
    });
    const got = await get(port, '/api/runtime-config');
    expect(got.status).toBe(200);
    expect(JSON.parse(got.body)).toEqual({ theme: 'dark' });
    const legacy = await get(port, '/api/opencode-config');
    expect(JSON.parse(legacy.body)).toEqual({ theme: 'dark' }); // 旧名同 handler

    const patchRes = await fetch(`http://127.0.0.1:${port}/api/runtime-config`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}',
    });
    expect(JSON.parse(await patchRes.text())).toEqual({ merged: { a: 1 } });
  });
});
