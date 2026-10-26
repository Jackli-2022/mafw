import * as http from 'http';
import { handleSessionData } from '../../../src/routes/session-data';
import { DataPartError } from '../../../src/core/data-parts/data-part-service';

function mockRes() {
  const res: any = { status: 0, body: '', writeHead(s: number) { this.status = s; }, end(b?: string) { this.body = b ?? ''; } };
  return res as http.ServerResponse & { status: number; body: string };
}
function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method, on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}
const deps = (service: any) => ({ getRuntime: () => ({ name: 'opencode' }), data: service } as any);

describe('session data route', () => {
  it('creates a data part and returns it', async () => {
    const create = jest.fn(async () => ({ id: 'data_x', type: 'data-swarm', data: { v: 1 } }));
    const res = mockRes();
    const handled = await handleSessionData(mockReq('POST', { name: 'swarm', data: { v: 1 } }), res,
      '/api/sessions/s1/data', deps({ create }));
    expect(handled).toBe(true);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's1', name: 'swarm' }));
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).part.id).toBe('data_x');
  });

  it('503 when the service is missing', async () => {
    const res = mockRes();
    await handleSessionData(mockReq('POST', {}), res, '/api/sessions/s1/data', deps(null));
    expect(res.status).toBe(503);
  });

  it('maps DataPartError status and 500s unexpected errors', async () => {
    for (const status of [400, 404, 409]) {
      const res = mockRes();
      await handleSessionData(mockReq('POST', {}), res, '/api/sessions/s1/data',
        deps({ create: async () => { throw new DataPartError(status, 'x'); } }));
      expect(res.status).toBe(status);
    }
    const res = mockRes();
    await handleSessionData(mockReq('POST', {}), res, '/api/sessions/s1/data',
      deps({ create: async () => { throw new Error('boom'); } }));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body).error).toBe('boom');
  });

  it('tolerates query strings and returns handled=false for other paths', async () => {
    const create = jest.fn(async () => ({ id: 'data_x' }));
    const res = mockRes();
    await handleSessionData(mockReq('POST', { name: 'x', data: {} }), res,
      '/api/sessions/s1/data?x=1', deps({ create }));
    expect(res.status).toBe(200);

    for (const url of ['/api/sessions/s1/checkpoints', '/api/sessions/s1/datas']) {
      const r = mockRes();
      expect(await handleSessionData(mockReq('POST', {}), r, url, deps({ create }))).toBe(false);
    }
  });
});
