import { handleSessionSummarize } from '../../src/routes/session-summarize';
import * as http from 'http';

function mockRes() {
  const res: any = {
    status: 0, body: '',
    writeHead(s: number) { this.status = s; },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string, body?: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method,
    on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); },
  };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

function depsWith(runtime: any) {
  return { getRuntime: () => runtime };
}

describe('session-summarize route', () => {
  it('non-matching path returns handled=false', async () => {
    const res = mockRes();
    const handled = await handleSessionSummarize(mockReq('POST'), res, '/api/session/s1/prompt', depsWith(null));
    expect(handled).toBe(false);
  });

  it('proxies to runtime.session.summarize and returns 200 {}', async () => {
    const summarize = jest.fn(async () => ({}));
    const res = mockRes();
    const handled = await handleSessionSummarize(mockReq('POST', {}), res, '/api/session/s1/summarize',
      depsWith({ session: { summarize } }));
    expect(handled).toBe(true);
    expect(summarize).toHaveBeenCalledWith({ sessionID: 's1' });
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({});
  });

  it('passes providerID/modelID body options through', async () => {
    const summarize = jest.fn(async () => ({}));
    const res = mockRes();
    await handleSessionSummarize(mockReq('POST', { providerID: 'xiaomi', modelID: 'mimo' }), res, '/api/session/s1/summarize',
      depsWith({ session: { summarize } }));
    expect(summarize).toHaveBeenCalledWith({ sessionID: 's1', providerID: 'xiaomi', modelID: 'mimo' });
  });

  it('runtime missing → 503; runtime error → 500', async () => {
    const res503 = mockRes();
    await handleSessionSummarize(mockReq('POST', {}), res503, '/api/session/s1/summarize', depsWith(null));
    expect((res503 as any).status).toBe(503);
    const res500 = mockRes();
    await handleSessionSummarize(mockReq('POST', {}), res500, '/api/session/s1/summarize',
      depsWith({ session: { summarize: async () => { throw new Error('boom'); } } }));
    expect((res500 as any).status).toBe(500);
  });

  it('query string does not break matching', async () => {
    const summarize = jest.fn(async () => ({}));
    const res = mockRes();
    const handled = await handleSessionSummarize(mockReq('POST', {}), res, '/api/session/s1/summarize?x=1',
      depsWith({ session: { summarize } }));
    expect(handled).toBe(true);
    expect((res as any).status).toBe(200);
  });
});
