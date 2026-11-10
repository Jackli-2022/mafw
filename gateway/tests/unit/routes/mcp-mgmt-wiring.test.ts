// Phase D1 Task H2: MCP management facade registry wiring — the legacy chain had
// two broad gates (`/^\/api\/mcp\//` → handleMcp, `/^\/api\/mcp\/config\//` →
// handleMcpConfig) that returned false to fall through. The registry now binds the
// eight catalog (method, path) pairs and keeps delegating verbatim, so all gate
// semantics (503 surface names, 502 connect failures, 409/400 config codes) are
// exercised through handleMcp / handleMcpConfig unchanged.
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachMcpMgmtRoutes } from '../../../src/routes/mcp-mgmt';

function fakeReq(opts: { method: string; url: string; body?: string }): IncomingMessage {
  const listeners: Record<string, Array<(c?: unknown) => void>> = {};
  const req: any = {
    method: opts.method,
    url: opts.url,
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    on(ev: string, fn: (c?: unknown) => void) {
      (listeners[ev] = listeners[ev] || []).push(fn);
      return req;
    },
    async *[Symbol.asyncIterator]() {
      if (opts.body !== undefined) yield Buffer.from(opts.body);
    },
  };
  process.nextTick(() => {
    for (const fn of listeners['data'] ?? []) fn(opts.body ?? '');
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as unknown as IncomingMessage;
}

function fakeRes(): { res: ServerResponse; status: number; body: string; headers: Record<string, unknown> } {
  const out = { res: null as unknown as ServerResponse, status: 200, body: '', headers: {} as Record<string, unknown> };
  out.res = {
    writeHead: (status: number, headers?: Record<string, unknown>) => {
      out.status = status;
      if (headers) Object.assign(out.headers, headers);
    },
    end: (payload?: unknown) => { out.body = String(payload ?? ''); },
    setHeader: () => {},
  } as unknown as ServerResponse;
  return { res: out.res, get status() { return out.status; }, get body() { return out.body; }, get headers() { return out.headers; } } as any;
}

function runtime(over: { canList?: boolean; canConnect?: boolean; canConfig?: (surface: string) => boolean } = {}) {
  const calls: Record<string, any[]> = { list: [], connect: [], disconnect: [], preview: [], previewRemove: [], apply: [], remove: [], restore: [] };
  const can = (surface: string) => {
    if (surface === 'mcp.list') return over.canList ?? true;
    if (surface === 'mcp.connect' || surface === 'mcp.disconnect') return over.canConnect ?? true;
    if (over.canConfig) return over.canConfig(surface);
    return true;
  };
  return {
    calls,
    rt: {
      access: { can },
      mcp: {
        list: async (opts?: any) => { calls.list.push(opts); return [{ name: 'a' }, { name: 'b' }]; },
        connect: async (name: string, opts?: any) => { calls.connect.push([name, opts]); return name !== 'dead'; },
        disconnect: async (name: string, opts?: any) => { calls.disconnect.push([name, opts]); return false; },
        config: {
          preview: async (input: any) => { calls.preview.push(input); return { ok: 'preview' }; },
          previewRemove: async (name: string) => { calls.previewRemove.push(name); return { ok: 'preview-remove' }; },
          apply: async (input: any) => { calls.apply.push(input); return { applied: true }; },
          remove: async (name: string, opts: any) => { calls.remove.push([name, opts]); return { removed: name }; },
          restore: async (opts: any) => { calls.restore.push(opts); return { restored: true }; },
        },
      },
    } as any,
  };
}

function setup(over: Parameters<typeof runtime>[0] = {}, rtOverride?: any) {
  const made = runtime(over);
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachMcpMgmtRoutes(registry, { runtime: () => (rtOverride === undefined ? made.rt : rtOverride) });
  return { registry, calls: made.calls };
}

const handlerFor = (registry: RouteRegistry, method: string, url: string) => {
  const m = registry.match(method as never, url);
  if (!m?.def.handler) return undefined;
  const handler = m.def.handler;
  return (req: IncomingMessage, res: ServerResponse) => handler(req, res, m.params);
};

describe('MCP management registry wiring (D1 Task H2)', () => {
  it('binds all eight catalog routes', () => {
    const { registry } = setup();
    const bindings: Array<[string, string, string]> = [
      ['GET', '/api/mcp/servers', 'mcp.servers'],
      ['POST', '/api/mcp/ctx7/connect', 'mcp.connect'],
      ['POST', '/api/mcp/ctx7/disconnect', 'mcp.disconnect'],
      ['POST', '/api/mcp/config/preview', 'mcp.configPreview'],
      ['POST', '/api/mcp/config/preview-remove', 'mcp.configPreviewRemove'],
      ['POST', '/api/mcp/config/apply', 'mcp.configApply'],
      ['POST', '/api/mcp/config/restore', 'mcp.configRestore'],
      ['DELETE', '/api/mcp/config/servers/ctx7', 'mcp.configRemove'],
    ];
    for (const [method, url, op] of bindings) {
      expect(registry.match(method as never, url)?.def.operationId).toBe(op);
      expect(handlerFor(registry, method, url)).toBeDefined();
    }
  });

  it('mcp.servers keeps the canonical surface gate (503 + surface name) and ?directory', async () => {
    let r = fakeRes();
    await handlerFor(setup({ canList: false }).registry, 'GET', '/api/mcp/servers')!(
      fakeReq({ method: 'GET', url: '/api/mcp/servers' }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe("runtime surface 'mcp.list' is not available");

    const { registry, calls } = setup();
    r = fakeRes();
    await handlerFor(registry, 'GET', '/api/mcp/servers?directory=C%3A%2Fproj')!(
      fakeReq({ method: 'GET', url: '/api/mcp/servers?directory=C%3A%2Fproj' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ servers: [{ name: 'a' }, { name: 'b' }] });
    expect(calls.list[0]).toEqual({ directory: 'C:/proj' });
  });

  it('connect/disconnect pass the decoded name and keep the 502 failure envelope', async () => {
    const { registry, calls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/my%20srv/connect')!(
      fakeReq({ method: 'POST', url: '/api/mcp/my%20srv/connect' }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: true });
    expect(calls.connect[0][0]).toBe('my srv');

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/dead/connect')!(
      fakeReq({ method: 'POST', url: '/api/mcp/dead/connect' }), r.res,
    );
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ error: 'connect failed', name: 'dead' });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/ctx7/disconnect')!(
      fakeReq({ method: 'POST', url: '/api/mcp/ctx7/disconnect' }), r.res,
    );
    expect(r.status).toBe(502);
    expect(JSON.parse(r.body)).toEqual({ error: 'disconnect failed', name: 'ctx7' });
    expect(calls.disconnect[0][0]).toBe('ctx7');
  });

  it('config apply/preview delegate verbatim (confirm:true gate intact)', async () => {
    const { registry, calls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/config/preview')!(
      fakeReq({ method: 'POST', url: '/api/mcp/config/preview', body: JSON.stringify({ server: { name: 's1' } }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ok: 'preview' });
    expect(calls.preview[0]).toEqual({ server: { name: 's1' } });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/config/apply')!(
      fakeReq({ method: 'POST', url: '/api/mcp/config/apply', body: JSON.stringify({ server: { name: 's1' } }) }), r.res,
    );
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).error).toBe('confirm:true is required');

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/config/apply')!(
      fakeReq({ method: 'POST', url: '/api/mcp/config/apply', body: JSON.stringify({ server: { name: 's1' }, confirm: true }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ applied: true });
  });

  it('config remove and restore keep their delegation + surface gate', async () => {
    const { registry, calls } = setup();
    let r = fakeRes();
    await handlerFor(registry, 'DELETE', '/api/mcp/config/servers/ctx7')!(
      fakeReq({ method: 'DELETE', url: '/api/mcp/config/servers/ctx7', body: JSON.stringify({ confirm: true }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ removed: 'ctx7' });
    expect(calls.remove[0][0]).toBe('ctx7');
    expect(calls.remove[0][1]).toEqual({ confirm: true });

    r = fakeRes();
    await handlerFor(registry, 'POST', '/api/mcp/config/restore')!(
      fakeReq({ method: 'POST', url: '/api/mcp/config/restore', body: JSON.stringify({ confirm: true, id: 'b1' }) }), r.res,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ restored: true });

    const gated = setup({ canConfig: (surface) => surface !== 'mcp.config.restore' });
    r = fakeRes();
    await handlerFor(gated.registry, 'POST', '/api/mcp/config/restore')!(
      fakeReq({ method: 'POST', url: '/api/mcp/config/restore', body: JSON.stringify({ confirm: true }) }), r.res,
    );
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe("runtime surface 'mcp.config.restore' is not available");
  });

  it('a missing runtime degrades to the neutral 503 (no throw)', async () => {
    const { registry } = setup({}, null);
    const r = fakeRes();
    await handlerFor(registry, 'GET', '/api/mcp/servers')!(fakeReq({ method: 'GET', url: '/api/mcp/servers' }), r.res);
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).error).toBe("runtime surface 'mcp.list' is not available");
  });
});
