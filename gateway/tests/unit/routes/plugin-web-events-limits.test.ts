/**
 * E4-4/E4-5 plugin-web SSE（batch-2 review fix）。
 *
 * 插件事件流此前绕过连接表与有界写：它能无限建立流（超过网关 SSE 上限）
 * 且慢插件页面可以让 `res.write` 缓冲无界增长。现在它和 `/api/events`
 * 共用同一套 503 / writer 语义（spec §4.4/§4.5），并保持原有过滤/心跳行为。
 */
import { EventEmitter } from 'events';
import type { IncomingMessage, ServerResponse } from 'http';
import { createPluginWebTicketStore } from '../../../src/plugins/plugin-web-ticket';
import { handlePluginWebEvents, type PluginWebRouteDeps } from '../../../src/routes/plugin-web';
import { ConnectionTable } from '../../../src/resources/connections';
import { BufferCounters } from '../../../src/resources/outbound-buffer';

class FakeReq extends EventEmitter {
  method = 'GET';
  socket = { remoteAddress: '127.0.0.1' };
  constructor(public url: string, public headers: Record<string, string>) {
    super();
  }
}

class FakeRes extends EventEmitter {
  status = 0;
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

function makeDeps(over: Partial<PluginWebRouteDeps> = {}) {
  const tickets = createPluginWebTicketStore();
  const deps: PluginWebRouteDeps = {
    isActivePackage: (name: string) => name === 'demo',
    packageDir: () => '/repo/demo',
    listProjects: () => ['/repo'],
    listWorktreeDirs: () => [],
    httpRegistry: () => undefined,
    isLoopback: () => true,
    defaultProjectDir: () => '/repo',
    attachEventStream: () => () => undefined,
    tickets,
    ...over,
  };
  return { deps, tickets };
}

function callWith(
  deps: PluginWebRouteDeps,
  tickets: ReturnType<typeof createPluginWebTicketStore>,
  res: FakeRes,
  url = '/api/plugins/demo/events',
): Promise<void> {
  const ticket = tickets.issue('demo', { projectDir: '/repo' });
  const req = new FakeReq(url, {
    host: '127.0.0.1:3000',
    cookie: `mafw_plugin_ticket=${ticket.ticket}`,
  });
  return handlePluginWebEvents(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    deps,
    { name: 'demo' },
  );
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

describe('plugin web events: connection limit (E4-4)', () => {
  it('rejects with 503 before opening a stream (no greeting, no attach)', async () => {
    const table = tableWith(1);
    table.tryAcquire('sse');
    let attached = 0;
    const { deps, tickets } = makeDeps({
      connections: () => table,
      attachEventStream: () => { attached += 1; return () => undefined; },
    });
    const res = new FakeRes();

    await callWith(deps, tickets, res);

    expect(res.status).toBe(503);
    expect(res.frames).toEqual([JSON.stringify({
      error: 'too many sse connections',
      code: 'connection_limit',
    })]);
    expect(attached).toBe(0);
    expect(table.snapshot().refused.sse).toBe(1);
  });

  it('acquires a lease, streams greeting + filtered frames, releases once on close', async () => {
    const table = tableWith(2);
    let sink: ((frame: string, seq: number | null) => void) | undefined;
    let cleaned = 0;
    const { deps, tickets } = makeDeps({
      connections: () => table,
      buffers: () => ({ maxFrames: 16, maxBytes: 4096, counters: new BufferCounters() }),
      attachEventStream: (_res, write) => {
        sink = write;
        return () => { cleaned += 1; };
      },
    });
    const res = new FakeRes();

    await callWith(deps, tickets, res);

    expect(res.status).toBe(200);
    expect(String(res.headers['Content-Type'])).toBe('text/event-stream');
    expect(res.frames).toHaveLength(1);
    expect(JSON.parse(res.frames[0].replace(/^data: /, ''))).toMatchObject({
      type: 'connected',
      package: 'demo',
    });
    expect(table.snapshot().sse).toBe(1);

    sink?.('data: {"type":"plugin:demo:hit","properties":{"n":1}}\n\n', 1);
    sink?.('data: {"type":"plugin:other:hit"}\n\n', 2);
    expect(res.frames.at(-1)).toContain('plugin:demo:hit');
    expect(res.frames.join('')).not.toContain('plugin:other:hit');

    res.emit('close');
    res.emit('close');
    expect(cleaned).toBe(1);
    expect(table.snapshot().sse).toBe(0);
    expect(res.listenerCount('drain')).toBe(0); // writer disposed
  });

  it('keeps the unconfigured path unchanged (no table, no buffers)', async () => {
    const { deps, tickets } = makeDeps();
    const res = new FakeRes();

    await callWith(deps, tickets, res);

    expect(res.status).toBe(200);
    expect(res.frames).toHaveLength(1);
    expect(JSON.parse(res.frames[0].replace(/^data: /, '')).package).toBe('demo');
    res.emit('close');
  });
});

describe('plugin web events: bounded writer (E4-5)', () => {
  it('destroys a slow stream on overflow and releases on close', async () => {
    const table = tableWith(2);
    const counters = new BufferCounters();
    let sink: ((frame: string, seq: number | null) => void) | undefined;
    let cleaned = 0;
    const { deps, tickets } = makeDeps({
      connections: () => table,
      buffers: () => ({ maxFrames: 1, maxBytes: 1 << 20, counters }),
      attachEventStream: (_res, write) => {
        sink = write;
        return () => { cleaned += 1; };
      },
    });
    const res = new FakeRes();
    res.writeReturns = false; // socket is full after the greeting

    await callWith(deps, tickets, res);
    expect(res.frames).toHaveLength(1);

    sink?.('data: {"type":"plugin:demo:a"}\n\n', 1);
    sink?.('data: {"type":"plugin:demo:b"}\n\n', 2); // 2 > maxFrames(1) → overflow

    expect(res.destroyed).toBe(true);
    expect(counters.sseOverflows).toBe(1);
    expect(counters.sseDropped).toBe(2);
    expect(counters.sseQueuedFrames).toBe(0);
    expect(table.snapshot().sse).toBe(1); // released only on close

    res.emit('close');
    expect(cleaned).toBe(1);
    expect(table.snapshot().sse).toBe(0);
    expect(res.listenerCount('drain')).toBe(0);
  });
});
