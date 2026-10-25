import { Readable } from 'node:stream';
import {
  handleSubagentCancel, handleSubagentList, handleSubagentMessage,
  handleSubagentResult, handleSubagentSpawn,
} from '../../../src/routes/subagents';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}
function fakeReq(body: any) {
  return Object.assign(Readable.from([JSON.stringify(body)]), { method: 'POST' }) as any;
}

describe('subagent routes', () => {
  it('spawn forwards parent from the URL and returns the record', async () => {
    const service: any = { spawn: jest.fn(async () => ({ id: 'c1', parentID: 'p1', depth: 1, status: 'running' })) };
    const res = fakeRes();
    await handleSubagentSpawn(fakeReq({ prompt: 'do it', agent: 'general', outputSchema: { schema: {} } }), res, 'p1', { service });
    expect(res.status).toBe(200);
    expect(service.spawn).toHaveBeenCalledWith(expect.objectContaining({
      parentID: 'p1', prompt: 'do it', agent: 'general', outputSchema: { schema: {} },
    }));
    expect(JSON.parse(res.body)).toMatchObject({ id: 'c1', parentID: 'p1' });
  });

  it('spawn prompt failure → 502 with the record', async () => {
    const service: any = { spawn: jest.fn(async () => ({ id: 'c1', status: 'failed', error: 'boom' })) };
    const res = fakeRes();
    await handleSubagentSpawn(fakeReq({ prompt: 'x' }), res, 'p1', { service });
    expect(res.status).toBe(502);
    expect(JSON.parse(res.body)).toMatchObject({ id: 'c1', error: 'boom' });
  });

  it('list/message/cancel/result map service results', async () => {
    const service: any = {
      list: jest.fn(async () => [{ id: 'c1' }]),
      message: jest.fn(async () => {}),
      cancel: jest.fn(async () => {}),
      result: jest.fn(async () => ({ status: 'completed', text: 'ok' })),
    };
    const list = fakeRes();
    await handleSubagentList(list, 'p1', { service });
    expect(JSON.parse(list.body)).toEqual({ items: [{ id: 'c1' }] });

    const msg = fakeRes();
    await handleSubagentMessage(fakeReq({ message: 'hi' }), msg, 'p1', 'c1', { service });
    expect(service.message).toHaveBeenCalledWith('p1', 'c1', 'hi');
    expect(msg.status).toBe(200);

    const cancel = fakeRes();
    await handleSubagentCancel(cancel, 'p1', 'c1', { service });
    expect(service.cancel).toHaveBeenCalledWith('p1', 'c1');

    const result = fakeRes();
    await handleSubagentResult(result, 'p1', 'c1', { service });
    expect(JSON.parse(result.body)).toEqual({ status: 'completed', text: 'ok' });
  });

  it('service 404 maps to 404', async () => {
    const service: any = { message: jest.fn(async () => { throw Object.assign(new Error('nope'), { status: 404 }); }) };
    const res = fakeRes();
    await handleSubagentMessage(fakeReq({ message: 'hi' }), res, 'p1', 'wrong', { service });
    expect(res.status).toBe(404);
  });
});
