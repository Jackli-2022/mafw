/**
 * registry dispatch 鉴权门（P0-1）
 *
 * 背景：registry-attached 路由（pods/work/协作面）此前在鉴权之前 dispatch，
 * 远端（Tailscale IP）无 token 可调。本测试钉死：dispatchAuthorized 对
 * 非 loopback 无 token 的 registry 命中一律 401 短路；loopback 保持豁免。
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { dispatchAuthorized } from '../../../src/routes/registry-dispatch';
import { RouteRegistry } from '../../../src/routes/registry';

function fakeReq(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    method: 'POST',
    url: '/api/pods/p1/goals',
    headers,
    socket: { remoteAddress },
  } as any;
}

function fakeRes(): { res: ServerResponse; out: { status?: number; body?: string } } {
  const out: { status?: number; body?: string } = {};
  const res = {
    writeHead: (status: number) => {
      out.status = status;
      return res;
    },
    end: (body?: string) => {
      out.body = body;
    },
  } as any;
  return { res, out };
}

function makeRegistry(handler: jest.Mock): RouteRegistry {
  const registry = new RouteRegistry();
  registry.register({
    method: 'POST',
    path: '/api/pods/:podId/goals',
    operationId: 'test.podGoals',
    handler: handler as any,
  });
  return registry;
}

describe('dispatchAuthorized (P0-1)', () => {
  it('rejects non-loopback request without token: 401, handler not called', async () => {
    const handler = jest.fn(async () => true);
    const registry = makeRegistry(handler);
    const { res, out } = fakeRes();

    const handled = await dispatchAuthorized({ registry, apiToken: 'secret' }, fakeReq('100.1.2.3'), res);

    expect(handled).toBe(true);
    expect(out.status).toBe(401);
    expect(JSON.parse(out.body!)).toEqual({ error: 'unauthorized' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects non-loopback request when apiToken is empty (deny, not permissive)', async () => {
    const handler = jest.fn(async () => true);
    const registry = makeRegistry(handler);
    const { res, out } = fakeRes();

    const handled = await dispatchAuthorized({ registry, apiToken: '' }, fakeReq('100.1.2.3'), res);

    expect(handled).toBe(true);
    expect(out.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches non-loopback request with bearer token to the handler', async () => {
    const handler = jest.fn(async () => true);
    const registry = makeRegistry(handler);
    const { res, out } = fakeRes();

    const handled = await dispatchAuthorized(
      { registry, apiToken: 'secret' },
      fakeReq('100.1.2.3', { authorization: 'Bearer secret' }),
      res,
    );

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][2]).toEqual({ podId: 'p1' });
    expect(out.status).toBeUndefined();
  });

  it('keeps loopback exempt from token checks', async () => {
    const handler = jest.fn(async () => true);
    const registry = makeRegistry(handler);
    const { res } = fakeRes();

    const handled = await dispatchAuthorized({ registry, apiToken: 'secret' }, fakeReq('127.0.0.1'), res);

    expect(handled).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('returns false when no registry route matches', async () => {
    const handler = jest.fn(async () => true);
    const registry = makeRegistry(handler);
    const { res, out } = fakeRes();
    const req = { ...fakeReq('100.1.2.3'), url: '/api/nope' } as any;

    const handled = await dispatchAuthorized({ registry, apiToken: 'secret' }, req, res);

    expect(handled).toBe(false);
    expect(out.status).toBeUndefined();
    expect(handler).not.toHaveBeenCalled();
  });

  it('falls back to legacy chain when handler returns false', async () => {
    const handler = jest.fn(async () => false as any);
    const registry = makeRegistry(handler);
    const { res } = fakeRes();

    const handled = await dispatchAuthorized({ registry, apiToken: 'secret' }, fakeReq('127.0.0.1'), res);

    expect(handled).toBe(false);
  });
});
