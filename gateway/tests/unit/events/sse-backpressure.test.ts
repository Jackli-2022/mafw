/**
 * E4-4/E4-5 SSE 接线：连接上限 503 + 有界写（spec §4.4/§4.5）。
 *
 * 路由层必须在 attach 之前拒绝（否则 greeting/回放已经写出，客户端会以为
 * 连接成功）；溢出断开后 `sseClients` 必须移除条目，否则广播会一直往死
 * socket 写。回放靠 `since`/Last-Event-ID，断开是安全动作。
 */
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';
import { attachEventsSseRoutes, type EventsSseRouteDeps } from '../../../src/routes/events-sse';
import { ConnectionTable } from '../../../src/resources/connections';
import { BufferCounters } from '../../../src/resources/outbound-buffer';

class FakeReq extends EventEmitter {
  method = 'GET';
  socket = { remoteAddress: '127.0.0.1' };
  constructor(public url: string, public headers: Record<string, string> = { host: '127.0.0.1:3000' }) {
    super();
  }
}

class FakeRes extends EventEmitter {
  status = 200;
  headers: Record<string, unknown> = {};
  frames: string[] = [];
  ended = false;
  destroyed = false;
  writeReturns = true;

  writeHead(status: number, headers?: Record<string, unknown>): void {
    this.status = status;
    if (headers) Object.assign(this.headers, headers);
  }
  write(chunk: unknown): boolean {
    this.frames.push(String(chunk));
    return this.writeReturns;
  }
  end(chunk?: unknown): void {
    if (chunk !== undefined) this.frames.push(String(chunk));
    this.ended = true;
  }
  destroy(): void { this.destroyed = true; }
}

function tableWith(sseClients: number): ConnectionTable {
  return new ConnectionTable({
    limits: () => ({
      httpConnections: 256,
      sseClients,
      wsClients: 64,
      voiceClients: 16,
      terminalClients: 16,
    } as never),
  });
}

function setup(deps: Partial<EventsSseRouteDeps> = {}) {
  const sseClients = new Map<ServerResponse, (frame: string, seq: number | null) => void>();
  const registry = new RouteRegistry().register(...buildRouteCatalog());
  attachEventsSseRoutes(registry, {
    eventStore: () => null,
    sseClients: () => sseClients,
    ...deps,
  });
  const handler = registry.match('GET', '/api/events')?.def.handler!;
  return {
    sseClients,
    call: (req: FakeReq, res: FakeRes) => handler(req, res as unknown as ServerResponse, {} as never),
  };
}

function dataOf(frame: string): any {
  const m = /(?:^|\n)data: (.*)$/s.exec(frame);
  if (!m) throw new Error(`frame has no data line: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]);
}

describe('events SSE: connection limit (E4-4)', () => {
  it('rejects with 503 {code:connection_limit} before attaching (no greeting)', async () => {
    const table = tableWith(1);
    table.tryAcquire('sse');
    const { sseClients, call } = setup({ connections: () => table });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);

    expect(res.status).toBe(503);
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.ended).toBe(true);
    expect(res.frames).toEqual([JSON.stringify({
      error: 'too many sse connections',
      code: 'connection_limit',
    })]);
    expect(sseClients.size).toBe(0);
    expect(table.snapshot().refused.sse).toBe(1);
  });

  it('acquires on attach and releases on req close', async () => {
    const table = tableWith(2);
    const { sseClients, call } = setup({ connections: () => table });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);

    expect(res.status).toBe(200);
    expect(res.frames).toHaveLength(1);
    expect(dataOf(res.frames[0])).toMatchObject({ type: 'connected', vocab: 'v2' });
    expect(sseClients.size).toBe(1);
    expect(table.snapshot().sse).toBe(1);

    req.emit('close');
    expect(sseClients.size).toBe(0);
    expect(table.snapshot().sse).toBe(0);
  });

  it('releases on res close too, exactly once', async () => {
    const table = tableWith(2);
    const { call } = setup({ connections: () => table });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);
    expect(table.snapshot().sse).toBe(1);

    res.emit('close');
    req.emit('close');
    expect(table.snapshot().sse).toBe(0);
  });

  it('keeps the unconfigured path unchanged (no table, no buffers)', async () => {
    const { sseClients, call } = setup();
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);
    expect(res.status).toBe(200);
    expect(res.frames).toHaveLength(1);
    expect(sseClients.size).toBe(1);
    req.emit('close');
  });
});

describe('events SSE: bounded writer (E4-5)', () => {
  const replayStore = () => ({
    headSeq: () => 2,
    replaySince: () => ({
      rows: [
        { seq: 1, envelope: { type: 'a' }, ts: 'T1' },
        { seq: 2, envelope: { type: 'b' }, ts: 'T2' },
      ],
      firstReplayedSeq: 1,
    }),
  });

  it('streams normally when the client keeps up', async () => {
    const counters = new BufferCounters();
    const { sseClients, call } = setup({
      buffers: () => ({ maxFrames: 16, maxBytes: 4096, counters }),
    });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);
    expect(res.status).toBe(200);
    expect(res.frames).toHaveLength(1);

    sseClients.get(res as unknown as ServerResponse)!('data: {"type":"live"}\n\n', 3);
    expect(res.frames.at(-1)).toBe('data: {"type":"live"}\n\n');
    expect(counters.snapshot()).toEqual({
      sseOverflows: 0,
      sseDropped: 0,
      sseWriteErrors: 0,
      sseQueuedFrames: 0,
      sseQueuedBytes: 0,
      wsDropped: 0,
    });
    req.emit('close');
  });

  it('destroys a slow client that overflows the queue, then unregisters on close', async () => {
    const counters = new BufferCounters();
    const { sseClients, call } = setup({
      eventStore: () => replayStore() as never,
      buffers: () => ({ maxFrames: 1, maxBytes: 1 << 20, counters }),
    });
    const req = new FakeReq('/api/events?since=0');
    const res = new FakeRes();
    res.writeReturns = false; // greeting accepted but the socket is full

    await call(req, res);

    // greeting written, two replay frames queued → 2 > maxFrames(1) → overflow
    expect(res.frames).toHaveLength(1);
    expect(res.destroyed).toBe(true);
    expect(counters.sseOverflows).toBe(1);
    expect(counters.sseDropped).toBe(2);
    expect(sseClients.size).toBe(1); // removed only when close arrives

    res.emit('close');
    expect(sseClients.size).toBe(0);
  });

  it('releases the lease and disposes the writer when attach throws', async () => {
    const table = tableWith(2);
    const counters = new BufferCounters();
    const { call } = setup({
      connections: () => table,
      buffers: () => ({ maxFrames: 16, maxBytes: 4096, counters }),
      eventStore: (() => ({ headSeq: () => { throw new Error('boom'); } })) as never,
    });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await expect(call(req, res)).rejects.toThrow('boom');

    expect(res.frames).toEqual([]);
    expect(table.snapshot().sse).toBe(0); // lease released
    expect(res.listenerCount('drain')).toBe(0); // writer disposed
  });

  it('does not write replay/live frames after the writer disposed', async () => {
    const counters = new BufferCounters();
    const { sseClients, call } = setup({
      buffers: () => ({ maxFrames: 16, maxBytes: 4096, counters }),
    });
    const req = new FakeReq('/api/events');
    const res = new FakeRes();

    await call(req, res);
    const write = sseClients.get(res as unknown as ServerResponse)!;
    res.emit('close'); // disposes the writer and unregisters the client

    write('data: {"type":"late"}\n\n', 9);
    expect(res.frames).toHaveLength(1);
    expect(sseClients.size).toBe(0);
    req.emit('close');
  });
});
