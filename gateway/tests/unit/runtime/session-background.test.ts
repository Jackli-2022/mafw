import * as http from 'http';
import { handleSessionBackground } from '../../../src/routes/session-background';

function response() {
  const out = { status: 0, body: '' as any };
  return {
    out,
    res: {
      writeHead(status: number) { out.status = status; },
      end(body?: string) { out.body = body ? JSON.parse(body) : undefined; },
    } as unknown as http.ServerResponse,
  };
}

describe('session background route', () => {
  it('calls the neutral runtime method when available', async () => {
    const { res, out } = response();
    const calls: string[] = [];
    const handled = await handleSessionBackground(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/session/s1/background',
      {
        getRuntime: () => ({ session: { background: async ({ sessionID }: any) => { calls.push(sessionID); } } }) as any,
        getAccess: () => ({ can: (id: string) => id === 'session.background' }) as any,
      },
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(calls).toEqual(['s1']);
  });

  it('does not surface native error text on failure', async () => {
    const { res, out } = response();
    await handleSessionBackground(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/session/s1/background',
      {
        getRuntime: () => ({ session: { background: async () => { throw new Error('http://secret-runtime/internal'); } } }) as any,
        getAccess: () => ({ can: () => true }) as any,
      },
    );
    expect(out.status).toBe(500);
    expect(out.body.error).toBe('background request failed');
  });

  it('returns a neutral 503 when the surface is absent', async () => {
    const { res, out } = response();
    await handleSessionBackground(
      { method: 'POST' } as http.IncomingMessage,
      res,
      '/api/session/s1/background',
      {
        getRuntime: () => ({ name: 'secret', session: {} }) as any,
        getAccess: () => ({ can: () => false }) as any,
      },
    );
    expect(out.status).toBe(503);
    expect(out.body.error).toContain('session.background');
    expect(out.body.error).not.toContain('secret');
  });
});
