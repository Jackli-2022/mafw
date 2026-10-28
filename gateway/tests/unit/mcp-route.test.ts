// gateway/tests/unit/mcp-route.test.ts
// MCP 管理 HTTP 门面（runtime-neutral）：能力门 + 契约调用。
import * as http from 'http';
import { handleMcp } from '../../src/routes/mcp';

function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : undefined; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeDeps(supported = true) {
  const calls: Array<{ op: string; name?: string; directory?: string }> = [];
  return {
    calls,
    deps: {
      supported,
      list: async (opts?: { directory?: string }) => {
        calls.push({ op: 'list', directory: opts?.directory });
        return [{ name: 'mafw', status: 'connected' as const }];
      },
      connect: async (name: string, opts?: { directory?: string }) => {
        calls.push({ op: 'connect', name, directory: opts?.directory });
        return name !== 'bad';
      },
      disconnect: async (name: string, opts?: { directory?: string }) => {
        calls.push({ op: 'disconnect', name, directory: opts?.directory });
        return true;
      },
    },
  };
}

describe('GET /api/mcp/servers', () => {
  it('返回 runtime.mcp.list 的结果并透传 directory', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleMcp({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers?directory=C%3A%5Cwork', deps);
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.servers).toEqual([{ name: 'mafw', status: 'connected' }]);
    expect(calls[0]).toEqual({ op: 'list', directory: 'C:\\work' });
  });

  it('能力缺失 → 503（pi/minimal）', async () => {
    const { deps } = makeDeps(false);
    const { res, out } = makeRes();
    await handleMcp({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers', deps);
    expect(out.status).toBe(503);
    expect(out.body.error).toContain('MCP');
  });

  it('runtime 抛错 → 502', async () => {
    const { deps } = makeDeps();
    const { res, out } = makeRes();
    await handleMcp({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/servers', {
      ...deps,
      list: async () => { throw new Error('boom'); },
    });
    expect(out.status).toBe(502);
    expect(out.body.error).toBe('boom');
  });
});

describe('POST /api/mcp/:name/connect|disconnect', () => {
  it('connect → runtime.mcp.connect', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    await handleMcp({ method: 'POST' } as http.IncomingMessage, res, '/api/mcp/mafw/connect', deps);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect(calls[0]).toEqual({ op: 'connect', name: 'mafw', directory: undefined });
  });

  it('disconnect → runtime.mcp.disconnect', async () => {
    const { deps, calls } = makeDeps();
    const { res } = makeRes();
    await handleMcp({ method: 'POST' } as http.IncomingMessage, res, '/api/mcp/mafw/disconnect', deps);
    expect(calls[0].op).toBe('disconnect');
  });

  it('连接失败 → 502（不抛）', async () => {
    const { deps } = makeDeps();
    const { res, out } = makeRes();
    await handleMcp({ method: 'POST' } as http.IncomingMessage, res, '/api/mcp/bad/connect', deps);
    expect(out.status).toBe(502);
    expect(out.body).toMatchObject({ error: 'connect failed', name: 'bad' });
  });

  it('名字重编码 + 空名不匹配', async () => {
    const { deps, calls } = makeDeps();
    const r1 = makeRes();
    await handleMcp({ method: 'POST' } as http.IncomingMessage, r1.res, '/api/mcp/a%20b/connect', deps);
    expect(calls[0].name).toBe('a b');
    const r2 = makeRes();
    expect(await handleMcp({ method: 'POST' } as http.IncomingMessage, r2.res, '/api/mcp/%20/connect', deps)).toBe(false);
  });

  it('GET 动作路径 / 其它路径不接管', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(await handleMcp({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp/mafw/connect', deps)).toBe(false);
    expect(await handleMcp({ method: 'GET' } as http.IncomingMessage, res, '/api/mcp', deps)).toBe(false);
  });
});
