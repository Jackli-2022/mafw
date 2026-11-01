import * as http from 'http';
import { handleSessionBranch } from '../../../src/routes/session-branch';
import { handleSessionCheckpoints } from '../../../src/routes/session-checkpoints';
import { handleSessionRun } from '../../../src/routes/session-run';

function res() {
  const out = { status: 0, body: '' as any };
  return {
    out,
    value: {
      writeHead(status: number) { out.status = status; },
      end(body?: string) { out.body = body ? JSON.parse(body) : undefined; },
    } as unknown as http.ServerResponse,
  };
}

const denied = { can: () => false, requireSurface: () => { throw new Error('denied'); } } as any;

describe('RuntimeAccess route gates', () => {
  it('branch route returns neutral 503 without a runtime name', async () => {
    const { value, out } = res();
    const handled = await handleSessionBranch(
      { method: 'POST' } as http.IncomingMessage,
      value,
      '/api/sessions/s1/fork',
      {
        getRuntime: () => ({ name: 'secret-runtime', session: { fork: async () => ({}) } }) as any,
        getAccess: () => denied,
      } as any,
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(503);
    expect(out.body.error).toContain('branch.fork');
    expect(out.body.error).not.toContain('secret-runtime');
  });

  it('checkpoint route returns neutral 503 without a runtime name', async () => {
    const { value, out } = res();
    const handled = await handleSessionCheckpoints(
      { method: 'GET' } as http.IncomingMessage,
      value,
      '/api/sessions/s1/checkpoints',
      {
        getRuntime: () => ({ name: 'secret-runtime', capabilities: {} }) as any,
        checkpoints: { list: () => [] } as any,
        getAccess: () => denied,
      } as any,
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(503);
    expect(out.body.error).not.toContain('secret-runtime');
  });

  it('run route returns neutral 503 without a runtime name', async () => {
    const { value, out } = res();
    const handled = await handleSessionRun(
      { method: 'POST' } as http.IncomingMessage,
      value,
      '/api/sessions/s1/suspend',
      {
        getRuntime: () => ({ name: 'secret-runtime', capabilities: {} }) as any,
        run: { suspend: async () => ({}) } as any,
        getAccess: () => denied,
      } as any,
    );
    expect(handled).toBe(true);
    expect(out.status).toBe(503);
    expect(out.body.error).not.toContain('secret-runtime');
  });
});
