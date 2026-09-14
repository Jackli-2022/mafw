import { handleSessionBranch } from '../../src/routes/session-branch';
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

describe('session-branch routes', () => {
  it('503 when capability missing', async () => {
    const res = mockRes();
    const handled = await handleSessionBranch(mockReq('POST', {}), res, '/api/sessions/s1/fork', depsWith(null));
    expect(handled).toBe(true);
    expect((res as any).status).toBe(503);
  });

  it('fork proxies to runtime and returns session', async () => {
    const fork = jest.fn(async () => ({ id: 'ses_new' }));
    const res = mockRes();
    await handleSessionBranch(mockReq('POST', { messageID: 'm1' }), res, '/api/sessions/s1/fork',
      depsWith({ capabilities: { sessionBranchApi: true }, session: { fork } }));
    expect(fork).toHaveBeenCalledWith({ sessionID: 's1', messageID: 'm1' });
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ session: { id: 'ses_new' } });
  });

  it('revert requires messageID (400) and unrevert 404s when runtime lacks it', async () => {
    const rt = { capabilities: { sessionBranchApi: true }, session: { revert: jest.fn(async () => {}) } };
    const res400 = mockRes();
    await handleSessionBranch(mockReq('POST', {}), res400, '/api/sessions/s1/revert', depsWith(rt));
    expect((res400 as any).status).toBe(400);
    const res404 = mockRes();
    await handleSessionBranch(mockReq('POST', {}), res404, '/api/sessions/s1/unrevert', depsWith(rt));
    expect((res404 as any).status).toBe(404);
  });

  it('revert proxies with partID passthrough', async () => {
    const revert = jest.fn(async () => {});
    const res = mockRes();
    await handleSessionBranch(mockReq('POST', { messageID: 'm1', partID: 'p1' }), res, '/api/sessions/s1/revert',
      depsWith({ capabilities: { sessionBranchApi: true }, session: { revert } }));
    expect(revert).toHaveBeenCalledWith({ sessionID: 's1', messageID: 'm1', partID: 'p1' });
    expect((res as any).status).toBe(200);
  });

  it('non-matching paths return handled=false', async () => {
    const res = mockRes();
    const handled = await handleSessionBranch(mockReq('GET'), res, '/api/sessions/s1/messages', depsWith(null));
    expect(handled).toBe(false);
  });

  it('query string does not break matching (route regex note)', async () => {
    const fork = jest.fn(async () => ({ id: 'ses_new' }));
    const res = mockRes();
    const handled = await handleSessionBranch(mockReq('POST', {}), res, '/api/sessions/s1/fork?directory=/x',
      depsWith({ capabilities: { sessionBranchApi: true }, session: { fork } }));
    expect(handled).toBe(true);
    expect((res as any).status).toBe(200);
  });
});
