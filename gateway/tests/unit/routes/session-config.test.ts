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

  it('missing category / missing service', async () => {
    const no = fakeRes();
    await handleSessionConfigSet(fakeReq({}), no, 's1', { service: fakeService() });
    expect(no.status).toBe(400);
    const unavailable = fakeRes();
    await handleSessionConfigGet(unavailable, 's1', { service: null });
    expect(unavailable.status).toBe(503);
  });
});
