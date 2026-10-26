/**
 * T2-2 Task 6: /api/sessions/:id/{suspend,resume,run,run/discard} 路由。
 */
import * as http from 'http';
import { handleSessionRun } from '../../../src/routes/session-run';
import { RunStateError } from '../../../src/core/run/run-state-service';

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

const rt = { capabilities: { runStateApi: true }, name: 'opencode' };

function deps(run: any, runtime: any = rt) {
  return { getRuntime: () => runtime, run };
}

const runDto = { id: 'run_1', sessionID: 's1', status: 'suspended' };

describe('session run routes', () => {
  it('503 without runStateApi for suspend/resume, but GET run and discard still work', async () => {
    for (const [method, url] of [
      ['POST', '/api/sessions/s1/suspend'],
      ['POST', '/api/sessions/s1/resume'],
    ] as const) {
      const res = mockRes();
      const handled = await handleSessionRun(mockReq(method, {}), res, url, deps({}, { capabilities: {} }));
      expect(handled).toBe(true);
      expect(res.status).toBe(503);
    }

    const get = mockRes();
    await handleSessionRun(mockReq('GET'), get, '/api/sessions/s1/run',
      deps({ active: () => null }, { capabilities: {} }));
    expect(get.status).toBe(200);

    const discard = mockRes();
    await handleSessionRun(mockReq('POST', {}), discard, '/api/sessions/s1/run/discard',
      deps({ discard: async () => ({ ...runDto, status: 'cancelled' }) }, { capabilities: {} }));
    expect(discard.status).toBe(200);

    const noRun = mockRes();
    await handleSessionRun(mockReq('POST', {}), noRun, '/api/sessions/s1/suspend', deps(null));
    expect(noRun.status).toBe(503);
  });

  it('suspend passes the optional reason and returns the run', async () => {
    const suspend = jest.fn(async () => runDto);
    const res = mockRes();
    await handleSessionRun(mockReq('POST', { reason: 'lunch' }), res, '/api/sessions/s1/suspend', deps({ suspend }));
    expect(suspend).toHaveBeenCalledWith('s1', 'lunch');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ run: runDto });
  });

  it('resume returns run + prompted', async () => {
    const resume = jest.fn(async () => ({ run: { ...runDto, status: 'resumed' }, prompted: true }));
    const res = mockRes();
    await handleSessionRun(mockReq('POST', {}), res, '/api/sessions/s1/resume', deps({ resume }));
    expect(resume).toHaveBeenCalledWith('s1', undefined);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).prompted).toBe(true);
  });

  it('GET run returns the active run or null', async () => {
    const active = jest.fn(() => runDto);
    const res = mockRes();
    await handleSessionRun(mockReq('GET'), res, '/api/sessions/s1/run', deps({ active }));
    expect(active).toHaveBeenCalledWith('s1');
    expect(JSON.parse(res.body)).toEqual({ run: runDto });

    const empty = mockRes();
    await handleSessionRun(mockReq('GET'), empty, '/api/sessions/s1/run',
      deps({ active: () => null }));
    expect(JSON.parse(empty.body)).toEqual({ run: null });
  });

  it('discard is matched before GET /run and returns the cancelled run', async () => {
    const discard = jest.fn(async () => ({ ...runDto, status: 'cancelled' }));
    const res = mockRes();
    await handleSessionRun(mockReq('POST', {}), res, '/api/sessions/s1/run/discard', deps({ discard }));
    expect(discard).toHaveBeenCalledWith('s1', undefined);
    expect(res.status).toBe(200);
  });

  it('maps RunStateError status and 500s on unexpected errors', async () => {
    const res404 = mockRes();
    await handleSessionRun(mockReq('POST', {}), res404, '/api/sessions/s1/resume',
      deps({ resume: async () => { throw new RunStateError(404, 'run not found'); } }));
    expect(res404.status).toBe(404);

    const res409 = mockRes();
    await handleSessionRun(mockReq('POST', {}), res409, '/api/sessions/s1/suspend',
      deps({ suspend: async () => { throw new RunStateError(409, 'busy'); } }));
    expect(res409.status).toBe(409);

    const res500 = mockRes();
    await handleSessionRun(mockReq('POST', {}), res500, '/api/sessions/s1/suspend',
      deps({ suspend: async () => { throw new Error('boom'); } }));
    expect(res500.status).toBe(500);
    expect(JSON.parse(res500.body).error).toBe('boom');
  });

  it('tolerates query strings and returns handled=false for other paths', async () => {
    const active = jest.fn(() => null);
    const res = mockRes();
    await handleSessionRun(mockReq('GET'), res, '/api/sessions/s1/run?x=1', deps({ active }));
    expect(res.status).toBe(200);

    for (const url of ['/api/sessions/s1/checkpoint', '/api/sessions/s1/runs', '/api/sessions/s1/resumeX']) {
      const r = mockRes();
      expect(await handleSessionRun(mockReq('GET'), r, url, deps({}))).toBe(false);
    }
  });
});
