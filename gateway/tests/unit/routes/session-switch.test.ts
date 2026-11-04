import { Readable } from 'node:stream';
import { handleSessionSwitch } from '../../../src/routes/session-switch';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}

function fakeReq(body: any) {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
    url: '/api/sessions/s1/agent',
  }) as any;
}

describe('handleSessionSwitch', () => {
  it('forwards switchAgent and returns 200 {ok:true}', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'plan' }), res, 's1', 'agent', {
      getRuntime: () => ({ session: { switchAgent: async (o: any) => calls.push(o) } }) as any,
      getAccess: () => ({ can: () => true }),
    });
    expect(calls).toEqual([{ sessionID: 's1', agent: 'plan' }]);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('forwards switchModel with Model.Ref passthrough', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ model: { providerID: 'gateway', modelID: 'deepseek-v4-flash' }, variant: 'fast' }), res, 's1', 'model', {
      getRuntime: () => ({ session: { switchModel: async (o: any) => calls.push(o) } }) as any,
      getAccess: () => ({ can: () => true }),
    });
    expect(calls).toEqual([{
      sessionID: 's1',
      model: { providerID: 'gateway', modelID: 'deepseek-v4-flash' },
      variant: 'fast',
    }]);
    expect(res.status).toBe(200);
  });

  it('missing agent → 400', async () => {
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({}), res, 's1', 'agent', {
      getRuntime: () => ({ session: { switchAgent: async () => {} } }) as any,
      getAccess: () => ({ can: () => true }),
    });
    expect(res.status).toBe(400);
  });

  it('missing switchAgent surface → neutral 503', async () => {
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'plan' }), res, 's1', 'agent', {
      getRuntime: () => ({ session: {} }) as any,
      getAccess: () => ({ can: (id: string) => id !== 'session.switchAgent' }) as any,
    });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body).error).toBe('runtime does not support session.switchAgent');
  });

  it('no runtime → 503', async () => {
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'plan' }), res, 's1', 'agent', { getRuntime: () => null });
    expect(res.status).toBe(503);
  });
});

describe('handleSessionSwitch · coordinator gate', () => {
  const registry = new Set(['lead', 'manager', 'mafw-create', 'mafw-tech-lead', 'mafw-plan', 'memory-curator']);

  const deps = (calls: any[], opts: { bound?: boolean } = {}) => ({
    getRuntime: () => ({ session: { switchAgent: async (o: any) => { calls.push(o) } } }) as any,
    getAccess: () => ({ can: () => true }),
    isCoordinationSession: () => opts.bound === true,
    isRegistryIdentity: (name: string) => registry.has(name),
  });

  it('non-bound session cannot switch to lead', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'lead' }), res, 's1', 'agent', deps(calls, { bound: false }));
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('coordinator sessions are managed by the pod');
    expect(calls).toEqual([]);
  });

  it('historical manager alias is treated as lead', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'manager' }), res, 's1', 'agent', deps(calls, { bound: false }));
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it('coordination session cannot switch away from lead', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'build' }), res, 's1', 'agent', deps(calls, { bound: true }));
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('coordinator sessions are managed by the pod');
    expect(calls).toEqual([]);
  });

  it('coordination session may re-select lead', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'lead' }), res, 's1', 'agent', deps(calls, { bound: true }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ sessionID: 's1', agent: 'lead' }]);
  });

  it('worker registry identities are blocked', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'mafw-tech-lead' }), res, 's1', 'agent', deps(calls, { bound: false }));
    expect(res.status).toBe(403);
    expect(JSON.parse(res.body).error).toBe('identity is managed by the pod');
    expect(calls).toEqual([]);
  });

  it('mafw-create stays switchable', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'mafw-create' }), res, 's1', 'agent', deps(calls, { bound: false }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ sessionID: 's1', agent: 'mafw-create' }]);
  });

  it('archived (unbound) sessions switch freely', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'build' }), res, 's1', 'agent', deps(calls, { bound: false }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ sessionID: 's1', agent: 'build' }]);
  });
});

