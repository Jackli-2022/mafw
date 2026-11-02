/**
 * Task 4：terminal REST 门面（loopback + surface 门 + 中性 503）。
 */
import * as http from 'http';
import { Readable } from 'stream';
import { handleTerminal } from '../../../src/routes/terminal';
import { TerminalService, type TerminalServiceOptions } from '../../../src/terminal/terminal-service';
import type { RuntimePtyChannel } from '../../../src/runtime/pty';

function fakeChannel(overrides: Partial<RuntimePtyChannel> = {}): RuntimePtyChannel {
  return {
    async create() { return { id: 'pty_1' }; },
    async connect() { return { url: 'ws://127.0.0.1:4096/api/pty/pty_1/connect?ticket=native' }; },
    async resize() { /* noop */ },
    async remove() { /* noop */ },
    ...overrides,
  };
}

function service(runtime: { pty?: RuntimePtyChannel } | null, extra: Partial<TerminalServiceOptions> = {}): TerminalService {
  return new TerminalService({ getRuntime: () => runtime, ...extra });
}

function request(method: string, url: string, body?: unknown, remoteAddress = '127.0.0.1'): http.IncomingMessage {
  const readable = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage;
  (readable as any).method = method;
  (readable as any).url = url;
  (readable as any).headers = { host: '127.0.0.1:3000' };
  (readable as any).socket = { remoteAddress };
  return readable;
}

function response() {
  const out = { status: 0, body: null as any };
  const res = {
    writeHead(status: number) { out.status = status; },
    end(payload: string) { out.body = payload ? JSON.parse(payload) : null; },
  } as unknown as http.ServerResponse;
  return { res, out };
}

const ACCESS = { can: (id: string) => id === 'terminal.pty' };

describe('handleTerminal', () => {
  it('rejects non-loopback callers before touching the runtime', async () => {
    const { res, out } = response();
    const handled = await handleTerminal(
      request('POST', '/api/terminal/sessions', { directory: 'C:/w' }, '10.0.0.9'),
      res,
      '/api/terminal/sessions',
      { service: service({ pty: fakeChannel() }), access: ACCESS },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(403);
    expect(out.body.error).toMatch(/loopback/i);
  });

  it('returns a neutral 503 when the terminal surface is unavailable', async () => {
    const { res, out } = response();
    await handleTerminal(
      request('POST', '/api/terminal/sessions', { directory: 'C:/w' }),
      res,
      '/api/terminal/sessions',
      { service: service({}), access: { can: () => false } },
    );
    expect(out.status).toBe(503);
    expect(out.body.supported).toBe(false);
    expect(JSON.stringify(out.body)).not.toMatch(/opencode|pi\b/);
  });

  it('creates and lists sessions', async () => {
    const svc = service({ pty: fakeChannel() });
    const created = response();
    await handleTerminal(
      request('POST', '/api/terminal/sessions', { directory: 'C:/w', cols: 90, rows: 20, title: 'MAFW' }),
      created.res,
      '/api/terminal/sessions',
      { service: svc, access: ACCESS },
    );
    expect(created.out.status).toBe(200);
    expect(created.out.body).toEqual({ protocol: 'mafw-terminal/1', id: 'pty_1' });

    const listed = response();
    await handleTerminal(
      request('GET', '/api/terminal/sessions?directory=C%3A%2Fw'),
      listed.res,
      '/api/terminal/sessions?directory=C%3A%2Fw',
      { service: svc, access: ACCESS },
    );
    expect(listed.out.status).toBe(200);
    expect(listed.out.body.supported).toBe(true);
    expect(listed.out.body.sessions).toEqual([
      { id: 'pty_1', directory: 'C:/w', title: 'MAFW', status: 'running' },
    ]);
  });

  it('keeps list readable with supported:false when the runtime has no PTY', async () => {
    const { res, out } = response();
    await handleTerminal(
      request('GET', '/api/terminal/sessions'),
      res,
      '/api/terminal/sessions',
      { service: service({}), access: { can: () => false } },
    );
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ protocol: 'mafw-terminal/1', supported: false, sessions: [] });
  });

  it('issues a single-use connect ticket bound to the directory', async () => {
    const svc = service({ pty: fakeChannel() }, { randomToken: () => 'tk_1', now: () => 1000 });
    const { res, out } = response();
    await handleTerminal(
      request('POST', '/api/terminal/sessions/pty_1/connect-ticket', { directory: 'C:/w' }),
      res,
      '/api/terminal/sessions/pty_1/connect-ticket',
      { service: svc, access: ACCESS },
    );
    expect(out.status).toBe(200);
    expect(out.body).toEqual({
      protocol: 'mafw-terminal/1',
      ticket: 'tk_1',
      url: '/api/terminal/sessions/pty_1/connect?ticket=tk_1',
      expiresAt: 31_000,
    });
    expect(svc.consumeTicket('tk_1', { id: 'pty_1' })).toEqual({ directory: 'C:/w' });
  });

  it('rejects a ticket request without a directory', async () => {
    const { res, out } = response();
    await handleTerminal(
      request('POST', '/api/terminal/sessions/pty_1/connect-ticket', {}),
      res,
      '/api/terminal/sessions/pty_1/connect-ticket',
      { service: service({ pty: fakeChannel() }), access: ACCESS },
    );
    expect(out.status).toBe(400);
    expect(out.body.error).toMatch(/directory/);
  });

  it('removes sessions and ignores unrelated paths', async () => {
    const svc = service({ pty: fakeChannel() });
    const { res, out } = response();
    const handled = await handleTerminal(
      request('DELETE', '/api/terminal/sessions/pty_1?directory=C%3A%2Fw'),
      res,
      '/api/terminal/sessions/pty_1?directory=C%3A%2Fw',
      { service: svc, access: ACCESS },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });

    const pass = response();
    expect(await handleTerminal(request('GET', '/api/other'), pass.res, '/api/other', { service: svc })).toBe(false);
  });
});
