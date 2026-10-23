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
      getClient: () => ({ session: { switchAgent: async (o: any) => calls.push(o) } }) as any,
    });
    expect(calls).toEqual([{ sessionID: 's1', agent: 'plan' }]);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('forwards switchModel with Model.Ref passthrough', async () => {
    const calls: any[] = [];
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ model: { providerID: 'gateway', modelID: 'deepseek-v4-flash' }, variant: 'fast' }), res, 's1', 'model', {
      getClient: () => ({ session: { switchModel: async (o: any) => calls.push(o) } }) as any,
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
      getClient: () => ({ session: { switchAgent: async () => {} } }) as any,
    });
    expect(res.status).toBe(400);
  });

  it('runtime without switchAgent → 503', async () => {
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'plan' }), res, 's1', 'agent', {
      getClient: () => ({ session: {} }) as any,
    });
    expect(res.status).toBe(503);
  });

  it('no client → 503', async () => {
    const res = fakeRes();
    await handleSessionSwitch(fakeReq({ agent: 'plan' }), res, 's1', 'agent', { getClient: () => null });
    expect(res.status).toBe(503);
  });
});
