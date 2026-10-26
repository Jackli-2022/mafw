/**
 * T2-1 Task 6: /api/sessions/:id/checkpoint(s) 路由（deps 注入）。
 */
import * as http from 'http';
import { handleSessionCheckpoints } from '../../../src/routes/session-checkpoints';
import { CheckpointRestoreError } from '../../../src/core/checkpoint/checkpoint-service';

function mockRes() {
  const res: any = {
    status: 0,
    body: '',
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

function depsWith(runtime: any, service: any) {
  return { getRuntime: () => runtime, checkpoints: service as any };
}

const caps = { capabilities: { checkpointApi: true } };

describe('session checkpoint routes', () => {
  it('503 when runtime lacks checkpointApi', async () => {
    for (const [method, url] of [
      ['POST', '/api/sessions/s1/checkpoint'],
      ['GET', '/api/sessions/s1/checkpoints'],
      ['POST', '/api/sessions/s1/checkpoints/c1/restore'],
    ] as const) {
      const res = mockRes();
      const handled = await handleSessionCheckpoints(mockReq(method, {}), res, url,
        depsWith({ capabilities: {} }, {}));
      expect(handled).toBe(true);
      expect(res.status).toBe(503);
    }
  });

  it('creates a manual checkpoint (explicit messageID passthrough)', async () => {
    const createManual = jest.fn(async () => ({ id: 'ckpt_1', kind: 'manual' }));
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('POST', { messageID: 'u1' }), res,
      '/api/sessions/s1/checkpoint', depsWith(caps, { createManual }));

    expect(createManual).toHaveBeenCalledWith({ sessionID: 's1', messageID: 'u1' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ checkpoint: { id: 'ckpt_1', kind: 'manual' } });
  });

  it('creates with no body (anchor defaults in service)', async () => {
    const createManual = jest.fn(async () => ({ id: 'ckpt_1' }));
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('POST'), res,
      '/api/sessions/s1/checkpoint', depsWith(caps, { createManual }));
    expect(createManual).toHaveBeenCalledWith({ sessionID: 's1', messageID: undefined });
    expect(res.status).toBe(200);
  });

  it('lists checkpoints', async () => {
    const list = jest.fn(() => [{ id: 'ckpt_2' }, { id: 'ckpt_1' }]);
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('GET'), res,
      '/api/sessions/s1/checkpoints', depsWith(caps, { list }));
    expect(list).toHaveBeenCalledWith('s1');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ checkpoints: [{ id: 'ckpt_2' }, { id: 'ckpt_1' }] });
  });

  it('restore requires confirm:true and a valid scope (400, service untouched)', async () => {
    const restore = jest.fn();
    const url = '/api/sessions/s1/checkpoints/c1/restore';

    const noConfirm = mockRes();
    await handleSessionCheckpoints(mockReq('POST', { scope: 'files' }), noConfirm, url,
      depsWith(caps, { restore }));
    expect(noConfirm.status).toBe(400);

    const badScope = mockRes();
    await handleSessionCheckpoints(mockReq('POST', { scope: 'everything', confirm: true }), badScope, url,
      depsWith(caps, { restore }));
    expect(badScope.status).toBe(400);

    expect(restore).not.toHaveBeenCalled();
  });

  it('maps CheckpointRestoreError status (404) and success payload', async () => {
    const restore = jest.fn(async () => { throw new CheckpointRestoreError(404, 'checkpoint not found'); });
    const res404 = mockRes();
    await handleSessionCheckpoints(mockReq('POST', { scope: 'files', confirm: true }), res404,
      '/api/sessions/s1/checkpoints/c1/restore', depsWith(caps, { restore }));
    expect(res404.status).toBe(404);

    const okRestore = jest.fn(async () => ({ scope: 'files', leftoverUntracked: ['x.txt'] }));
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('POST', { scope: 'files', confirm: true }), res,
      '/api/sessions/s1/checkpoints/c1/restore', depsWith(caps, { restore: okRestore }));
    expect(okRestore).toHaveBeenCalledWith({ sessionID: 's1', checkpointId: 'c1', scope: 'files' });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ scope: 'files', leftoverUntracked: ['x.txt'] });
  });

  it('tolerates query strings on every route', async () => {
    const list = jest.fn(() => []);
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('GET'), res,
      '/api/sessions/s1/checkpoints?x=1', depsWith(caps, { list }));
    expect(res.status).toBe(200);
  });

  it('409 while the session is busy (gateway-side apply has no serve busy guard)', async () => {
    const createManual = jest.fn(async () => ({ id: 'ckpt_1' }));
    const res = mockRes();
    const handled = await handleSessionCheckpoints(mockReq('POST', {}), res,
      '/api/sessions/s1/checkpoint',
      { getRuntime: () => caps, checkpoints: { createManual } as any, isBusy: () => true });
    expect(handled).toBe(true);
    expect(res.status).toBe(409);
    expect(createManual).not.toHaveBeenCalled();
  });

  it('returns handled=false for non-matching paths', async () => {
    for (const url of ['/api/sessions/s1/messages', '/api/sessions/s1/checkpointsX', '/api/sessions/s1/diff']) {
      const res = mockRes();
      expect(await handleSessionCheckpoints(mockReq('GET'), res, url, depsWith(caps, {}))).toBe(false);
    }
  });

  it('500s on unexpected errors with a clean message', async () => {
    const createManual = jest.fn(async () => { throw new Error('boom'); });
    const res = mockRes();
    await handleSessionCheckpoints(mockReq('POST', {}), res,
      '/api/sessions/s1/checkpoint', depsWith(caps, { createManual }));
    expect(res.status).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'boom' });
  });
});
