import { Readable } from 'node:stream';
import { handleSessionConfigGet, handleSessionConfigSet } from '../../../src/routes/session-config';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}
function fakeReq(body: any) {
  return Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST' }) as any;
}

describe('session config routes', () => {
  const state = { mode: 'auto', agent: 'build', model: { providerID: 'p', modelID: 'm' }, thinkingLevel: 'high' };
  const fakeService = () => ({
    get: jest.fn(async () => state),
    set: jest.fn(async () => state),
  }) as any;

  it('GET returns full config state', async () => {
    const res = fakeRes();
    await handleSessionConfigGet(res, 's1', { service: fakeService() });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ mode: 'auto', thinkingLevel: 'high' });
  });

  it('POST forwards category/value and maps errors', async () => {
    const service = fakeService();
    const res = fakeRes();
    await handleSessionConfigSet(fakeReq({ category: 'thought_level', value: 'max' }), res, 's1', { service });
    expect(service.set).toHaveBeenCalledWith('s1', 'thought_level', 'max');
    expect(res.status).toBe(200);

    service.set.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 400 }));
    const bad = fakeRes();
    await handleSessionConfigSet(fakeReq({ category: 'nope' }), bad, 's1', { service });
    expect(bad.status).toBe(400);
  });

  it('agent category passes through the coordinator gate', async () => {
    const service = fakeService();
    const res = fakeRes();
    const checkAgentSwitch = jest.fn(() => ({ status: 403, error: 'coordinator sessions are managed by the pod' }));
    await handleSessionConfigSet(fakeReq({ category: 'agent', value: 'lead' }), res, 's1', { service, checkAgentSwitch });
    expect(res.status).toBe(403);
    expect(service.set).not.toHaveBeenCalled();

    const ok = fakeRes();
    const service2 = fakeService();
    await handleSessionConfigSet(fakeReq({ category: 'agent', value: 'build' }), ok, 's1', {
      service: service2,
      checkAgentSwitch: () => null,
    });
    expect(ok.status).toBe(200);
    expect(service2.set).toHaveBeenCalledWith('s1', 'agent', 'build');

    // 非 agent 类别不过门
    const other = fakeRes();
    const service3 = fakeService();
    await handleSessionConfigSet(fakeReq({ category: 'thought_level', value: 'high' }), other, 's1', {
      service: service3,
      checkAgentSwitch: () => ({ status: 403, error: 'should not run' }),
    });
    expect(other.status).toBe(200);
  });

  it('missing category / missing service', async () => {
    const no = fakeRes();
    await handleSessionConfigSet(fakeReq({}), no, 's1', { service: fakeService() });
    expect(no.status).toBe(400);
    const unavailable = fakeRes();
    await handleSessionConfigGet(unavailable, 's1', { service: null });
    expect(unavailable.status).toBe(503);
  });
});
