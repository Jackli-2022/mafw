import { handleTriageDismiss } from '../../src/routes/triage-dismiss';
import * as http from 'http';

function mockRes() {
  const res: any = {
    status: 0, body: '', headers: {} as Record<string, string>,
    writeHead(s: number, h?: Record<string, string>) { this.status = s; if (h) Object.assign(this.headers, h); },
    end(b?: string) { this.body = b ?? ''; },
  };
  return res as http.ServerResponse & { status: number; body: string };
}

function mockReq(method: string): http.IncomingMessage {
  const req: any = { method };
  return req as http.IncomingMessage;
}

function depsWith(over: Partial<Parameters<typeof handleTriageDismiss>[3]> = {}) {
  return {
    rejectTriage: jest.fn((_id: string) => true),
    appendLedger: jest.fn(),
    ...over,
  };
}

describe('triage-dismiss route', () => {
  it('non-matching path returns handled=false', async () => {
    const res = mockRes();
    expect(await handleTriageDismiss(mockReq('POST'), res, '/api/triage/t1/confirm', depsWith() as any)).toBe(false);
    expect(await handleTriageDismiss(mockReq('GET'), res, '/api/triage/t1/dismiss', depsWith() as any)).toBe(false);
    expect(await handleTriageDismiss(mockReq('POST'), res, '/api/triage', depsWith() as any)).toBe(false);
  });

  it('dismisses item and appends ledger entry', async () => {
    const deps = depsWith();
    const res = mockRes();
    const handled = await handleTriageDismiss(mockReq('POST'), res, '/api/triage/t1/dismiss', deps as any);
    expect(handled).toBe(true);
    expect(deps.rejectTriage).toHaveBeenCalledWith('t1');
    expect(deps.appendLedger).toHaveBeenCalledWith(expect.objectContaining({ reason: 'triage_dismissed' }));
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ status: 'dismissed' });
  });

  it('unknown item → status not_found (HTTP 200, 对齐 reject 路由行为)', async () => {
    const res = mockRes();
    await handleTriageDismiss(mockReq('POST'), res, '/api/triage/nope/dismiss',
      depsWith({ rejectTriage: jest.fn(() => false) }) as any);
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ status: 'not_found' });
  });

  it('ledger failure does not break the response', async () => {
    const res = mockRes();
    await handleTriageDismiss(mockReq('POST'), res, '/api/triage/t1/dismiss',
      depsWith({ appendLedger: jest.fn(() => { throw new Error('boom') }) }) as any);
    expect((res as any).status).toBe(200);
    expect(JSON.parse((res as any).body)).toEqual({ status: 'dismissed' });
  });

  it('URL-encoded triage id is decoded', async () => {
    const deps = depsWith();
    const res = mockRes();
    await handleTriageDismiss(mockReq('POST'), res, '/api/triage/t%201/dismiss', deps as any);
    expect(deps.rejectTriage).toHaveBeenCalledWith('t 1');
  });
});
