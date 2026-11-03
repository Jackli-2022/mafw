import { Readable } from 'stream';
import { PodError } from '../../../src/core/pod/pod-store';
import { handlePods } from '../../../src/routes/pods';

function response() {
  const out = { status: 0, body: '' };
  const res: any = {
    writeHead: (status: number) => { out.status = status; return res; },
    end: (chunk?: unknown) => { out.body = chunk == null ? '' : String(chunk); },
  };
  return { res, out };
}

function request(method: string): any {
  const req: any = Readable.from([]);
  req.method = method;
  return req;
}

function deps(overrides: any = {}): any {
  const calls: string[] = [];
  return {
    calls,
    pods: {
      get: () => null,
      lookup: () => null,
      ensure: async () => { throw new Error('not used'); },
      ensureLead: async (podId: string) => {
        calls.push(podId);
        if (podId === 'missing') throw new PodError(404, 'pod not found');
        return { podId, projectDir: 'C:/project', sessionId: 'ses_lead' };
      },
    },
    tasks: { list: () => [] },
    messages: { list: () => [], send: jest.fn(), markRead: jest.fn() },
    goals: { list: () => [], promote: async () => ({}) },
    memory: { renderContext: () => null, writeMemory: jest.fn(), readMemoryFile: jest.fn() },
    cost: async () => ({ spentUsd: 0, limitUsd: 0 }),
    transcript: async () => ({}),
    ...overrides,
  };
}

describe('POST /api/pods/:podId/lead/ensure', () => {
  test('ensures exactly the requested pod and returns the lead DTO', async () => {
    const d = deps();
    const { res, out } = response();

    const handled = await handlePods(
      request('POST'),
      res,
      '/api/pods/pod_1/lead/ensure',
      d,
    );

    expect(handled).toBe(true);
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({
      podId: 'pod_1',
      projectDir: 'C:/project',
      sessionId: 'ses_lead',
    });
    expect(d.calls).toEqual(['pod_1']);
  });

  test('GET does not mutate and is not handled by this route', async () => {
    const d = deps();
    const { res, out } = response();

    const handled = await handlePods(
      request('GET'),
      res,
      '/api/pods/pod_1/lead/ensure',
      d,
    );

    expect(handled).toBe(false);
    expect(out.status).toBe(0);
    expect(d.calls).toEqual([]);
  });

  test('unknown pod surfaces 404', async () => {
    const d = deps();
    const { res, out } = response();

    await handlePods(request('POST'), res, '/api/pods/missing/lead/ensure', d);

    expect(out.status).toBe(404);
    expect(JSON.parse(out.body).error).toContain('pod not found');
  });
});
