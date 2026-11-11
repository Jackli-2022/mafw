/**
 * E4-7 `POST /api/session` 会话配额（spec §4.7）。
 * 配额拒绝必须映射 429（不是 worktree 409 / 通用 500），且不改变成功形状。
 */
import * as path from 'path';
import * as http from 'http';
import { handleSessionCreate, type SessionCreateDeps } from '../../../src/routes/session-create';
import { QuotaExceededError } from '../../../src/resources/quotas';

function makeRes(): { res: http.ServerResponse; out: { status: number; body: any } } {
  const out = { status: 0, body: null as any };
  const res = {
    writeHead(status: number) {
      out.status = status;
    },
    end(body?: string) {
      out.body = body ? JSON.parse(body) : null;
    },
  } as unknown as http.ServerResponse;
  return { res, out };
}

function makeReq(body: unknown): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = {
    method: 'POST',
    url: '/api/session',
    on(ev: string, fn: Function) {
      (listeners[ev] ??= []).push(fn);
    },
  };
  setImmediate(() => {
    for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

function baseDeps(createSession: SessionCreateDeps['createSession']): SessionCreateDeps {
  return {
    kvGet: () => undefined,
    kvSet: () => {},
    kvDel: () => {},
    createSession,
  };
}

const ABS = path.resolve(__dirname, 'quota-project');

describe('POST /api/session: quotas', () => {
  it('maps QuotaExceededError to 429 with resource/limit/current', async () => {
    const deps = baseDeps(async () => {
      throw new QuotaExceededError('sessions', 1000, 1000);
    });
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: ABS }), res, deps);

    expect(out.status).toBe(429);
    expect(out.body).toMatchObject({
      code: 'quota_exceeded',
      resource: 'sessions',
      limit: 1000,
      current: 1000,
    });
    expect(typeof out.body.error).toBe('string');
  });

  it('maps per-project record quota to 429 too', async () => {
    const deps = baseDeps(async () => {
      throw new QuotaExceededError('sessionRecordsPerProject', 200, 200);
    });
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: ABS }), res, deps);
    expect(out.status).toBe(429);
    expect(out.body.resource).toBe('sessionRecordsPerProject');
  });

  it('keeps the 200 flat success shape', async () => {
    const deps = baseDeps(async () => ({ id: 'sess-1' }));
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: ABS }), res, deps);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ id: 'sess-1', worktree: undefined });
  });

  it('keeps the generic 500 for other failures', async () => {
    const deps = baseDeps(async () => {
      throw new Error('boom');
    });
    const { res, out } = makeRes();
    await handleSessionCreate(makeReq({ directory: ABS }), res, deps);
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ error: 'boom' });
  });
});
