// gateway/tests/unit/mcp-config-route.test.ts
// MCP 配置写入门面：能力门、透传、confirm 门、错误码映射。
import * as http from 'http';
import { handleMcpConfig } from '../../src/routes/mcp-config';

function makeRes() {
  const out = { status: 0, body: '' as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(body?: string) { out.body = body ? JSON.parse(body) : undefined; },
    setHeader() {},
  } as unknown as http.ServerResponse;
  return { res, out };
}

function reqWith(body?: any, method = 'POST'): http.IncomingMessage {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const stream = new (require('stream').Readable)({ read() {} });
  stream.push(raw);
  stream.push(null);
  (stream as any).method = method;
  return stream as unknown as http.IncomingMessage;
}

function makeDeps(supported = true) {
  const calls: any[] = [];
  return {
    calls,
    deps: {
      supported,
      preview: async (input: any) => {
        calls.push({ op: 'preview', input });
        return { token: 't1', target: 'C:/c.jsonc', diff: '+ x' };
      },
      apply: async (input: any) => {
        calls.push({ op: 'apply', input });
        return { applied: true, runtimeApplied: true, backup: 'b1' };
      },
      remove: async (name: string, opts: any) => {
        calls.push({ op: 'remove', name, opts });
        return { applied: true, runtimeApplied: true, backup: 'b2' };
      },
      restore: async (opts: any) => {
        calls.push({ op: 'restore', opts });
        return { applied: true, runtimeApplied: false, backup: 'b3' };
      },
    },
  };
}

describe('MCP config facade', () => {
  test('preview 透传 body', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    const handled = await handleMcpConfig(reqWith({ name: 'x', type: 'remote', url: 'https://x' }), res, '/api/mcp/config/preview', deps);
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body.token).toBe('t1');
    expect(calls[0].input.name).toBe('x');
  });

  test('apply 无 confirm → 400；有 confirm → 透传', async () => {
    const { deps, calls } = makeDeps();
    const r1 = makeRes();
    await handleMcpConfig(reqWith({ name: 'x' }), r1.res, '/api/mcp/config/apply', deps);
    expect(r1.out.status).toBe(400);
    const r2 = makeRes();
    await handleMcpConfig(reqWith({ name: 'x', confirm: true, token: 't1' }), r2.res, '/api/mcp/config/apply', deps);
    expect(r2.out.status).toBe(200);
    expect(r2.out.body.runtimeApplied).toBe(true);
    expect(calls[0].op).toBe('apply');
  });

  test('remove：DELETE /servers/:name + confirm', async () => {
    const { deps, calls } = makeDeps();
    const { res, out } = makeRes();
    await handleMcpConfig(reqWith({ token: 't1', confirm: true }, 'DELETE'), res, '/api/mcp/config/servers/a%20b', deps);
    expect(out.status).toBe(200);
    expect(calls[0]).toMatchObject({ op: 'remove', name: 'a b' });
  });

  test('能力缺失 → 503', async () => {
    const { deps } = makeDeps(false);
    const { res, out } = makeRes();
    await handleMcpConfig(reqWith({}), res, '/api/mcp/config/preview', deps);
    expect(out.status).toBe(503);
  });

  test('错误码映射：etag→409 / exists→400 / not_found→404 / 其它→500', async () => {
    const cases: Array<[string, number]> = [
      ['etag_mismatch', 409],
      ['exists', 400],
      ['type_mismatch', 400],
      ['invalid', 400],
      ['not_found', 404],
      ['io_error', 500],
    ];
    for (const [code, status] of cases) {
      const { deps } = makeDeps();
      const { res, out } = makeRes();
      await handleMcpConfig(reqWith({ confirm: true }), res, '/api/mcp/config/apply', {
        ...deps,
        apply: async () => { const e: any = new Error(code); e.code = code; throw e; },
      });
      expect(out.status).toBe(status);
      expect(out.body.code).toBe(code);
    }
  });

  test('不匹配路径 → handled=false', async () => {
    const { deps } = makeDeps();
    const { res } = makeRes();
    expect(await handleMcpConfig(reqWith({}), res, '/api/mcp/config', deps)).toBe(false);
    expect(await handleMcpConfig(reqWith({}), res, '/api/mcp/servers', deps)).toBe(false);
  });
});
