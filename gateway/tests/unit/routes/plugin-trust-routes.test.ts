import * as http from 'http';
import {
  handlePluginPackageInstall,
  handlePluginKill,
  handlePluginResume,
  handlePluginQuarantine,
  handlePluginUnquarantine,
  handlePluginDoctor,
  handlePluginDoctorAll,
  handlePluginAudit,
  handlePluginLastGood,
  handlePluginRollback,
  type PluginPackagesRouteDeps,
} from '../../../src/routes/plugin-packages';

function request(server: http.Server, method: string, path: string, principal: string, body?: unknown) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const addr = server.address() as { port: number };
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        'x-test-principal': principal,
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (chunk) => { chunks += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(chunks) }); }
        catch { resolve({ status: res.statusCode!, body: chunks }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function makeDeps() {
  const manager = {
    installFromPath: jest.fn(async () => ({
      name: 'acme', version: '1.0.0', saved: true, application: 'applied',
    })),
    rollback: jest.fn(async (name: string) => ({
      name, version: '0.9.0', saved: true, enabled: true, application: 'applied',
    })),
  };
  const lastGood = {
    read: jest.fn((name: string) => ({ version: '0.9.0', fingerprint: 'sha256:old', savedAt: '2026-11-14T00:00:00.000Z', name })),
  };
  const safety = {
    kill: jest.fn(async () => ({ safeMode: true, stopped: ['acme'] })),
    resume: jest.fn(async () => ({ safeMode: false, activated: [] })),
    quarantine: jest.fn(),
    unquarantine: jest.fn(),
  };
  const doctor = {
    check: jest.fn(async (name: string) => ({ name, ok: true, checks: [] })),
    checkAll: jest.fn(async () => [{ name: 'acme', ok: true, checks: [] }]),
  };
  const audit = {
    list: jest.fn(() => [{ id: 'pa_1', action: 'install', result: 'ok' }]),
  };
  const revokeWebTickets = jest.fn();
  const reloadAll = jest.fn(async () => undefined);
  const deps: PluginPackagesRouteDeps = {
    manager: () => manager as any,
    snapshot: () => ({ revision: 'boot:1', plugins: [] }),
    safety: () => safety as any,
    doctor: () => doctor as any,
    audit: () => audit as any,
    lastGood: () => lastGood as any,
    revokeWebTickets,
    reloadAll,
  };
  return { deps, manager, safety, doctor, audit, lastGood, revokeWebTickets, reloadAll };
}

function serverFor(deps: PluginPackagesRouteDeps): http.Server {
  return http.createServer(async (req, res) => {
    const principal = req.headers['x-test-principal'] === 'human'
      ? { kind: 'human', method: 'human-token' }
      : { kind: 'service', method: 'api-token' };
    (req as any).mafwPrincipal = principal;
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/packages\/install(?:\?|$)/)) {
      await handlePluginPackageInstall(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/kill(?:\?|$)/)) {
      await handlePluginKill(req, res, deps); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/resume(?:\?|$)/)) {
      await handlePluginResume(req, res, deps); return;
    }
    const quarantine = req.url?.match(/^\/api\/plugins\/([^/]+)\/quarantine(?:\?|$)/);
    if (req.method === 'POST' && quarantine) {
      await handlePluginQuarantine(req, res, deps, { name: quarantine[1] }); return;
    }
    const unquarantine = req.url?.match(/^\/api\/plugins\/([^/]+)\/unquarantine(?:\?|$)/);
    if (req.method === 'POST' && unquarantine) {
      await handlePluginUnquarantine(req, res, deps, { name: unquarantine[1] }); return;
    }
    if (req.method === 'POST' && req.url?.match(/^\/api\/plugins\/doctor(?:\?|$)/)) {
      await handlePluginDoctorAll(req, res, deps); return;
    }
    const doctor = req.url?.match(/^\/api\/plugins\/([^/]+)\/doctor(?:\?|$)/);
    if (req.method === 'POST' && doctor) {
      await handlePluginDoctor(req, res, deps, { name: doctor[1] }); return;
    }
    const lastGood = req.url?.match(/^\/api\/plugins\/([^/]+)\/last-good(?:\?|$)/);
    if (req.method === 'GET' && lastGood) {
      await handlePluginLastGood(req, res, deps, { name: lastGood[1] }); return;
    }
    const rollback = req.url?.match(/^\/api\/plugins\/([^/]+)\/rollback(?:\?|$)/);
    if (req.method === 'POST' && rollback) {
      await handlePluginRollback(req, res, deps, { name: rollback[1] }); return;
    }
    if (req.method === 'GET' && req.url?.match(/^\/api\/plugins\/audit(?:\?|$)/)) {
      await handlePluginAudit(req, res, deps); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ error: 'not found' }));
  });
}

describe('plugin trust routes', () => {
  let server: http.Server;
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(async () => {
    deps = makeDeps();
    server = serverFor(deps.deps);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects a v2 install from a service principal', async () => {
    const res = await request(server, 'POST', '/api/plugins/packages/install', 'service', {
      path: 'C:/tmp/acme', accept: { trust: 'trusted', permissions: ['actions'] },
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('human_principal_required');
    expect(deps.manager.installFromPath).not.toHaveBeenCalled();
  });

  it('passes a v2 install from a human principal to the manager', async () => {
    const res = await request(server, 'POST', '/api/plugins/packages/install', 'human', {
      path: 'C:/tmp/acme', accept: { trust: 'trusted', permissions: ['actions'] },
    });
    expect(res.status).toBe(200);
    expect(deps.manager.installFromPath).toHaveBeenCalledWith({
      path: 'C:/tmp/acme', overwrite: undefined, requestId: undefined,
      accept: { trust: 'trusted', permissions: ['actions'] },
    });
  });

  it('kill accepts a service principal and resumes requires human', async () => {
    expect((await request(server, 'POST', '/api/plugins/kill', 'service')).status).toBe(200);
    expect(deps.revokeWebTickets).toHaveBeenCalledWith('acme');
    expect((await request(server, 'POST', '/api/plugins/resume', 'service')).status).toBe(403);
    expect((await request(server, 'POST', '/api/plugins/resume', 'human')).status).toBe(200);
    expect(deps.reloadAll).toHaveBeenCalled();
  });

  it('quarantine accepts a service principal and unquarantine requires human', async () => {
    expect((await request(server, 'POST', '/api/plugins/acme/quarantine', 'service', {
      reason: 'integrity mismatch',
    })).status).toBe(200);
    expect(deps.safety.quarantine).toHaveBeenCalledWith('acme', 'integrity mismatch', expect.any(Object));
    expect((await request(server, 'POST', '/api/plugins/acme/unquarantine', 'service')).status).toBe(403);
    expect((await request(server, 'POST', '/api/plugins/acme/unquarantine', 'human')).status).toBe(200);
  });

  it('doctor routes return single and all reports', async () => {
    const one = await request(server, 'POST', '/api/plugins/acme/doctor', 'service');
    expect(one.body).toMatchObject({ name: 'acme', ok: true });
    const all = await request(server, 'POST', '/api/plugins/doctor', 'service');
    expect(all.body).toEqual([{ name: 'acme', ok: true, checks: [] }]);
  });

  it('audit returns recent events and validates the limit', async () => {
    const ok = await request(server, 'GET', '/api/plugins/audit?limit=10', 'service');
    expect(ok.body.events[0].action).toBe('install');
    const bad = await request(server, 'GET', '/api/plugins/audit?limit=0', 'service');
    expect(bad.status).toBe(400);
  });

  it('last-good returns the snapshot metadata', async () => {
    const res = await request(server, 'GET', '/api/plugins/acme/last-good', 'service');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'acme', lastGood: { version: '0.9.0' } });
  });

  it('rollback requires human and calls the manager', async () => {
    expect((await request(server, 'POST', '/api/plugins/acme/rollback', 'service')).status).toBe(403);
    expect((await request(server, 'POST', '/api/plugins/acme/rollback', 'human')).status).toBe(200);
    expect(deps.manager.rollback).toHaveBeenCalledWith('acme');
  });
});
