import { handlePermissionReply } from '../../src/routes/permission';
import * as http from 'http';

function mockRes() {
  const res: any = { status: 0, body: '', writeHead(s: number) { this.status = s; }, end(b?: string) { this.body = b ?? ''; } };
  return res as http.ServerResponse & { status: number; body: string };
}
function mockReq(body: any): http.IncomingMessage {
  const listeners: Record<string, Function[]> = {};
  const req: any = { method: 'POST', on(ev: string, fn: Function) { (listeners[ev] ??= []).push(fn); } };
  setImmediate(() => {
    if (body !== undefined) for (const fn of listeners['data'] ?? []) fn(JSON.stringify(body));
    for (const fn of listeners['end'] ?? []) fn();
  });
  return req as http.IncomingMessage;
}

describe('permission route tri-state body', () => {
  it('accepts {reply, message} and forwards', async () => {
    const permissionReply = jest.fn(async () => true);
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply } } as any,
      mockReq({ reply: 'always', message: 'ok' }), res, 's1', 'r1',
    );
    expect(permissionReply).toHaveBeenCalledWith('s1', 'r1', 'always', 'ok');
    expect(res.status).toBe(200);
  });

  it('accepts legacy {approved: false} as reject', async () => {
    const permissionReply = jest.fn(async () => true);
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply } } as any,
      mockReq({ approved: false }), res, 's1', 'r2',
    );
    expect(permissionReply).toHaveBeenCalledWith('s1', 'r2', 'reject', undefined);
  });

  it('rejects invalid reply value with 400', async () => {
    const permissionReply = jest.fn(async () => true);
    const res = mockRes();
    await handlePermissionReply(
      { capabilities: {}, session: { permissionReply } } as any,
      mockReq({ reply: 'forever' }), res, 's1', 'r3',
    );
    expect(res.status).toBe(400);
    expect(permissionReply).not.toHaveBeenCalled();
  });

  it('503 when runtime lacks permissionReply', async () => {
    const res = mockRes();
    await handlePermissionReply({ capabilities: {}, session: {} } as any, mockReq({ reply: 'once' }), res, 's1', 'r4');
    expect(res.status).toBe(503);
  });
});
