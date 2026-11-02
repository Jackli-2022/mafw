/**
 * REST 面（Task 3）：`GET /api/background/jobs`、`GET /api/background/jobs/:id/output`、
 * `POST /api/background/jobs/:id/cancel` —— 只出口 `MafwBackgroundJob` /
 * `MafwBackgroundOutput`，绝不透传 runtime shell 原生 DTO。
 */
import {
  attachBackgroundJobHandlers,
  handleBackgroundJobCancel,
  handleBackgroundJobOutput,
  handleBackgroundJobsList,
  parseBackgroundCursor,
} from '../../../src/routes/background-jobs';
import { BackgroundJobError } from '../../../src/core/background/background-jobs';
import { RouteRegistry } from '../../../src/routes/registry';
import { buildRouteCatalog } from '../../../src/routes/route-catalog';

function fakeRes() {
  const out: any = { status: 0, body: '' };
  out.writeHead = (status: number) => { out.status = status; };
  out.end = (body: string) => { out.body = body; };
  return out;
}

const req = { method: 'GET' } as any;

const job = {
  id: 'task_1', source: 'mafw-task', kind: 'shell', status: 'running', sessionID: 'ses_1',
};

function fakeService(over: any = {}) {
  return {
    list: jest.fn(async () => [job]),
    output: jest.fn(async () => ({ cursor: 5, data: 'hi', truncated: false })),
    cancel: jest.fn(async () => ({ ...job, status: 'cancelled' })),
    ...over,
  } as any;
}

describe('background jobs routes', () => {
  it('parseBackgroundCursor omits absent/blank values (no Number(null)=0)', () => {
    expect(parseBackgroundCursor(new URLSearchParams(''))).toBeUndefined();
    expect(parseBackgroundCursor(new URLSearchParams('cursor='))).toBeUndefined();
    expect(parseBackgroundCursor(new URLSearchParams('cursor=nope'))).toBeUndefined();
    expect(parseBackgroundCursor(new URLSearchParams('cursor=12'))).toBe(12);
    expect(parseBackgroundCursor(new URLSearchParams('cursor=0'))).toBe(0);
  });

  it('lists jobs for a session and ignores non-matching paths', async () => {
    const service = fakeService();
    const res = fakeRes();
    const handled = await handleBackgroundJobsList(req, res, '/api/background/jobs?sessionID=ses_1', { service });
    expect(handled).toBe(true);
    expect(service.list).toHaveBeenCalledWith('ses_1');
    expect(JSON.parse(res.body).items).toHaveLength(1);
    expect(res.status).toBe(200);

    const other = fakeRes();
    expect(await handleBackgroundJobsList(req, other, '/api/background/jobsx', { service })).toBe(false);
    expect(other.status).toBe(0);
  });

  it('requires sessionID (400) and a service (503)', async () => {
    const missing = fakeRes();
    await handleBackgroundJobsList(req, missing, '/api/background/jobs', { service: fakeService() });
    expect(missing.status).toBe(400);

    const noService = fakeRes();
    await handleBackgroundJobsList(req, noService, '/api/background/jobs?sessionID=ses_1', { service: null });
    expect(noService.status).toBe(503);
  });

  it('reads output with cursor passthrough', async () => {
    const service = fakeService();
    const res = fakeRes();
    const handled = await handleBackgroundJobOutput(
      req, res, '/api/background/jobs/task_1/output?sessionID=ses_1&cursor=4', { service },
    );
    expect(handled).toBe(true);
    expect(service.output).toHaveBeenCalledWith('ses_1', 'task_1', 4);
    expect(JSON.parse(res.body)).toEqual({ cursor: 5, data: 'hi', truncated: false });

    const plain = fakeRes();
    await handleBackgroundJobOutput(req, plain, '/api/background/jobs/task_1/output?sessionID=ses_1', { service });
    expect(service.output).toHaveBeenLastCalledWith('ses_1', 'task_1', undefined);
  });

  it('cancels a job (POST only) and preserves service error status', async () => {
    const service = fakeService();
    const res = fakeRes();
    const post = { method: 'POST' } as any;
    const handled = await handleBackgroundJobCancel(
      post, res, '/api/background/jobs/task_1/cancel?sessionID=ses_1', { service },
    );
    expect(handled).toBe(true);
    expect(JSON.parse(res.body).status).toBe('cancelled');

    const wrongMethod = fakeRes();
    expect(await handleBackgroundJobCancel(
      req, wrongMethod, '/api/background/jobs/task_1/cancel?sessionID=ses_1', { service },
    )).toBe(false);

    const failing = fakeService({
      cancel: async () => { throw new BackgroundJobError(404, 'job not found: nope'); },
    });
    const missing = fakeRes();
    await handleBackgroundJobCancel(post, missing, '/api/background/jobs/nope/cancel?sessionID=ses_1', { service: failing });
    expect(missing.status).toBe(404);
    expect(JSON.parse(missing.body).error).toContain('job not found');
  });

  it('rejects unknown ids via the service status (404) and missing session (400)', async () => {
    const service = fakeService({
      output: async () => { throw new BackgroundJobError(404, 'job not found: nope'); },
    });
    const res = fakeRes();
    await handleBackgroundJobOutput(req, res, '/api/background/jobs/nope/output?sessionID=ses_1', { service });
    expect(res.status).toBe(404);

    const noSession = fakeRes();
    await handleBackgroundJobOutput(req, noSession, '/api/background/jobs/nope/output', { service });
    expect(noSession.status).toBe(400);
  });

  it('attaches all three catalog operations and dispatches through the registry', async () => {
    const registry = new RouteRegistry().register(...buildRouteCatalog());
    attachBackgroundJobHandlers(registry, () => ({ service: fakeService() }));
    const attached = registry.attachedOperationIds();
    expect([...attached]).toEqual(expect.arrayContaining([
      'background.jobs.list', 'background.jobs.output', 'background.jobs.cancel',
    ]));

    // catalog 里挂 handler 的每条 background 路由都必须能命中（防漏挂静默 404）
    const list = registry.match('GET', '/api/background/jobs?sessionID=ses_1');
    expect(list?.def.operationId).toBe('background.jobs.list');
    const res = fakeRes();
    const handled = await list!.def.handler!({ url: '/api/background/jobs?sessionID=ses_1', method: 'GET' } as any, res as any, list!.params);
    expect(handled).not.toBe(false);
    expect(res.status).toBe(200);
  });
});
