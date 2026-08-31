import { handlePermissionReply } from '../../src/routes/permission';

// Mock req/res factories — no HTTP server needed
function createMockReq(body: any): any {
  const data = JSON.stringify(body);
  return {
    on: (event: string, cb: any) => {
      if (event === 'data') cb(data);
      if (event === 'end') cb();
    },
  };
}

function createMockRes(): any {
  const res: any = {
    _status: 0,
    _headers: {} as Record<string, string>,
    _body: '',
    writeHead(status: number, headers?: Record<string, string>) {
      res._status = status;
      if (headers) res._headers = { ...res._headers, ...headers };
    },
    end(data: string) { res._body = data; },
  };
  return res;
}

describe('handlePermissionReply', () => {
  it('should call runtime.session.permissionReply and return 200', async () => {
    const permissionReply = jest.fn().mockResolvedValue(true);
    const runtime = { session: { permissionReply } };
    const req = createMockReq({ approved: true });
    const res = createMockRes();

    await handlePermissionReply(runtime, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(200);
    expect(JSON.parse(res._body)).toEqual({ success: true });
    expect(permissionReply).toHaveBeenCalledWith('session-1', 'req-1', true);
  });

  it('should return 404 when permissionReply returns false', async () => {
    const permissionReply = jest.fn().mockResolvedValue(false);
    const runtime = { session: { permissionReply } };
    const req = createMockReq({ approved: false });
    const res = createMockRes();

    await handlePermissionReply(runtime, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(404);
    expect(JSON.parse(res._body)).toEqual({ error: 'Permission request not found' });
  });

  it('should return 503 when runtime does not support permissionReply', async () => {
    const runtime = { session: {} };
    const req = createMockReq({ approved: true });
    const res = createMockRes();

    await handlePermissionReply(runtime, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(503);
    expect(JSON.parse(res._body)).toEqual({ error: 'Runtime does not support permissionReply' });
  });

  it('should return 503 when runtime is null', async () => {
    const req = createMockReq({ approved: true });
    const res = createMockRes();

    await handlePermissionReply(null, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(503);
    expect(JSON.parse(res._body)).toEqual({ error: 'Runtime does not support permissionReply' });
  });

  it('should return 400 when approved is not a boolean', async () => {
    const permissionReply = jest.fn().mockResolvedValue(true);
    const runtime = { session: { permissionReply } };
    const req = createMockReq({ approved: 'yes' });
    const res = createMockRes();

    await handlePermissionReply(runtime, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(400);
    expect(JSON.parse(res._body)).toEqual({ error: 'approved must be a boolean' });
    expect(permissionReply).not.toHaveBeenCalled();
  });

  it('should return 500 when permissionReply throws', async () => {
    const permissionReply = jest.fn().mockRejectedValue(new Error('internal failure'));
    const runtime = { session: { permissionReply } };
    const req = createMockReq({ approved: true });
    const res = createMockRes();

    await handlePermissionReply(runtime, req, res, 'session-1', 'req-1');

    expect(res._status).toBe(500);
    expect(JSON.parse(res._body)).toEqual({ error: 'internal failure' });
  });
});
