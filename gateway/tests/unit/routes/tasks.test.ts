import { Readable } from 'node:stream';
import {
  handleTaskCancel, handleTaskGet, handleTaskList, handleTaskMessage,
  handleTaskOutput, handleTaskSubmit,
} from '../../../src/routes/tasks';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}
function fakeReq(body: any) {
  return Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST' }) as any;
}

const task = { id: 't1', kind: 'shell', parentSessionID: 'p1', status: 'working' };

function fakeService() {
  return {
    submit: jest.fn(async () => task),
    list: jest.fn(() => [task]),
    get: jest.fn((id: string) => id === 't1' ? task : undefined),
    cancel: jest.fn(async () => ({ ...task, status: 'cancelled' })),
    message: jest.fn(async () => {}),
    output: jest.fn(async () => ({ output: 'ok', cursor: 2, size: 2, truncated: false })),
  } as any;
}

describe('task routes', () => {
  it('submit forwards body and returns task', async () => {
    const service = fakeService();
    const res = fakeRes();
    await handleTaskSubmit(fakeReq({ kind: 'shell', parentSessionID: 'p1', command: 'echo' }), res, { service });
    expect(res.status).toBe(200);
    expect(service.submit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shell', parentSessionID: 'p1', command: 'echo' }));
  });

  it('list/get/cancel/message/output', async () => {
    const service = fakeService();
    const list = fakeRes();
    handleTaskList(list, { parentSessionID: 'p1' }, { service });
    expect(JSON.parse(list.body).items).toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith({ parentSessionID: 'p1' });

    const get = fakeRes();
    handleTaskGet(get, 't1', { service });
    expect(get.status).toBe(200);
    const missing = fakeRes();
    handleTaskGet(missing, 'nope', { service });
    expect(missing.status).toBe(404);

    const cancel = fakeRes();
    await handleTaskCancel(cancel, 't1', { service });
    expect(JSON.parse(cancel.body).status).toBe('cancelled');

    const msg = fakeRes();
    await handleTaskMessage(fakeReq({ message: 'hi' }), msg, 't1', { service });
    expect(service.message).toHaveBeenCalledWith('t1', 'hi');

    const out = fakeRes();
    await handleTaskOutput(out, 't1', { cursor: 1, limit: 2 }, { service });
    expect(service.output).toHaveBeenCalledWith('t1', { cursor: 1, limit: 2 });
    expect(JSON.parse(out.body).output).toBe('ok');
  });

  it('missing service → 503; service error status preserved', async () => {
    const no = fakeRes();
    handleTaskList(no, {}, { service: null });
    expect(no.status).toBe(503);
    const service = fakeService();
    service.cancel.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }));
    const res = fakeRes();
    await handleTaskCancel(res, 'x', { service });
    expect(res.status).toBe(404);
  });
});
