// gateway/tests/unit/mcp-runtime.test.ts
// B3.1：MCP 运行时反代（serve 2.1 v2 API 映射）+ URL 拼接误判回归锚点。
import * as http from 'http';
import { handleMcpRuntime } from '../../src/routes/mcp-runtime';

function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : undefined; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeDeps() {
  const calls: Array<{ path: string; method?: string }> = [];
  return {
    calls,
    deps: {
      fetchServe: async (path: string, init?: { method?: string; body?: string }) => {
        calls.push({ path, method: init?.method });
        if (path === '/mcp' || path.startsWith('/mcp?')) {
          return { status: 200, body: { location: { directory: 'C:/w' }, data: [{ name: 'mafw', status: { status: 'connected' } }] } };
        }
        if (path.startsWith('/experimental/mcp/')) return { status: 204, body: undefined };
        return { status: 404, body: { error: 'nope' } };
      },
    },
  };
}

describe('GET /api/mcp（运行时状态，v2 形状）', () => {
  it('反代 GET /api/mcp 并透传 query', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleMcpRuntime(
      { method: 'GET' } as http.IncomingMessage,
      res,
      '/api/mcp?location=C%3A%5Cwork',
      deps,
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.data[0]).toEqual({ name: 'mafw', status: { status: 'connected' } });
    expect(calls[0]).toEqual({ path: '/mcp?location=C%3A%5Cwork', method: 'GET' });
  });

  it('不吞 /api/mcp/servers（CLI 路由先消费）', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(
      await handleMcpRuntime({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers', deps),
    ).toBe(false);
  });
});

describe('POST /api/mcp/:name/connect|disconnect（映射到 v2 experimental 路径）', () => {
  it('connect → POST /experimental/mcp/:name/connect（204）', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    await handleMcpRuntime(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/mcp/mafw/connect',
      deps,
    );
    expect(out.status).toBe(204);
    expect(calls[0]).toEqual({ path: '/experimental/mcp/mafw/connect', method: 'POST' });
  });

  it('disconnect → POST /experimental/mcp/:name/disconnect', async () => {
    const { deps, calls } = makeDeps();
    const { res } = makeRes();
    await handleMcpRuntime(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/mcp/mafw/disconnect',
      deps,
    );
    expect(calls[0]).toEqual({ path: '/experimental/mcp/mafw/disconnect', method: 'POST' });
  });

  it('名字重编码 + 空名不匹配', async () => {
    const { deps, calls } = makeDeps();
    const { res } = makeRes();
    await handleMcpRuntime(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/mcp/a%20b/connect',
      deps,
    );
    expect(calls[0].path).toBe('/experimental/mcp/a%20b/connect');
    const r2 = makeRes();
    expect(
      await handleMcpRuntime(
        { method: 'POST' } as http.IncomingMessage,
        r2.res,
        '/api/mcp/%20/connect',
        deps,
      ),
    ).toBe(false);
  });

  it('auth 不再接管（v2 无 HTTP 认证路由，UI 只给 /mcps 提示）', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(
      await handleMcpRuntime(
        { method: 'POST' } as http.IncomingMessage,
        res,
        '/api/mcp/sentry/auth',
        deps,
      ),
    ).toBe(false);
  });

  it('GET 动作路径不接管', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(
      await handleMcpRuntime(
        { method: 'GET' } as http.IncomingMessage,
        res,
        '/api/mcp/mafw/connect',
        deps,
      ),
    ).toBe(false);
  });
});
