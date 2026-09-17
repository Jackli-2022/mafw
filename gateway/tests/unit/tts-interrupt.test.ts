import { handleTtsInterrupt } from '../../src/routes/tts-interrupt';
import { Readable } from 'stream';

function fakeReq(body: unknown): any {
  const r = new Readable({ read() { this.push(JSON.stringify(body)); this.push(null); } });
  (r as any).headers = {};
  return r;
}

function fakeRes(): any {
  const out: any = { status: 0, body: '', headers: {} as Record<string, string> };
  out.setHeader = (k: string, v: string) => { out.headers[k] = v; };
  out.writeHead = (s: number) => { out.status = s; return out; };
  out.end = (b?: string) => { out.body = b ?? ''; };
  return out;
}

describe('POST /api/tts/interrupt', () => {
  test('aborts all inflight syntheses for the session and reports count', async () => {
    const inflight = new Map<string, Set<AbortController>>();
    const c1 = new AbortController(); const c2 = new AbortController();
    inflight.set('s1', new Set([c1, c2]));
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({ sessionId: 's1' }), res, { inflight });
    expect(c1.signal.aborted).toBe(true);
    expect(c2.signal.aborted).toBe(true);
    expect(inflight.has('s1')).toBe(false);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, cancelled: 2 });
  });

  test('unknown sessionId returns cancelled: 0', async () => {
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({ sessionId: 'nope' }), res, { inflight: new Map() });
    expect(JSON.parse(res.body)).toEqual({ ok: true, cancelled: 0 });
  });

  test('missing sessionId → 400', async () => {
    const res = fakeRes();
    await handleTtsInterrupt(fakeReq({}), res, { inflight: new Map() });
    expect(res.status).toBe(400);
  });
});
