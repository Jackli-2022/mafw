import * as http from 'http';
import { handleRuntimeGet } from '../../../src/routes/runtime-switch';

function fakeRes(): { res: http.ServerResponse; status: () => number; body: () => string } {
  const res = {} as unknown as http.ServerResponse;
  let status = 0;
  let payload = '';
  (res as any).writeHead = (s: number) => { status = s; return res; };
  (res as any).end = (b: string) => { payload = b ?? ''; return res; };
  return { res, status: () => status, body: () => payload };
}

describe('GET /api/runtime (unknownEvents exposure)', () => {
  it('includes unknownEvents snapshot in response', async () => {
    const { res, status, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'my-runtime',
      runtimeCaps: () => ({}),
      envOverride: () => false,
      unknownEvents: () => ({ 'my-runtime': { 'weird.event': 3 } }),
    } as any);
    expect(status()).toBe(200);
    const parsed = JSON.parse(body());
    expect(parsed.unknownEvents).toEqual({ 'my-runtime': { 'weird.event': 3 } });
  });

  it('returns empty object when tracker absent', async () => {
    const { res, body } = fakeRes();
    await handleRuntimeGet({} as http.IncomingMessage, res, {
      runtimeName: () => 'opencode',
      runtimeCaps: () => ({}),
      envOverride: () => false,
    } as any);
    expect(JSON.parse(body()).unknownEvents).toEqual({});
  });
});
