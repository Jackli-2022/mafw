import { Readable } from 'node:stream';
import { handleStructuredGet, handleStructuredSubmit } from '../../../src/routes/structured';
import { StructuredOutputService } from '../../../src/runtime/structured-output';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}

function fakeReq(body: any) {
  return Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST', url: '/api/structured/submit' }) as any;
}

const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };

describe('structured routes', () => {
  it('accepts a valid submission', async () => {
    const service = new StructuredOutputService();
    service.register('s1', { schema });
    const res = fakeRes();
    await handleStructuredSubmit(fakeReq({ sessionID: 's1', data: { ok: true } }), res, { service });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, errors: [] });
    expect(service.submitted('s1')).toEqual({ ok: true });
  });

  it('returns 200 ok:false with validation errors', async () => {
    const service = new StructuredOutputService();
    service.register('s1', { schema });
    const res = fakeRes();
    await handleStructuredSubmit(fakeReq({ sessionID: 's1', data: { ok: 'yes' } }), res, { service });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(false);
    expect(JSON.parse(res.body).errors[0]).toContain('$.ok');
  });

  it('400 on missing schema / missing data / missing session', async () => {
    const service = new StructuredOutputService();
    const a = fakeRes();
    await handleStructuredSubmit(fakeReq({ sessionID: 'none', data: {} }), a, { service });
    expect(a.status).toBe(400);
    const b = fakeRes();
    await handleStructuredSubmit(fakeReq({ sessionID: 's1' }), b, { service });
    expect(b.status).toBe(400);
    const c = fakeRes();
    await handleStructuredSubmit(fakeReq({ data: {} }), c, { service });
    expect(c.status).toBe(400);
  });

  it('GET returns state or 404', () => {
    const service = new StructuredOutputService();
    service.register('s1', { schema });
    service.submit('s1', { ok: true });
    const ok = fakeRes();
    handleStructuredGet(ok, 's1', { service });
    expect(ok.status).toBe(200);
    expect(JSON.parse(ok.body)).toMatchObject({ submitted: { ok: true } });
    const miss = fakeRes();
    handleStructuredGet(miss, 'none', { service });
    expect(miss.status).toBe(404);
  });
});
